"""Portable campaigns use the same locked, validated restore owner as backups."""
import asyncio
import copy
import unittest

from warfare1944.common import campaign
from warfare1944.restore import campaign_from_file
from warfare1944.standalone import SERVER_KEY
from test_standalone import ServerTestCase


def envelope(save):
    return {"format": "warfare1944.campaign", "version": 1, "campaign": save}


class TransferTests(ServerTestCase):
    async def socket(self, client=None):
        client = client or self.client
        player = await self.player(client)
        ws = await client.ws_connect("/local/socket")
        await self.until(ws, lambda data: "mine" in data)
        return player, ws

    async def transfer(self, ws, save):
        await ws.send_json({"importCampaign": envelope(save)})
        return (await self.until(ws, lambda data: "campaignTransfer" in data))["campaignTransfer"]

    async def test_import_preserves_mission_upgrades_and_survives_reconnect(self):
        player, ws = await self.socket()
        save = campaign.new_save("german", "regular")
        campaign.add_xp(save, 250)
        campaign.buy(save, 1)
        save["mission"] = 4
        self.assertTrue((await self.transfer(ws, save))["ok"])
        await ws.close()
        ws = await self.client.ws_connect("/local/socket")
        restored = await self.until(ws, lambda data: data.get("save") is not None)
        self.assertEqual({key: restored["save"][key] for key in save}, save)
        stored = await self.client.app[SERVER_KEY].game.config.user_from_id(int(player["id"])).campaign()
        self.assertEqual(stored, save)

    async def test_repeating_import_after_a_lost_reply_is_idempotent(self):
        player, ws = await self.socket()
        save = campaign.new_save("british", "recruit")
        for _ in range(2):
            self.assertTrue((await self.transfer(ws, save))["ok"])
        stored = await self.client.app[SERVER_KEY].game.config.user_from_id(int(player["id"])).campaign()
        self.assertEqual(stored, save)
        self.assertEqual(len(list(self.path.glob("*.json"))), 1)

    async def test_import_never_overwrites_an_existing_campaign(self):
        player, ws = await self.socket()
        initial = (await self.new_campaign(ws))["save"]
        self.assertFalse((await self.transfer(ws, campaign.new_save("german", "hardened")))["ok"])
        stored = await self.client.app[SERVER_KEY].game.config.user_from_id(int(player["id"])).campaign()
        self.assertEqual(stored["side"], initial["side"])

    async def test_import_cannot_create_save_while_custom_battle_is_active(self):
        _, ws = await self.socket()
        await ws.send_json({"custom": {"side": "british", "difficulty": "medium", "map": 1,
                                       "units": [True] * 8, "supports": [True] * 4, "rp": 1000,
                                       "mood": "balanced"}})
        await self.until(ws, lambda data: "battle" in data)
        self.assertFalse((await self.transfer(ws, campaign.new_save("german", "recruit")))["ok"])
        self.assertFalse(list(self.path.glob("*.json")))

    async def test_two_devices_racing_imports_keep_the_first_campaign(self):
        _, first = await self.socket()
        second = await self.client.ws_connect("/local/socket")
        await self.until(second, lambda data: "mine" in data)
        saves = [campaign.new_save("british", "recruit"), campaign.new_save("german", "regular")]
        results = await asyncio.gather(self.transfer(first, saves[0]), self.transfer(second, saves[1]))
        self.assertEqual(sorted(result["ok"] for result in results), [False, True])

    async def test_bad_file_is_rejected_without_creating_a_save(self):
        _, ws = await self.socket()
        await ws.send_json({"importCampaign": {"format": "warfare1944.campaign", "version": True, "campaign": {}}})
        result = await self.until(ws, lambda data: "campaignTransfer" in data)
        self.assertFalse(result["campaignTransfer"]["ok"])
        self.assertFalse(list(self.path.glob("*.json")))


class FileValidationTests(unittest.TestCase):
    def test_invalid_versions_formats_and_campaign_values_are_rejected(self):
        good = envelope(campaign.new_save("british", "recruit"))
        self.assertEqual(campaign_from_file(good), good["campaign"])
        for change in ({"version": True}, {"version": 2}, {"format": "other"}, {"extra": 1},
                       {"campaign": []}, {"campaign": {**good["campaign"], "difficulty": []}},
                       {"campaign": {**good["campaign"], "xp": float("nan")}}):
            with self.subTest(change=change):
                self.assertIsNone(campaign_from_file({**copy.deepcopy(good), **change}))


if __name__ == "__main__":
    unittest.main()
