"""Feature 19, the Pumpkin: a patch of pumpkins taking hits one at a time, the first living one over the whole patch.

Every pumpkin is a target of its color with its own health, but only one of a patch stands on the grid, covering all
the patch's cells (PumpkinFeature$$SetCurrentInstance, RVA 0x5762E00; PumpkinItemInstance$$OccupiesPoint, RVA
0x576946C). The others wait off the grid and cannot be aimed at. It is a hit target and no obstacle. When the
standing one dies the next living one in file order takes the cells at once, in the same step the killing shot lands
(the damage handler PumpkinFeature$$knw, RVA 0x5762AD8, calls AdvanceFromDeadCurrent, RVA 0x5762B84, which asks
TryGetNextAliveInstanceIndex, RVA 0x5763C64, for the first living one after it); the 0.05 s pop-in is a look. While a
shot that will kill the standing pumpkin is in flight it stays on the grid with a claim on it, so no pig aims at it and
the next one is not there yet. A pumpkin whose health is 0 starts dead (MarkDepletedInstancesDead, RVA 0x5762EF8). When
none are left the patch is gone. Every pumpkin counts toward its color's hits left (the health sum at RVA 0x5764DF0),
and the Super Unicorn can shoot a waiting one directly. web/sim/features/pumpkin.js mirrors this file.
"""

from __future__ import annotations

import typing as t

from .. import aim, base, checks, unicorn
from .. import grid as gridx

NUMBER = 19

# Where the Super Unicorn ranks a patch's pumpkins inside a tier: the standing one first, the waiting ones after
RANK_STANDING = 1
RANK_WAITING = 3


def setup(state: base.State) -> None:
    """Every patch as a record, in file order, with one target per pumpkin; the first living one stands on the cells."""
    listed = state.level.features.get("pumpkins")
    if not listed or not listed["Pumpkins"]:
        return
    grid = state.grid
    patches = []
    for data in listed["Pumpkins"]:
        cells = [
            gridx.cell_of(grid, point["X"], point["Y"])
            for point in data["GridPoints"]
            if 0 <= point["X"] < grid.width and 0 <= point["Y"] < grid.height
        ]
        items = []
        for item in data["Pumpkins"]:
            target = gridx.make_target(NUMBER, item["MaterialId"], item["Health"])
            target.dead = item["Health"] <= 0
            gridx.add(grid, target, [])
            items.append(target.id)
        patch = {"cells": cells, "items": items, "current": -1}
        patches.append(patch)
        advance(state, patch)
    state.features[NUMBER] = {"patches": patches}


def advance(state: base.State, patch: dict) -> bool:
    """Put the first living pumpkin after the standing one on the patch's cells. False when none is left."""
    grid = state.grid
    for index in range(patch["current"] + 1, len(patch["items"])):
        target = grid.targets[patch["items"][index]]
        if not target.dead:
            patch["current"] = index
            gridx.move(grid, target, patch["cells"])
            return True
    patch["current"] = len(patch["items"])
    return False


def patch_of(state: base.State, target_id: int) -> dict:
    return next(p for p in state.features[NUMBER]["patches"] if target_id in p["items"])


def on_hit(state: base.State, target: gridx.Target, damage: int, source: t.Any) -> None:
    """A shot lands on a pumpkin: it loses health, and at 0 it is gone; when it was the standing one the next living
    pumpkin takes its place at once, and the patch is gone with the last."""
    patch = patch_of(state, target.id)
    target.health = max(0, target.health - damage)
    cell = -1 if source is None else source.cell
    base.emit(state, "hit", {"target": target.id, "cell": cell, "health": target.health})
    if target.health > 0:
        return
    target.dead = True
    standing = patch["items"].index(target.id) == patch["current"]
    gridx.remove(state.grid, target)
    base.emit(state, "target_died", {"target": target.id, "owner": NUMBER})
    if standing:
        if advance(state, patch):
            base.emit(state, "pumpkin_next", {"target": patch["items"][patch["current"]], "from": target.id})
        else:
            base.emit(state, "pumpkin_patch_gone", {"target": target.id})
    checks.request_win_check(state)


def remaining_hits(state: base.State, color: int) -> int:
    """The hits the living pumpkins of this color still take, the waiting ones too."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return 0
    total = 0
    for patch in mine["patches"]:
        for target_id in patch["items"]:
            target = state.grid.targets[target_id]
            if not target.dead and target.color == color:
                total += target.health
    return total


def unicorn_rank(target: gridx.Target) -> int:  # noqa: ARG001
    """The Super Unicorn's rank of the standing pumpkin, which it finds as an ordinary feature target."""
    return RANK_STANDING


def unicorn_reserves(state: base.State, color: int) -> list[list]:
    """For the Super Unicorn: [target id, cells, tier, rank, hits] for every waiting pumpkin of this color, in the
    tier of its patch's cells (open, or blocked when some other obstacle stands on them)."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return []
    found = []
    for patch in mine["patches"]:
        tier = (
            unicorn.TIER_BLOCKED_FEATURE if unicorn.blocked_on(state, patch["cells"], -1) else unicorn.TIER_OPEN_FEATURE
        )
        for index, target_id in enumerate(patch["items"]):
            target = state.grid.targets[target_id]
            if index > patch["current"] and not target.dead and target.color == color:
                found.append([target_id, list(patch["cells"]), tier, RANK_WAITING, target.health])
    return found


def unicorn_reserve_left(state: base.State, target_id: int, color: int) -> int:
    """The hits the pumpkin takes while it still waits; 0 once it stands (the Unicorn then finds it on the grid)."""
    target = state.grid.targets[target_id]
    patch = patch_of(state, target_id)
    if target.dead or target.color != color or patch["items"].index(target_id) <= patch["current"]:
        return 0
    return target.health


def unicorn_pop(state: base.State, target_id: int, color: int) -> gridx.Target | None:  # noqa: ARG001
    """A Super Unicorn shot at a waiting pumpkin hits it where it waits. Nothing is left for the Unicorn to break."""
    aim.hit(state, state.grid.targets[target_id], 1, None)
    return None


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    h = base.mix(h, len(mine["patches"]))
    for patch in mine["patches"]:
        h = base.mix(base.mix(h, patch["current"]), len(patch["items"]))
        for target_id in patch["items"]:
            target = state.grid.targets[target_id]
            h = base.mix(base.mix(h, target.health), int(target.dead))
    return h
