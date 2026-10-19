"""Feature 31, the Pigroshka: a nest of dolls on a square of empty cells, shot one layer at a time from the outside in.

A doll lists its layers with the outermost one LAST (MatryoshkaFeature, get_ConsumedLayerCount, RVA 0x5684EA0;
GetNextAliveLayerIndex, RVA 0x5683D80). Every layer is a hit target of its own color and health, but only the
outermost living one stands on the grid, over a centered square of side max(S - 2k, 3 if S is odd else 4) after k
layers have gone (GetCurrentSize, RVA 0x5682CAC) with S the side the doll started with. When the standing layer dies the
next one inside opens at once (OpenNextLayer, RVA 0x5683E0C) and the square shrinks, so the ring of cells between the
two squares is free; after the last layer the doll is gone and nothing is left inside. A doll is a hit target and no
obstacle, and every layer counts toward its color's hits left. The cells a doll stands on hold no cubes. While a shot
that will kill the standing layer is in flight it stays on the grid with a claim on it, as a Pumpkin does.
web/sim/features/pigroshka.js mirrors this file.
"""

from __future__ import annotations

import typing as t

from .. import aim, base, checks, unicorn
from .. import grid as gridx

NUMBER = 31

# Where the Super Unicorn ranks a doll's layers inside a tier: the standing one first, the ones inside after
RANK_STANDING = 2
RANK_WAITING = 4


def square_cells(grid: gridx.Grid, doll: dict, consumed: int) -> list[int]:
    """The doll's cells when `consumed` layers have gone: the centered square of the shrunken side, in the order the
    level listed them."""
    start = doll["side"]
    side = max(start - 2 * consumed, 3 if start % 2 == 1 else 4)
    trim = (start - side) // 2
    low_x, low_y = doll["low"]
    return [
        cell
        for cell in doll["cells"]
        if low_x + trim <= cell % grid.width < low_x + trim + side
        and low_y + trim <= cell // grid.width < low_y + trim + side
    ]


def setup(state: base.State) -> None:
    """Every doll as a record in file order, one target per layer; the outermost living one stands on the cells."""
    listed = state.level.features.get("matryoshkas")
    if not listed or not listed["Matryoshkas"]:
        return
    grid = state.grid
    dolls = []
    for data in listed["Matryoshkas"]:
        points = [p for p in data["GridPoints"] if 0 <= p["X"] < grid.width and 0 <= p["Y"] < grid.height]
        cells = [gridx.cell_of(grid, p["X"], p["Y"]) for p in points]
        layers = []
        for item in data["Layers"]:
            target = gridx.make_target(NUMBER, item["MaterialId"], item["Health"])
            target.dead = item["Health"] <= 0
            gridx.add(grid, target, [])
            layers.append(target.id)
        low_x = min(p["X"] for p in points)
        low_y = min(p["Y"] for p in points)
        doll = {
            "cells": cells,
            "layers": layers,
            "side": max(p["X"] for p in points) - low_x + 1,
            "low": [low_x, low_y],
            "current": len(layers),
        }
        dolls.append(doll)
        advance(state, doll)
    state.features[NUMBER] = {"dolls": dolls}


def consumed(state: base.State, doll: dict) -> int:
    """Layers gone so far."""
    return sum(1 for target_id in doll["layers"] if state.grid.targets[target_id].dead)


def advance(state: base.State, doll: dict) -> bool:
    """Stand the outermost living layer below the current one on the doll's shrunken square. False when none is left
    (the doll is gone)."""
    grid = state.grid
    for index in range(doll["current"] - 1, -1, -1):
        target = grid.targets[doll["layers"][index]]
        if not target.dead:
            doll["current"] = index
            gridx.move(grid, target, square_cells(grid, doll, consumed(state, doll)))
            return True
    doll["current"] = -1
    return False


def doll_of(state: base.State, target_id: int) -> tuple[int, dict]:
    for index, doll in enumerate(state.features[NUMBER]["dolls"]):
        if target_id in doll["layers"]:
            return index, doll
    raise KeyError(target_id)


def on_hit(state: base.State, target: gridx.Target, damage: int, source: t.Any) -> None:
    """A shot lands on a layer: it loses health and at 0 it is gone; when it was the standing one the next layer inside
    opens at once and the square shrinks, and the doll is gone with the last layer."""
    index, doll = doll_of(state, target.id)
    target.health = max(0, target.health - damage)
    cell = -1 if source is None else source.cell
    base.emit(state, "hit", {"target": target.id, "cell": cell, "health": target.health})
    if target.health > 0:
        return
    standing = doll["layers"].index(target.id) == doll["current"]
    target.dead = True
    gridx.remove(state.grid, target)
    base.emit(state, "target_died", {"target": target.id, "owner": NUMBER})
    if not standing:
        checks.request_win_check(state)
        return
    if advance(state, doll):
        inner = doll["layers"][doll["current"]]
        base.emit(state, "doll_open", {"doll": index, "layer": doll["current"], "from": target.id, "target": inner})
        base.emit(state, "hit", {"target": inner, "cell": -1, "health": state.grid.targets[inner].health})
    else:
        base.emit(state, "doll_gone", {"doll": index, "target": target.id})
    checks.request_win_check(state)


def remaining_hits(state: base.State, color: int) -> int:
    """The hits the living layers of this color still take, the ones inside too."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return 0
    total = 0
    for doll in mine["dolls"]:
        for target_id in doll["layers"]:
            target = state.grid.targets[target_id]
            if not target.dead and target.color == color:
                total += target.health
    return total


def unicorn_rank(target: gridx.Target) -> int:  # noqa: ARG001
    """The Super Unicorn's rank of the standing layer, which it finds as an ordinary feature target."""
    return RANK_STANDING


def unicorn_reserves(state: base.State, color: int) -> list[list]:
    """For the Super Unicorn: [target id, cells, tier, rank, hits] for every layer of this color inside the standing
    one, on the cells the doll stands on now."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return []
    found = []
    for doll in mine["dolls"]:
        if doll["current"] < 0:
            continue
        cells = list(state.grid.targets[doll["layers"][doll["current"]]].cells)
        tier = unicorn.TIER_BLOCKED_FEATURE if unicorn.blocked_on(state, cells, -1) else unicorn.TIER_OPEN_FEATURE
        for index in range(doll["current"] - 1, -1, -1):
            target = state.grid.targets[doll["layers"][index]]
            if not target.dead and target.color == color:
                found.append([target.id, cells, tier, RANK_WAITING, target.health])
    return found


def unicorn_reserve_left(state: base.State, target_id: int, color: int) -> int:
    """The hits the layer takes while it waits inside; 0 once it stands (the Unicorn then finds it on the grid)."""
    target = state.grid.targets[target_id]
    _, doll = doll_of(state, target_id)
    if target.dead or target.color != color or doll["layers"].index(target_id) >= doll["current"]:
        return 0
    return target.health


def unicorn_pop(state: base.State, target_id: int, color: int) -> gridx.Target | None:  # noqa: ARG001
    """A Super Unicorn shot at a waiting layer hits it where it waits. Nothing is left for the Unicorn to break."""
    aim.hit(state, state.grid.targets[target_id], 1, None)
    return None


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    h = base.mix(h, len(mine["dolls"]))
    for doll in mine["dolls"]:
        h = base.mix(base.mix(h, doll["current"]), len(doll["layers"]))
        for target_id in doll["layers"]:
            target = state.grid.targets[target_id]
            h = base.mix(base.mix(h, target.health), int(target.dead))
    return h
