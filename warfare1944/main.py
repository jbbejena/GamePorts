"""The ActivityHub/Red adapter. Battle and campaign rules live in engine.py."""

from pathlib import Path

from redbot.core import Config, commands
from redbot.core.bot import Red

from .engine import KEY, WarfareGame


class Warfare1944(WarfareGame, commands.Cog):
    """Lead the American or German army through Warfare 1944."""

    def __init__(self, bot: Red):
        self.bot = bot
        storage = Config.get_conf(self, identifier=2026101244, force_registration=True)
        storage.register_user(campaign=None)
        WarfareGame.__init__(self, storage)

    def format_help_for_context(self, ctx: commands.Context):
        helpcmd = super().format_help_for_context(ctx)
        return f"{helpcmd}\n\nVersion: {self.__version__}\nAuthor: {self.__author__}"

    async def red_delete_data_for_user(self, *, requester: str, user_id: int):
        await self.delete_player(user_id)

    async def cog_unload(self):
        await self.close()

    async def activityhub_game(self) -> dict:
        return {
            "key": KEY,
            "name": "Warfare 1944",
            "description": "Lead the American or German army across the battlefields of 1944",
            "icon": "icon.png",
            "thumbnail": "thumb.png",
            "web_dir": Path(__file__).parent / "web",
            "socket": {"join": self.join, "message": self.message, "leave": self.leave},
            "room": "server",
            "requires": "0.10.0",
        }
