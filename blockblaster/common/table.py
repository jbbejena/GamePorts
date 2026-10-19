"""The per-server highest-level table: the server's players ranked by how far they have got.

Progress is kept per player across every server, so the table lists the members of the server that asks, with their
overall progress. A player who has cleared every level ranks above one who has only reached level 2,600.
"""

import typing as t

TOP = 10
NO_SERVER = "The highest-level table needs a server."


def standing(saved: dict) -> tuple[int, int]:
    """What a player ranks by: cleared every level first, then the highest level reached."""
    return int(bool(saved["cleared"])), int(saved["best"])


def row(rank: int, member: t.Any, saved: dict, you: bool) -> dict:
    """One line of the table. Discord ids are 64-bit, which a page's numbers can't hold, so the id goes out as text."""
    return {
        "rank": rank,
        "user": str(member.id),
        "name": member.display_name,
        "avatar": member.display_avatar.url,
        "level": int(saved["best"]),
        "cleared": bool(saved["cleared"]),
        "you": you,
    }


def build(everyone: dict[int, dict], guild: t.Any, author: t.Any, defaults: dict) -> dict:
    """The table for `guild`: its top TOP players, and the asking player's own row with their true rank when they are not
    among them.

    `everyone` is every saved player by user id and `defaults` a new player's progress, used for an asker who has
    never played. Players who left the server are skipped. Ties rank in user id order.
    """
    members = {user_id: guild.get_member(user_id) for user_id in everyone}
    members = {user_id: member for user_id, member in members.items() if member is not None}
    members[author.id] = author
    saved = {user_id: everyone.get(user_id, defaults) for user_id in members}
    order = sorted(saved, key=lambda user_id: (tuple(-v for v in standing(saved[user_id])), user_id))
    rows = [row(rank, members[user_id], saved[user_id], user_id == author.id) for rank, user_id in enumerate(order, 1)]
    top = rows[:TOP]
    own = None if any(r["you"] for r in top) else next(r for r in rows if r["you"])
    return {"rows": top, "you": own, "players": len(rows)}
