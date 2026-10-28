"""Integration tests for the local server, using its real HTTP and WebSocket endpoints."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from aiohttp import CookieJar, WSServerHandshakeError
from aiohttp.test_utils import TestClient, TestServer

from warfare1944.common.battle import Battle
from warfare1944.common.missions import CAMPAIGNS
from warfare1944.common.morale import end
from warfare1944.standalone import COOKIE, SERVER_KEY, LocalSaves, create_app


class ServerTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name)
        self.clients = []
        self.client = await self.new_client()

    async def new_client(self, app=None):
        app = app or create_app(self.path)
        client = TestClient(TestServer(app), cookie_jar=CookieJar(unsafe=True))
        await client.start_server()
        self.clients.append(client)
        return client

    async def asyncTearDown(self):
        for client in self.clients:
            await client.close()
        self.directory.cleanup()

    async def player(self, client=None):
        response = await (client or self.client).get("/local/session")
        self.assertEqual(response.status, 200)
        return await response.json()

    async def until(self, ws, predicate):
        async def receive():
            while True:
                message = await ws.receive_json()
                if predicate(message):
                    return message

        return await asyncio.wait_for(receive(), 5)

    async def new_campaign(self, ws, side="british"):
        await ws.send_json({"newCampaign": {"side": side, "difficulty": "recruit"}})
        return await self.until(ws, lambda data: data.get("save", {}).get("side") == side)


class StandaloneTests(ServerTestCase):
    async def test_page_assets_and_save_files_are_separate(self):
        response = await self.client.get("/")
        self.assertEqual(response.status, 200)
        self.assertIn('"activityhub":"/local-hub.js"', await response.text())
        for path in ("/local-hub.js", "/vendor/pixi.min.mjs", "/art/flash.json", "/standalone.css"):
            response = await self.client.get(path)
            self.assertEqual(response.status, 200, path)
        for path in ("/engine.py", "/standalone.py", "/.local/warfare1944/test.json"):
            self.assertEqual((await self.client.get(path)).status, 404, path)

    async def test_websocket_requires_profile_and_same_origin(self):
        with self.assertRaises(WSServerHandshakeError) as error:
            await self.client.ws_connect("/local/socket")
        self.assertEqual(error.exception.status, 401)
        await self.player()
        with self.assertRaises(WSServerHandshakeError) as error:
            await self.client.ws_connect("/local/socket", origin="https://another-site.example")
        self.assertEqual(error.exception.status, 403)

    async def test_campaign_deploy_pause_and_reconnect(self):
        player = await self.player()
        ws = await self.client.ws_connect("/local/socket")
        await self.until(ws, lambda data: "mine" in data)
        await self.new_campaign(ws)
        await ws.send_json({"launch": True})
        first = await self.until(ws, lambda data: "battle" in data)
        battle_id = first["battle"]["id"]
        await ws.send_json({"deploy": [1, 1]})
        game = self.client.app[SERVER_KEY].game
        run = game.running(int(player["id"]))
        # A real deployment reaches the engine; malformed messages below must not change it.
        for _ in range(30):
            if run.battle.sides["british"].squads:
                break
            await self.until(ws, lambda data: "u" in data)
        self.assertTrue(run.battle.sides["british"].squads)
        await ws.send_str("not JSON")
        await ws.send_json({"deploy": [True, 10000]})
        await ws.send_json({"pause": True})
        await self.until(ws, lambda data: data.get("u", {}).get("paused") is True)
        await ws.close()
        ws = await self.client.ws_connect("/local/socket")
        rejoined = await self.until(ws, lambda data: "battle" in data)
        self.assertEqual(rejoined["battle"]["id"], battle_id)
        self.assertTrue(run.battle.paused)
        await ws.send_json({"pause": False})
        await self.until(ws, lambda data: data.get("u", {}).get("paused") is False)

    async def test_campaign_win_and_upgrade_survive_restart(self):
        player = await self.player()
        token = next(cookie.value for cookie in self.client.session.cookie_jar if cookie.key == COOKIE)
        ws = await self.client.ws_connect("/local/socket")
        await self.until(ws, lambda data: "mine" in data)
        await self.new_campaign(ws, "german")
        await ws.send_json({"launch": True})
        await self.until(ws, lambda data: "battle" in data)
        game = self.client.app[SERVER_KEY].game
        run = game.running(int(player["id"]))
        # End a real battle through the engine's normal result path, without waiting for a whole match.
        end(run.battle, "german", "conquer")
        won = await self.until(ws, lambda data: data.get("save", {}).get("mission") == 2)
        self.assertEqual(won["save"]["career"]["wins"], 1)
        storage = game.config.user_from_id(int(player["id"]))
        async with game.lock(int(player["id"])):
            save = await storage.campaign()
            save["points"] = 10
            await storage.campaign.set(save)
        upgrade = won["save"]["open"][0]
        await ws.send_json({"buy": upgrade})
        await self.until(ws, lambda data: upgrade in data.get("save", {}).get("upgrades", []))
        await ws.close()
        await self.client.close()

        restarted = await self.new_client()
        restarted.session.cookie_jar.update_cookies({COOKIE: token})
        self.assertEqual((await self.player(restarted))["id"], player["id"])
        ws = await restarted.ws_connect("/local/socket")
        loaded = await self.until(ws, lambda data: data.get("save") is not None)
        self.assertEqual(loaded["save"]["mission"], 2)
        self.assertIn(upgrade, loaded["save"]["upgrades"])
        self.assertEqual(loaded["save"]["career"]["wins"], 1)

    async def test_local_players_can_start_versus(self):
        first = await self.player()
        # Two clients on the same server represent two browsers or devices on the LAN.
        from aiohttp import ClientSession

        async with ClientSession(cookie_jar=CookieJar(unsafe=True)) as other:
            address = self.client.make_url("/")
            async with other.get(address.joinpath("local/session")) as response:
                second = await response.json()
            self.assertNotEqual(first["id"], second["id"])
            one = await self.client.ws_connect("/local/socket")
            two = await other.ws_connect(address.joinpath("local/socket"))
            self.addAsyncCleanup(two.close)
            await self.until(one, lambda data: "mine" in data)
            await self.until(two, lambda data: "mine" in data)
            settings = {
                "side": "british", "units": [True] * 8, "supports": [True] * 4,
                "rp": 1000, "map": 1, "who": "server",
            }
            await one.send_json({"versus": settings})
            listed = await self.until(two, lambda data: bool(data.get("lobby", {}).get("versus")))
            await two.send_json({"takeVersus": listed["lobby"]["versus"][0]["id"]})
            first_battle = (await self.until(one, lambda data: "battle" in data))["battle"]
            second_battle = (await self.until(two, lambda data: "battle" in data))["battle"]
            self.assertEqual(first_battle["id"], second_battle["id"])
            self.assertEqual(first_battle["kind"], "versus")
            self.assertNotEqual(first_battle["you"], second_battle["you"])
            await two.close()

    async def test_browser_profiles_have_separate_campaigns(self):
        one = await self.player()
        ws = await self.client.ws_connect("/local/socket")
        await self.until(ws, lambda data: "mine" in data)
        await self.new_campaign(ws)
        other = await self.new_client()
        two = await self.player(other)
        self.assertNotEqual(one["id"], two["id"])
        self.assertIsNone(await LocalSaves(self.path).user_from_id(int(two["id"])).campaign())
        self.assertEqual(len(list(self.path.glob("*.json"))), 1)
        self.assertEqual(json.loads(next(self.path.glob("*.json")).read_text())["side"], "british")

    async def test_custom_battle_starts_without_a_campaign_save(self):
        await self.player()
        ws = await self.client.ws_connect("/local/socket")
        await self.until(ws, lambda data: "mine" in data)
        await ws.send_json({"custom": {
            "side": "german", "units": [True] * 8, "supports": [True] * 4,
            "rp": 1000, "map": 1, "difficulty": "medium", "mood": "balanced",
        }})
        battle = (await self.until(ws, lambda data: "battle" in data))["battle"]
        self.assertEqual(battle["kind"], "custom")
        self.assertEqual(battle["you"], "german")
        self.assertFalse(list(self.path.glob("*.json")))


class CampaignSmokeTests(unittest.TestCase):
    def test_all_sixteen_missions_construct_and_step_without_discord(self):
        for side, missions in CAMPAIGNS.items():
            self.assertEqual(len(missions), 8)
            for mission in missions:
                with self.subTest(side=side, mission=mission.number):
                    battle = Battle(mission, 1944, {side: 1}, {}, True, True, "recruit")
                    for _ in range(90):
                        battle.tick()
                    self.assertEqual(battle.step, 90)


if __name__ == "__main__":
    unittest.main()
