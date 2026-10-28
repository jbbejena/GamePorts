"""Warfare 1944, usable as a Red cog or through ``python -m warfare1944``."""

import json
from pathlib import Path

# Keep package imports independent of Red so the standalone launcher needs only aiohttp.
__red_end_user_data_statement__ = json.loads(
    (Path(__file__).parent / "info.json").read_text(encoding="utf-8")
)["end_user_data_statement"]


def __getattr__(name):
    if name == "Warfare1944":
        from .main import Warfare1944

        return Warfare1944
    raise AttributeError(name)


async def setup(bot):
    from .main import Warfare1944

    await bot.add_cog(Warfare1944(bot))
