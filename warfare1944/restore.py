"""Validate a browser's campaign backup before restoring a missing server save.

Backups belong to the current anonymous browser profile. They are not proof of a
score or an entitlement, and never replace an existing server save or live battle.
"""

import copy
import math

from .common import campaign
from .common.battle import DIFFICULTIES
from .common.data import LEVELS, SIDES, UPGRADES

FIELDS = frozenset(("side", "difficulty", "mission", "xp", "level", "points", "upgrades", "career", "finished"))
MAX_COUNT = 1_000_000_000


def whole(value, low, high):
    return type(value) is int and low <= value <= high


def validated_backup(value):
    if not isinstance(value, dict) or set(value) != FIELDS:
        return None
    side = value["side"]
    if type(side) is not str or side not in SIDES or type(value["difficulty"]) is not str or value["difficulty"] not in DIFFICULTIES:
        return None
    if not whole(value["mission"], 1, campaign.LAST_MISSION):
        return None
    if not whole(value["xp"], 0, MAX_COUNT) or not whole(value["level"], 0, len(LEVELS)):
        return None
    if value["level"] != sum(value["xp"] > threshold for threshold in LEVELS):
        return None
    if not whole(value["points"], 0, value["level"]):
        return None
    if type(value["finished"]) is not bool or (value["finished"] and value["mission"] != campaign.LAST_MISSION):
        return None
    upgrades = value["upgrades"]
    if not isinstance(upgrades, list) or not all(whole(number, 1, campaign.UPGRADE_COUNT) for number in upgrades):
        return None
    if upgrades != sorted(set(upgrades)):
        return None
    if not all(campaign.unlocked(side, upgrades, number) for number in upgrades):
        return None
    if value["points"] + sum(UPGRADES[side][number]["cost"] for number in upgrades) != value["level"]:
        return None
    career = value["career"]
    if not isinstance(career, dict) or set(career) != set(campaign.CAREER_KEYS):
        return None
    for key, number in career.items():
        if key in ("moraleGained", "moraleLost"):
            if type(number) not in (int, float) or not math.isfinite(number) or not 0 <= number <= MAX_COUNT:
                return None
        elif not whole(number, 0, MAX_COUNT):
            return None
    return copy.deepcopy(value)


def campaign_from_file(value):
    """Versioned portable envelope; the existing backup validator owns its data."""
    if not isinstance(value, dict) or set(value) != {"format", "version", "campaign"}:
        return None
    if value["format"] != "warfare1944.campaign" or type(value["version"]) is not int or value["version"] != 1:
        return None
    return validated_backup(value["campaign"])
