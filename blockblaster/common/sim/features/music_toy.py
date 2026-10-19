"""Feature 26, the Music Toy: a row of colored notes over a patch of the picture, and mallets in the queues that each
break one note of their color.

A mallet is a queue entry that never shoots; once it is first in its queue it jumps onto a note of its color and takes
the note's one health. The controller tries a strike pass after the same things the hammers' does (a pig tapped, pigs
entering or leaving a queue, a booster or the Super Unicorn finishing, a revive finishing: MusicToyFeatureController
$$TryToHitToys, RVA 0x56B8504). A pass gives every unused mallet first in its queue, in the order the level lists them,
the first toy that has a note of its color with no lethal damage on its way, and in that toy the lowest such note
(TryFindTargetSegment, RVA 0x56B8BF0). A mallet with no such note waits for a later pass. The k-th mallet that strikes
in a pass starts MALLET_GAP x k ticks after the first. A strike that takes the note's last health marks it broken at
once, so the next mallet takes another note (the hammers' rule: MusicToyMalletFeature$$Hit). Each mallet lifts for
HAMMER_LIFT ticks and leaves its queue (the queue closes up, which can start another pass), its damage lands
STRIKE_LANDS ticks after its strike starts and it is gone HAMMER_DONE ticks after it starts. When no unbroken note is
left anywhere, every unused mallet vanishes, last listed first.

The swing time of the original's mallet is not fully resolved in its code, so the damage lands as the hammer's does.
A Hand tap on a mallet runs a pass with only that mallet, which strikes even when it isn't first. The toy is an
obstacle over all its cells until every note has broken: shots stop at it and the cubes under it can't be hit, but the
stuck check sees through it (IIgnoredObstacleAttachable). When the last note breaks the toy collapses and its cells are
free at once. The notes lie along the toy's long axis in the order the level lists them, the first at the lowest
coordinate. web/sim/features/music_toy.js mirrors this file.
"""

from __future__ import annotations

from .. import base, checks, places
from .. import grid as gridx
from ..numbers import HAMMER_DONE, HAMMER_LIFT, MALLET_GAP, STRIKE_LANDS

NUMBER = 26

# Events after which a strike pass runs at once: a pig tapped, pigs entering or leaving a queue, and the outside
# triggers (a booster or the Super Unicorn finished, a revive finished)
STRIKE_AFTER = ("pig_tapped", "queue_changed", "pigs_exit_queue", "booster_done", "revive_done")


def setup(state: base.State) -> None:
    """The mallets in the level's order (a mallet inside a Pig Pipe too, so it comes out as a mallet) with their note
    colors, and every toy standing on its cells as an obstacle, in file order."""
    listed = state.level.features.get("MusicToyMallets")
    placed = state.level.features.get("musicToys")
    mallets = [m for m in listed["Mallets"] if m["ShooterId"] in state.pigs] if listed else []
    data_toys = placed["MusicToys"] if placed else []
    if not mallets and not data_toys:
        return
    for mallet in mallets:
        state.pigs[mallet["ShooterId"]].tags.append("disabled")
    grid = state.grid
    toys = []
    for data in data_toys:
        cells = [
            gridx.cell_of(grid, point["X"], point["Y"])
            for point in data["GridPoints"]
            if 0 <= point["X"] < grid.width and 0 <= point["Y"] < grid.height
        ]
        body = gridx.make_target(NUMBER, -1, 1, obstacle=True, hittable=False)
        gridx.add(grid, body, cells)
        notes = [
            {"color": note["Material"], "health": note["Health"], "pending": 0, "broken": False, "dead": False}
            for note in data["Segments"]
        ]
        toys.append({"target": body.id, "notes": notes})
    state.features[NUMBER] = {
        "mallets": [m["ShooterId"] for m in mallets],
        "colors": [m["Material"] for m in mallets],
        "toys": toys,
        "used": [],
        "strikes": [],
        "active": any(toy["notes"] for toy in toys),
    }


