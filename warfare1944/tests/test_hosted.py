"""Hosted HTTPS and ephemeral-server recovery paths used by the Render deployment."""

import copy
import unittest

from aiohttp import WSServerHandshakeError

from warfare1944.common import campaign
from warfare1944.restore import FIELDS, validated_backup
from warfare1944.standalone import COOKIE, SERVER_KEY, create_app
from test_standalone import ServerTestCase


class HostedTests(ServerTestCase):
    async def test_https_origin_behind_plain_http_proxy(self):
        public_url = "https://warfare-1944.example"
        client = await self.new_client(create_app(self.path, public_url=public_url))
        response = await client.get("/local/session")
        session = await response.json()
        self.assertEqual(session["joinUrl"], public_url + "/")
        self.assertTrue(session["hosted"])
        self.assertTrue(response.cookies[COOKIE]["secure"])
        cookie = {"Cookie": f"{COOKIE}={response.cookies[COOKIE].value}"}
        # Render forwards HTTP internally, while Safari sends its public HTTPS Origin.
        ws = await client.ws_connect("/local/socket", origin=public_url, headers=cookie)
        await self.until(ws, lambda data: "mine" in data)
        await self.new_campaign(ws)
        await ws.send_json({"launch": True})
        await self.until(ws, lambda data: "battle" in data)
        with self.assertRaises(WSServerHandshakeError) as error:
            await client.ws_connect("/local/socket", origin="https://other.example", headers=cookie)
        self.assertEqual(error.exception.status, 403)

    async def test_browser_backup_recovers_after_server_loses_save_files(self):
        player = await self.player()
        token = next(cookie.value for cookie in self.client.session.cookie_jar if cookie.key == COOKIE)
        ws = await self.client.ws_connect("/local/socket")
        await self.until(ws, lambda data: "mine" in data)
        initial = (await self.new_campaign(ws))["save"]
        backup = {key: initial[key] for key in FIELDS}
        campaign.add_xp(backup, 100)
        backup["mission"] = 3
        upgrade = next(number for number in campaign.open_upgrades(backup) if campaign.can_buy(backup, number))
        campaign.buy(backup, upgrade)
        await ws.close()
        await self.client.close()
        for path in self.path.glob("*.json"):
            path.unlink()

        restarted = await self.new_client()
        restarted.session.cookie_jar.update_cookies({COOKIE: token})
        ws = await restarted.ws_connect("/local/socket")
        await self.until(ws, lambda data: "mine" in data)
        await ws.send_json({"restoreCampaign": backup})
        restored = await self.until(ws, lambda data: data.get("save") is not None)
        self.assertEqual(restored["save"]["mission"], 3)
        self.assertEqual(restored["save"]["xp"], 100)
        self.assertIn(upgrade, restored["save"]["upgrades"])
        stored = await restarted.app[SERVER_KEY].game.config.user_from_id(int(player["id"])).campaign()
        self.assertEqual(stored, backup)
        await ws.send_json({"launch": True})
        loaded = await self.until(ws, lambda data: "battle" in data)
        self.assertEqual(loaded["battle"]["map"]["mission"], 3)

    async def test_backup_cannot_replace_existing_progress(self):
        player = await self.player()
        ws = await self.client.ws_connect("/local/socket")
        await self.until(ws, lambda data: "mine" in data)
        first = (await self.new_campaign(ws))["save"]
        old_backup = {key: first[key] for key in FIELDS}
        game = self.client.app[SERVER_KEY].game
        async with game.lock(int(player["id"])):
            storage = game.config.user_from_id(int(player["id"]))
            current = await storage.campaign()
            current["mission"] = 5
            await storage.campaign.set(current)
        await ws.send_json({"restoreCampaign": old_backup})
        response = await self.until(ws, lambda data: data.get("save") is not None)
        self.assertEqual(response["save"]["mission"], 5)

    async def test_invalid_backup_cannot_create_a_save(self):
        await self.player()
        ws = await self.client.ws_connect("/local/socket")
        await self.until(ws, lambda data: "mine" in data)
        bad = campaign.new_save("british", "recruit")
        bad["mission"] = 9
        await ws.send_json({"restoreCampaign": bad})
        rejected = await self.until(ws, lambda data: "save" in data)
        self.assertIsNone(rejected["save"])
        self.assertFalse(list(self.path.glob("*.json")))

    async def test_health_check_does_not_create_player_state(self):
        response = await self.client.get("/healthz")
        self.assertEqual(response.status, 200)
        self.assertEqual(await response.json(), {"status": "ok"})
        self.assertNotIn(COOKIE, response.cookies)
        self.assertFalse(list(self.path.glob("*.json")))


class BackupValidationTests(unittest.TestCase):
    def test_valid_upgrade_save_roundtrips_without_view_only_fields(self):
        saved = campaign.new_save("german", "recruit")
        campaign.add_xp(saved, 250)
        campaign.buy(saved, 1)
        self.assertEqual(validated_backup(saved), saved)

    def test_corrupt_backups_are_rejected(self):
        original = campaign.new_save("british", "recruit")
        bad_values = (
            {"mission": True}, {"level": 99}, {"xp": -1}, {"xp": 100},
            {"points": 1}, {"upgrades": [1, 1]}, {"finished": True}, {"side": []},
            {"career": dict.fromkeys(campaign.CAREER_KEYS, float("nan"))},
        )
        for change in bad_values:
            with self.subTest(change=change):
                bad = {**copy.deepcopy(original), **change}
                self.assertIsNone(validated_backup(bad))


if __name__ == "__main__":
    unittest.main()
