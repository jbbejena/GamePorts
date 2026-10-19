"""Feature 28, the Scissors Gate: an obstacle over a strip of cubes that folds shorter, from both ends, as cubes of its
color are destroyed anywhere on the picture.

A gate lies along one axis (Orientation 0: x, 1: y) for BaseDimensions.y cells and is BaseDimensions.x cells thick.
Its length starts at that and drops by 2 at every shrink, freeing one full line at each end: a cell stays only while
its coordinate along the axis, counted from the strip's lowest, is at least (base - length) / 2 and below
base - (base - length) / 2 (AccordionFeature$$RebuildOccupiedPoints, RVA 0x556091C). Every destroyed single-cell cube
of the gate's color gives it 1 damage, pending at once and landing CUBE_FLY_IN ticks later (AccordionFeature
$$OnTargetDeath, RVA 0x555F30C, skips big cubes; DamageAccordion, RVA 0x555F530). A gate takes damage while it is not
doomed. The step counter starts at HpPerShrink, plus LastShrinkBonus while the length is 2; when a landing takes it to
0 the gate shrinks once (OnDamage -> ShrinkOnce, RVA 0x555E1E4) and the counter resets for the new length. A gate gone
to length 0 leaves the grid. At length 2 or less, a damage whose pending total is lethal (WillKillingHit, RVA
0x555FE24) frees all of the gate's cells at once and dooms it, so it takes no more damage; its last landing then
removes it. Total cubes needed are HpPerShrink x length / 2 + LastShrinkBonus. Shots never hit a gate and nothing
holds the stuck check. The gate is an IRemovablePixelGridObstacle, so the Obstacles revive removes it.
web/sim/features/scissors_gate.js mirrors this file.
"""

from __future__ import annotations

from .. import base
from .. import grid as gridx
from ..numbers import CUBE_FLY_IN

NUMBER = 28


def step_health(gate: dict, length: int) -> int:
    """The counter a gate of this length starts a step with."""
    return gate["hp"] + (gate["bonus"] if length == 2 else 0)


def kept_cells(gate: dict, length: int) -> list[int]:
    """The cells a gate of this length stands on, in the order they were listed."""
    trim = (gate["base"] - length) // 2
    return [cell for cell, along in gate["cells"] if trim <= along < gate["base"] - trim]


def setup(state: base.State) -> None:
    """Every gate as a record in file order, its body standing on all its cells as an obstacle."""
    listed = state.level.features.get("accordions")
    if not listed or not listed["Accordions"]:
        return
    grid = state.grid
    gates = []
    for data in listed["Accordions"]:
        axis = "Y" if data["Orientation"] == 1 else "X"
        lowest = min(point[axis] for point in data["GridPoints"])
        cells = [
            [gridx.cell_of(grid, point["X"], point["Y"]), point[axis] - lowest]
            for point in data["GridPoints"]
            if 0 <= point["X"] < grid.width and 0 <= point["Y"] < grid.height
        ]
        gate = {
            "color": data["Material"],
            "hp": data["HpPerShrink"],
            "bonus": data["LastShrinkBonus"],
            "base": data["BaseDimensions"]["y"],
            "cells": cells,
            "length": data["BaseDimensions"]["y"],
            "pending": 0,
            "doomed": False,
        }
        gate["left"] = step_health(gate, gate["length"])
        body = gridx.make_target(NUMBER, -1, 1, obstacle=True, hittable=False)
        gridx.add(grid, body, kept_cells(gate, gate["length"]))
        gate["target"] = body.id
        gates.append(gate)
    state.features[NUMBER] = {"gates": gates}


def standing(state: base.State, gate: dict) -> bool:
    return not state.grid.targets[gate["target"]].dead


def on_event(state: base.State, name: str, data: dict) -> None:
    """A single-cell cube died: every standing gate of its color that isn't doomed gets 1 damage on its way."""
    mine = state.features.get(NUMBER)
    if mine is None or name != "cube_died" or not data["single"]:
        return
    for index, gate in enumerate(mine["gates"]):
        if gate["color"] != data["color"] or gate["doomed"] or not standing(state, gate):
            continue
        gate["pending"] += 1
        base.schedule(state, CUBE_FLY_IN, "gate_land", index)
        base.emit(state, "gate_feed", {"gate": index, "cell": data["cell"], "color": data["color"]})
        if gate["length"] <= 2 and gate["pending"] >= gate["left"]:
            gate["doomed"] = True
            set_cells(state, index, [], "cubes")


def set_cells(state: base.State, index: int, cells: list[int], why: str) -> None:
    """The gate's body stands on these cells now. The hit event makes keys and Surprise Pixels look at the picture
    again."""
    gate = state.features[NUMBER]["gates"][index]
    body = state.grid.targets[gate["target"]]
    gridx.move(state.grid, body, cells)
    base.emit(state, "gate_cells", {"gate": index, "length": gate["length"], "cells": len(cells), "why": why})
    base.emit(state, "hit", {"target": body.id, "cell": -1, "health": body.health})


def gate_land(state: base.State, index: int) -> None:
    """Timer: the cube copy lands in the gate, whose counter loses 1; at 0 it shrinks once."""
    gate = state.features[NUMBER]["gates"][index]
    gate["pending"] = max(0, gate["pending"] - 1)
    if not standing(state, gate):
        return
    gate["left"] -= 1
    base.emit(state, "gate_hit", {"gate": index, "left": gate["left"]})
    if gate["left"] <= 0:
        shrink(state, index)


def shrink(state: base.State, index: int) -> None:
    """ShrinkOnce: the gate is 2 shorter, its two end lines are free, and the counter resets; at length 0 it is gone."""
    gate = state.features[NUMBER]["gates"][index]
    gate["length"] -= 2
    if gate["length"] <= 0:
        gate["length"] = 0
        leave(state, index, "cubes")
        return
    gate["left"] = step_health(gate, gate["length"])
    base.emit(state, "gate_shrink", {"gate": index, "length": gate["length"]})
    if not gate["doomed"]:
        set_cells(state, index, kept_cells(gate, gate["length"]), "shrink")


def leave(state: base.State, index: int, why: str) -> None:
    """The gate is gone from the grid."""
    gate = state.features[NUMBER]["gates"][index]
    body = state.grid.targets[gate["target"]]
    if body.dead:
        return
    gate["doomed"] = True
    body.health = 0
    body.dead = True
    gridx.remove(state.grid, body)
    base.emit(state, "gate_leave", {"gate": index, "target": body.id, "why": why})
    base.emit(state, "hit", {"target": body.id, "cell": -1, "health": 0})


base.register_timer("gate_land", base.PHASE_FEATURES, gate_land)


def revive(state: base.State, name: str) -> int:
    """The Obstacles revive removes every standing gate, in file order. Returns the ticks the revive waits (none)."""
    mine = state.features.get(NUMBER)
    if name != "obstacles" or mine is None:
        return 0
    for index, gate in enumerate(mine["gates"]):
        if standing(state, gate):
            leave(state, index, "revive")
    return 0


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    h = base.mix(h, len(mine["gates"]))
    for gate in mine["gates"]:
        h = base.mix(base.mix(h, int(not standing(state, gate))), gate["length"])
        h = base.mix(base.mix(h, gate["left"]), gate["pending"])
        h = base.mix(h, int(gate["doomed"]))
    return h