def is_mallet(state: base.State, pig_id: int) -> bool:
    mine = state.features.get(NUMBER)
    return mine is not None and pig_id in mine["mallets"]


def first_in_queue(state: base.State, pig_id: int) -> bool:
    return any(queue and queue[0] == pig_id for queue in state.queues)


def available(state: base.State, pig_id: int) -> bool:
    """Unused and first in its queue."""
    return pig_id not in state.features[NUMBER]["used"] and first_in_queue(state, pig_id)


def find_note(state: base.State, color: int) -> tuple[int, int] | None:
    """TryFindTargetSegment: the first toy with a note of this color and no lethal damage on its way, and its lowest
    such note, as (toy, note)."""
    for toy_index, toy in enumerate(state.features[NUMBER]["toys"]):
        for note_index, note in enumerate(toy["notes"]):
            if note["color"] == color and not note["dead"] and not note["broken"]:
                return toy_index, note_index
    return None


def has_open_note(state: base.State) -> bool:
    """Some note is neither broken nor marked broken by a strike on its way."""
    return any(
        not note["dead"] and not note["broken"] for toy in state.features[NUMBER]["toys"] for note in toy["notes"]
    )


def try_strikes(state: base.State, mallets: list[int], force: bool) -> None:
    """A strike pass over these mallets (TryToHitToys). Without force only available mallets strike. With no unbroken
    note left, before or after, the leftover mallets vanish."""
    mine = state.features[NUMBER]
    if not mine["active"] or state.reviving:
        return
    count = 0
    for pig_id in mallets:
        if not has_open_note(state):
            break
        if not force and not available(state, pig_id):
            continue
        found = find_note(state, mine["colors"][mine["mallets"].index(pig_id)])
        if found is None:
            continue
        strike(state, pig_id, found, MALLET_GAP * count)
        count += 1
    if not has_open_note(state):
        clean_up(state)


def strike(state: base.State, pig_id: int, found: tuple[int, int], delay: int) -> None:
    """One mallet takes this note: it is used, the note is marked broken now if this strike takes its last health, and
    its leave, damage and end are timed from its start, delay ticks from now."""
    mine = state.features[NUMBER]
    toy_index, note_index = found
    note = mine["toys"][toy_index]["notes"][note_index]
    mine["used"].append(pig_id)
    if note["health"] - (note["pending"] + 1) < 1:
        note["broken"] = True
    note["pending"] += 1
    start = state.tick + delay
    mine["strikes"].append([pig_id, toy_index, note_index, start])
    base.schedule(state, delay + HAMMER_LIFT, "mallet_lift", pig_id)
    base.schedule(state, delay + STRIKE_LANDS, "mallet_land", [pig_id, toy_index, note_index])
    base.schedule(state, delay + HAMMER_DONE, "mallet_done", pig_id)
    base.emit(state, "mallet_strike", {"pig": pig_id, "toy": toy_index, "note": note_index, "start": start})


def clean_up(state: base.State) -> None:
    """No unbroken note is left: no more passes, and every unused mallet vanishes, last listed first."""
    mine = state.features[NUMBER]
    mine["active"] = False
    for pig_id in reversed(mine["mallets"]):
        if pig_id not in mine["used"]:
            places.vanish(state, state.pigs[pig_id], "mallet")


def mallet_lift(state: base.State, pig_id: int) -> None:
    """Timer: the lift is over and the mallet leaves its queue for the note; the queue closes up."""
    pig = state.pigs[pig_id]
    if pig.place != "queue":
        return
    index = places.queue_index(state, pig)
    queue = places.take_out(state, pig)
    pig.place = "held"
    if queue >= 0:
        base.emit(state, "pigs_exit_queue", {"ids": [pig_id], "queues": [queue], "indices": [index]})
    checks.request_stuck_check(state)


