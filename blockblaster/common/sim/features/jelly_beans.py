"""Feature 24, Jelly Beans: a box of beans holding one hit target per color group, each covering the whole box.

A group is a target of its color with the health TotalHealth, standing on every cell of the box
(BeanGroupInstance$$get_OccupiedPoints, RVA 0x55A1304, returns the box's own point set; BeanGroupInstance$$Setup, RVA
0x55A0280, takes the health from the group data). It is a hit target and no obstacle. A pig hits any living group of
its color; a group's damage handler (BeanGroupInstance$$OnHitTargetDamaged, RVA 0x55A0144, calls
BeanBoxFeature$$OnGroupDamaged, RVA 0x5591C68) counts the dead ones, and the box is gone with the last (a count of
living groups at 0 detaches it). A group whose health is 0 gets no instance (BeanBoxFeature$$AttachInternal, RVA
0x55947BC). BeanCount and BeanScale only size the drawn beans. web/sim/features/jelly_beans.js mirrors this file.
"""

from __future__ import annotations

import typing as t

from .. import base, checks
from .. import grid as gridx

NUMBER = 24


def setup(state: base.State) -> None:
    """Every box as a record in file order, with one target per group that has health, all on the box's cells."""
    listed = state.level.features.get("beanBoxes")
    if not listed or not listed["BeanBoxes"]:
        return
    grid = state.grid
    boxes = []
    for data in listed["BeanBoxes"]:
        cells = [
            gridx.cell_of(grid, point["X"], point["Y"])
            for point in data["GridPoints"]
            if 0 <= point["X"] < grid.width and 0 <= point["Y"] < grid.height
        ]
        groups = []
        for group in data["Groups"]:
            if group["TotalHealth"] <= 0:
                continue
            target = gridx.make_target(NUMBER, group["MaterialId"], group["TotalHealth"])
            gridx.add(grid, target, cells)
            groups.append(target.id)
        boxes.append({"cells": cells, "groups": groups})
    state.features[NUMBER] = {"boxes": boxes}


def on_hit(state: base.State, target: gridx.Target, damage: int, source: t.Any) -> None:
    """A shot lands on a group: it loses health and at 0 it leaves the grid; the box is gone with its last group."""
    target.health = max(0, target.health - damage)
    cell = -1 if source is None else source.cell
    base.emit(state, "hit", {"target": target.id, "cell": cell, "health": target.health})
    if target.health > 0:
        return
    target.dead = True
    gridx.remove(state.grid, target)
    base.emit(state, "target_died", {"target": target.id, "owner": NUMBER})
    boxes = state.features[NUMBER]["boxes"]
    index = next(i for i, box in enumerate(boxes) if target.id in box["groups"])
    if all(state.grid.targets[group].dead for group in boxes[index]["groups"]):
        base.emit(state, "bean_box_gone", {"box": index})
    checks.request_win_check(state)


def remaining_hits(state: base.State, color: int) -> int:
    """The hits the living groups of this color still take."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return 0
    total = 0
    for box in mine["boxes"]:
        for group in box["groups"]:
            target = state.grid.targets[group]
            if not target.dead and target.color == color:
                total += target.health
    return total


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    h = base.mix(h, len(mine["boxes"]))
    for box in mine["boxes"]:
        h = base.mix(h, len(box["groups"]))
        for group in box["groups"]:
            target = state.grid.targets[group]
            h = base.mix(base.mix(h, target.health), int(target.dead))
    return h
