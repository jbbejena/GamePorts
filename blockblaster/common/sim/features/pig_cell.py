"""Feature 22, the Pig Cell: a real pig shut in a cage over a patch of the picture, freed when the picture around it
is cleared to the outside.

The caged pig is a pig of the level from the start (its own color and ammo, ids from 10000), held where no rule reaches
it, so it can't be tapped (ShooterCageFeature$$CreateCagedShooter, RVA 0x579490C). The cage is neither an obstacle nor
a target: it never stops a shot. It is freed when any of its cells is reached by the edge flood, which only reaches cells
that are not solid, so a solid cage cell fails the check (ShooterCageFeature$$IsUnblocked, RVA 0x5794A50;
PixelGridController$$CanAnyPointReachOutside, RVA 0x54C1160). The check runs at the end of a tick after any hit, tap,
vanish, booster or revive, in the release phase and not while a revive pauses the map, like the keys
(ReleasablePixelGridAttachablesController, RVA 0x578EAD8; ShooterCageFeatureController$$OnReleasablesUnblocked, RVA
0x57990DC). A freed pig jumps for RESCUE_JUMP ticks and then joins the back of the rescue queue
(ShooterCageFeature.<RescueAsync>d__48$$MoveNext, RVA 0x5797494). While it jumps it still counts as a live pig, and it
holds the stuck check so the level isn't called stuck with a rescue on its way. web/sim/features/pig_cell.js mirrors
this file.
"""

from __future__ import annotations

from .. import base
from .. import grid as gridx
from ..numbers import RESCUE_JUMP

NUMBER = 22

# Events after which the release check runs at the end of the tick: a target damaged, a pig tapped, a pig about to
# vanish, and the outside triggers (a booster or a revive finished, the walls removed)
CHECK_AFTER = ("hit", "pig_tapped", "pig_vanishing", "booster_done", "revive_done", "walls_removed")


def setup(state: base.State) -> None:
    """Every cage as a record, in file order, and its pig held. A cage's cells are the ones inside the picture."""
    listed = state.level.features.get("shooterCages")
    if not listed or not listed["Cages"]:
        return
    grid = state.grid
    cages = []
    for data in listed["Cages"]:
        shooter = data["CagedShooter"]
        state.pigs[shooter["id"]] = base.Pig(
            id=shooter["id"], color=shooter["material"], ammo=shooter["ammo"], place="held"
        )
        cells = [
            gridx.cell_of(grid, point["X"], point["Y"])
            for point in data["GridPoints"]
            if 0 <= point["X"] < grid.width and 0 <= point["Y"] < grid.height
        ]
        cages.append({"pig": shooter["id"], "cells": cells, "freed": False})
    state.features[NUMBER] = {"cages": cages, "flights": [], "pending": False}


def on_event(state: base.State, name: str, data: dict) -> None:  # noqa: ARG001
    if NUMBER in state.features and name in CHECK_AFTER:
        state.features[NUMBER]["pending"] = True


def release(state: base.State) -> None:
    """End of tick: when something asked for it and the map isn't paused by a revive, every cage with a cell the edge
    flood reaches opens, in file order."""
    mine = state.features.get(NUMBER)
    if mine is None or not mine["pending"]:
        return
    mine["pending"] = False
    if state.reviving:
        return
    reach = gridx.reach_outside(state.grid)
    for index, cage in enumerate(mine["cages"]):
        if not cage["freed"] and any(reach[cell] for cell in cage["cells"]):
            free(state, index, cage)


def free(state: base.State, index: int, cage: dict) -> None:
    """The cage opens and its pig starts its jump to the rescue queue."""
    mine = state.features[NUMBER]
    cage["freed"] = True
    land = state.tick + RESCUE_JUMP
    mine["flights"].append([cage["pig"], land])
    base.schedule(state, RESCUE_JUMP, "cage_land", cage["pig"])
    base.emit(state, "cage_free", {"cage": index, "pig": cage["pig"], "land": land})


def cage_land(state: base.State, pig_id: int) -> None:
    """Timer: the pig has landed and joins the back of the rescue queue."""
    mine = state.features[NUMBER]
    mine["flights"] = [flight for flight in mine["flights"] if flight[0] != pig_id]
    pig = state.pigs[pig_id]
    pig.place = "rescue"
    state.rescue.append(pig_id)
    base.emit(state, "to_rescue", {"pig": pig_id, "index": len(state.rescue) - 1, "from": "cage"})


base.register_timer("cage_land", base.PHASE_FEATURES, cage_land)


def busy(state: base.State) -> bool:
    """A pig jumping out of its cage holds the stuck check."""
    mine = state.features.get(NUMBER)
    return mine is not None and bool(mine["flights"])


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    for cage in mine["cages"]:
        h = base.mix(h, int(cage["freed"]))
    h = base.mix(h, len(mine["flights"]))
    for pig_id, land in mine["flights"]:
        h = base.mix(base.mix(h, pig_id), land)
    return base.mix(h, int(mine["pending"]))