def mallet_land(state: base.State, args: list[int]) -> None:
    """Timer: the swing lands and the note loses 1; at 0 it breaks, and the toy collapses with its last note."""
    pig_id, toy_index, note_index = args
    toy = state.features[NUMBER]["toys"][toy_index]
    note = toy["notes"][note_index]
    note["pending"] = max(0, note["pending"] - 1)
    if note["dead"]:
        return
    note["health"] = max(0, note["health"] - 1)
    base.emit(state, "note_hit", {"pig": pig_id, "toy": toy_index, "note": note_index, "health": note["health"]})
    if note["health"] > 0:
        return
    note["dead"] = True
    note["broken"] = True
    base.emit(state, "note_break", {"pig": pig_id, "toy": toy_index, "note": note_index})
    if all(n["dead"] for n in toy["notes"]):
        collapse(state, toy_index)


def collapse(state: base.State, toy_index: int) -> None:
    """The last note is gone: the toy leaves the grid and its cells are free at once."""
    toy = state.features[NUMBER]["toys"][toy_index]
    body = state.grid.targets[toy["target"]]
    if body.dead:
        return
    body.health = 0
    body.dead = True
    gridx.remove(state.grid, body)
    base.emit(state, "hit", {"target": body.id, "cell": -1, "health": 0})
    base.emit(state, "toy_collapse", {"toy": toy_index, "target": body.id})
    base.emit(state, "target_died", {"target": body.id, "owner": NUMBER})
    checks.request_win_check(state)


def mallet_done(state: base.State, pig_id: int) -> None:
    """Timer: the swing is over and the mallet is gone."""
    mine = state.features[NUMBER]
    mine["strikes"] = [entry for entry in mine["strikes"] if entry[0] != pig_id]
    places.vanish(state, state.pigs[pig_id], "mallet")


base.register_timer("mallet_lift", base.PHASE_FEATURES, mallet_lift)
base.register_timer("mallet_land", base.PHASE_FEATURES, mallet_land)
base.register_timer("mallet_done", base.PHASE_FEATURES, mallet_done)


def can_tap(state: base.State, pig: base.Pig, hand: bool) -> str | None:
    """A mallet can be tapped only with the Hand, and only before it has struck."""
    if not is_mallet(state, pig.id):
        return None
    if not hand:
        return "can't tap that"
    if pig.id in state.features[NUMBER]["used"]:
        return "busy"
    return None


def on_tap(state: base.State, pig: base.Pig, hand: bool) -> bool:  # noqa: ARG001
    """The Hand on a mallet: it strikes at once, first in its queue or not."""
    if not is_mallet(state, pig.id):
        return False
    try_strikes(state, [pig.id], True)
    return True


def on_event(state: base.State, name: str, data: dict) -> None:  # noqa: ARG001
    mine = state.features.get(NUMBER)
    if mine is not None and name in STRIKE_AFTER:
        try_strikes(state, mine["mallets"], False)


def busy(state: base.State) -> bool:
    """A mallet at work holds the stuck check."""
    mine = state.features.get(NUMBER)
    return mine is not None and bool(mine["strikes"])


def ignored_obstacles(state: base.State) -> set[int]:
    """The stuck check sees through every standing toy."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return set()
    return {toy["target"] for toy in mine["toys"] if not state.grid.targets[toy["target"]].dead}


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    h = base.mix(h, int(mine["active"]))
    h = base.mix(h, len(mine["toys"]))
    for toy in mine["toys"]:
        h = base.mix(h, int(state.grid.targets[toy["target"]].dead))
        for note in toy["notes"]:
            h = base.mix(base.mix(h, note["health"]), note["pending"])
            h = base.mix(base.mix(h, int(note["broken"])), int(note["dead"]))
    h = base.mix(h, len(mine["used"]))
    for pig_id in mine["used"]:
        h = base.mix(h, pig_id)
    h = base.mix(h, len(mine["strikes"]))
    for pig_id, toy_index, note_index, start in mine["strikes"]:
        h = base.mix(base.mix(base.mix(base.mix(h, pig_id), toy_index), note_index), start)
    return h
