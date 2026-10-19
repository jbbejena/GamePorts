"""Feature 18, U.F.O.s: an obstacle over a patch of cubes with four colored seats, filled by pigs that run dry.

A pig that runs dry anywhere, unless it is an astro pig or a disabled entry (a hammer, a lock, a pipe entry), takes the
first empty seat of its color instead of vanishing: the first U.F.O. in file order that has one, and its first such seat
(IShooterDisappearHandlerAttachable$$FindHandler, RVA 0x578CDCC, takes the first attachable whose
UfoFeature$$CanHandleShooterDisappear, RVA 0x580B0D0, says yes; UfoModel$$TryPlaceShooter, RVA 0x5810E80, finds the
first empty seat of the shooter's color). The seat is taken at once, and the pig still leaves the game as a vanished
pig (MapController$$MakeShooterDisappear, RVA 0x58CF424, removes it from its place and raises the vanish before
looking for a handler), so frozen pigs and the auto-finisher count it. When every seat is full the U.F.O. leaves the
grid at once and its cells are free (UfoFeature$$TryPlaceShooter, RVA 0x580908C, starts LaunchUfo, RVA 0x5809C40, whose
<LaunchUfo>d__36$$MoveNext, RVA 0x580E714, detaches it before its flight animation); nothing waits for the flight.
The U.F.O. is an IRemovablePixelGridObstacle whose RemoveObstacle (RVA 0x580B9A0) is the same launch, so both the
"UFO Block!" revive (MapRescueController.<RemoveUfos>d__26) and the Obstacles revive launch every standing one. Shots
never hit a U.F.O. web/sim/features/ufo.js mirrors this file.
"""

from __future__ import annotations

from .. import base
from .. import grid as gridx

NUMBER = 18

# Pigs a U.F.O. refuses (a disabled entry; the Astro Pig's tag is added by its own feature)
REFUSED = ("disabled", "astro")


def setup(state: base.State) -> None:
    """Every U.F.O. as a record, in file order, with its body standing on its cells as an obstacle."""
    listed = state.level.features.get("ufos")
    if not listed or not listed["Ufos"]:
        return
    grid = state.grid
    ufos = []
    for data in listed["Ufos"]:
        cells = [
            gridx.cell_of(grid, point["X"], point["Y"])
            for point in data["GridPoints"]
            if 0 <= point["X"] < grid.width and 0 <= point["Y"] < grid.height
        ]
        body = gridx.make_target(NUMBER, -1, 1, obstacle=True, hittable=False)
        gridx.add(grid, body, cells)
        seats = [{"color": seat["Material"], "pig": -1} for seat in data["Seats"]]
        ufos.append({"target": body.id, "cells": cells, "seats": seats})
    state.features[NUMBER] = {"ufos": ufos}


def standing(state: base.State, ufo: dict) -> bool:
    return not state.grid.targets[ufo["target"]].dead


def take_vanish(state: base.State, pig: base.Pig) -> bool:
    """A pig is about to vanish: it fills the first empty seat of its color, and the U.F.O. leaves when that was its
    last empty seat. Never takes the vanish over."""
    mine = state.features.get(NUMBER)
    if mine is None or any(tag in pig.tags for tag in REFUSED):
        return False
    for index, ufo in enumerate(mine["ufos"]):
        if not standing(state, ufo):
            continue
        for seat_index, seat in enumerate(ufo["seats"]):
            if seat["pig"] < 0 and seat["color"] == pig.color:
                seat["pig"] = pig.id
                base.emit(state, "ufo_seat", {"ufo": index, "seat": seat_index, "pig": pig.id, "color": pig.color})
                if all(other["pig"] >= 0 for other in ufo["seats"]):
                    launch(state, index, "full")
                return False
    return False


def launch(state: base.State, index: int, why: str) -> None:
    """The U.F.O. is gone from the picture and its cells are free at once. The hit event makes keys and Surprise Pixels
    look at the picture again. Its flight is drawn by the page."""
    body = state.grid.targets[state.features[NUMBER]["ufos"][index]["target"]]
    body.health = 0
    body.dead = True
    gridx.remove(state.grid, body)
    base.emit(state, "ufo_launch", {"ufo": index, "target": body.id, "why": why})
    base.emit(state, "hit", {"target": body.id, "cell": -1, "health": 0})


def fail_counts(state: base.State) -> dict[str, int]:
    """The stuck fail's name counts the U.F.O.s still standing."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return {}
    return {"ufo": sum(1 for ufo in mine["ufos"] if standing(state, ufo))}


def revive(state: base.State, name: str) -> int:
    """The UFO Block! and Obstacles revives launch every standing U.F.O., in file order. Returns the ticks the revive
    waits (none)."""
    mine = state.features.get(NUMBER)
    if name not in ("ufo", "obstacles") or mine is None:
        return 0
    for index, ufo in enumerate(mine["ufos"]):
        if standing(state, ufo):
            launch(state, index, "revive")
    return 0


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    h = base.mix(h, len(mine["ufos"]))
    for ufo in mine["ufos"]:
        h = base.mix(h, int(state.grid.targets[ufo["target"]].dead))
        for seat in ufo["seats"]:
            h = base.mix(base.mix(h, seat["color"]), seat["pig"])
    return h
