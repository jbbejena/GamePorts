"""Feature 21, Curtains: an obstacle over a patch of cubes, in stacked blocks that open one after another, bottom first.

A curtain holds a list of segments, each with a color and a health. Segment i owns block (count - 1 - i) of the
curtain's cells, listed row by row from the bottom, one block being BaseArea.x * BaseArea.y cells (CurtainModel$$Setup,
RVA 0x5656E7C, takes GetRange(block * area, area) of the grid points). So the last segment is the bottom block and the
first one is the top block (CurtainFeature$$SetSegments, RVA 0x5647E14, makes the last segment the active one). Every
death of a single-cell cube anywhere whose color is the active segment's does 1 to every curtain whose active color it
is, unless that curtain's pending damage is already lethal (CurtainFeatureController$$OnTargetDeath, RVA 0x564E624,
skips big cubes; DamageCurtains, RVA 0x564E040). The damage is pending at once and lands when a copy of the cube
finishes its jump into the curtain, CUBE_FLY_IN ticks later (CurtainFeature$$DamageCurtain, RVA 0x564B148). The moment
the pending damage is lethal the active block's cells are free (ReleaseSegmentOccupation, RVA 0x5647B18), and when that
was the top block the curtain leaves the grid there and then. When the damage lands and the segment's health reaches 0
the segment closes and the next one becomes the active one (OnDamage, RVA 0x5649A74; CloseActiveSegment, RVA
0x564735C). The curtain is an IRemovablePixelGridObstacle: RemoveObstacle (RVA 0x564731C) closes every segment and
leaves, which the Curtains Closed! revive (MapRescueController.<RemoveCurtains>d__28) and the Obstacles revive both do.
Shots never hit a curtain, and nothing holds the stuck check. The health sync booster is left out.
web/sim/features/curtain.js mirrors this file.
"""

from __future__ import annotations

from .. import base
from .. import grid as gridx
from ..numbers import CUBE_FLY_IN

NUMBER = 21


def setup(state: base.State) -> None:
    """Every curtain as a record, in file order, with its body standing on all its cells as an obstacle."""
    listed = state.level.features.get("curtains")
    if not listed or not listed["Curtains"]:
        return
    grid = state.grid
    curtains = []
    for data in listed["Curtains"]:
        cells = [
            gridx.cell_of(grid, point["X"], point["Y"])
            for point in data["GridPoints"]
            if 0 <= point["X"] < grid.width and 0 <= point["Y"] < grid.height
        ]
        area = data["BaseArea"]["x"] * data["BaseArea"]["y"]
        count = len(data["Segments"])
        segments = []
        for index, segment in enumerate(data["Segments"]):
            first = (count - 1 - index) * area
            segments.append(
                {
                    "color": segment["Material"],
                    "start": segment["Health"],
                    "left": segment["Health"],
                    "cells": cells[first : first + area],
                    "freed": False,
                }
            )
        body = gridx.make_target(NUMBER, -1, 1, obstacle=True, hittable=False)
        gridx.add(grid, body, cells)
        curtains.append({"target": body.id, "segments": segments, "active": count - 1, "pending": 0})
    state.features[NUMBER] = {"curtains": curtains}


def standing(state: base.State, curtain: dict) -> bool:
    return not state.grid.targets[curtain["target"]].dead


def on_event(state: base.State, name: str, data: dict) -> None:
    """A single-cell cube died: every curtain whose active segment is its color and isn't doomed gets 1 damage on its
    way."""
    mine = state.features.get(NUMBER)
    if mine is None or name != "cube_died" or not data["single"]:
        return
    for index, curtain in enumerate(mine["curtains"]):
        if not standing(state, curtain) or curtain["active"] < 0:
            continue
        segment = curtain["segments"][curtain["active"]]
        if segment["color"] != data["color"] or curtain["pending"] >= segment["left"]:
            continue
        curtain["pending"] += 1
        base.schedule(state, CUBE_FLY_IN, "curtain_land", index)
        base.emit(
            state,
            "curtain_feed",
            {"curtain": index, "segment": curtain["active"], "cell": data["cell"], "color": data["color"]},
        )
        if curtain["pending"] >= segment["left"]:
            doom(state, index, curtain["active"])


def doom(state: base.State, index: int, segment_index: int) -> None:
    """The pending damage is lethal: the active block's cells are free now, and the curtain is gone if that was the top
    block."""
    free_block(state, index, segment_index, "cubes")
    if segment_index <= 0:
        leave(state, index)


def free_block(state: base.State, index: int, segment_index: int, why: str) -> None:
    """A block's cells leave the curtain's body. The hit event makes keys and Surprise Pixels look at the picture
    again."""
    curtain = state.features[NUMBER]["curtains"][index]
    segment = curtain["segments"][segment_index]
    body = state.grid.targets[curtain["target"]]
    if segment["freed"] or body.dead:
        return
    segment["freed"] = True
    freed = set(segment["cells"])
    gridx.move(state.grid, body, [cell for cell in body.cells if cell not in freed])
    base.emit(state, "curtain_free", {"curtain": index, "segment": segment_index, "why": why})
    base.emit(state, "hit", {"target": body.id, "cell": -1, "health": body.health})


def leave(state: base.State, index: int) -> None:
    """The curtain is gone from the grid."""
    curtain = state.features[NUMBER]["curtains"][index]
    body = state.grid.targets[curtain["target"]]
    if body.dead:
        return
    body.health = 0
    body.dead = True
    gridx.remove(state.grid, body)
    base.emit(state, "curtain_leave", {"curtain": index, "target": body.id})
    base.emit(state, "hit", {"target": body.id, "cell": -1, "health": 0})


def curtain_land(state: base.State, index: int) -> None:
    """Timer: the cube copy lands in the curtain, whose active segment loses 1 health and closes at 0."""
    curtain = state.features[NUMBER]["curtains"][index]
    curtain["pending"] = max(0, curtain["pending"] - 1)
    if curtain["active"] < 0:
        return
    segment_index = curtain["active"]
    segment = curtain["segments"][segment_index]
    segment["left"] -= 1
    base.emit(state, "curtain_hit", {"curtain": index, "segment": segment_index, "left": segment["left"]})
    if segment["left"] <= 0:
        close(state, index, "cubes")


def close(state: base.State, index: int, why: str) -> None:
    """The active segment closes and the next one down the list becomes the active one."""
    curtain = state.features[NUMBER]["curtains"][index]
    segment_index = curtain["active"]
    free_block(state, index, segment_index, why)
    curtain["active"] -= 1
    base.emit(state, "curtain_close", {"curtain": index, "segment": segment_index, "why": why})


base.register_timer("curtain_land", base.PHASE_FEATURES, curtain_land)


def fail_counts(state: base.State) -> dict[str, int]:
    """The stuck fail's name counts the curtains still standing."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return {}
    return {"curtain": sum(1 for curtain in mine["curtains"] if standing(state, curtain))}


def revive(state: base.State, name: str) -> int:
    """The Curtains Closed! and Obstacles revives close every segment of every standing curtain, in file order, and
    the curtains leave. Returns the ticks the revive waits (none)."""
    mine = state.features.get(NUMBER)
    if name not in ("curtain", "obstacles") or mine is None:
        return 0
    for index, curtain in enumerate(mine["curtains"]):
        if not standing(state, curtain):
            continue
        while curtain["active"] >= 0:
            close(state, index, "revive")
        leave(state, index)
    return 0


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    h = base.mix(h, len(mine["curtains"]))
    for curtain in mine["curtains"]:
        h = base.mix(base.mix(h, int(state.grid.targets[curtain["target"]].dead)), curtain["active"])
        h = base.mix(h, curtain["pending"])
        for segment in curtain["segments"]:
            h = base.mix(base.mix(h, segment["left"]), int(segment["freed"]))
    return h
