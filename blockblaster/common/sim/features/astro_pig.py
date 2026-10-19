"""Feature 32, the Astro Pig and its Spaceship: an obstacle over a patch of cubes that leaves when an astro pig of its
color runs dry.

Astro pigs are ordinary pigs of the queues, listed by id in AstronautShooters, and carry the tag "astro". They shoot and
drop into slots like any pig. When one runs dry the spaceship of its color with an empty seat takes it instead of the
vanish: the first ship in file order whose seat is free (SpaceshipFeature$$CanHandleShooterDisappear, RVA 0x57CECE8; the
seat check's second type is read as "the pig carries the astro feature and is no disabled entry", like the U.F.O.
check, open O14). The pig still leaves the game as a vanished pig, so frozen pigs and the auto-finisher count it. The
ship leaves the grid once the pig's place jump has landed, ASTRO_PLACE_JUMP ticks later
(SpaceshipModel placeDuration; <PlayLaunchAnimation>d__48$$MoveNext, RVA 0x57CB870), and its cells are free then. While
a ship waits to launch, the stuck check waits (FailCheckDelayCondition: a spaceship launching). A second astro pig of
that color finds the seat taken and vanishes normally. The ship is an obstacle and is never shot. It is an
IRemovablePixelGridObstacle, so the Spaceship revive and the Obstacles revive take every standing ship off the grid at
once. web/sim/features/astro_pig.js mirrors this file.
"""

from __future__ import annotations

from .. import base
from .. import grid as gridx
from ..numbers import ASTRO_PLACE_JUMP

NUMBER = 32

# Pigs a spaceship refuses: anything that is not an astro pig, and a disabled entry
TAG = "astro"
REFUSED = "disabled"


def setup(state: base.State) -> None:
    """Tag the astro pigs, and put every spaceship on its cells as an obstacle, in file order."""
    listed = state.level.features.get("AstronautShooters")
    for pig_id in listed["Shooters"] if listed else []:
        state.pigs[pig_id].tags.append(TAG)
    ships = state.level.features.get("spaceships")
    if not ships or not ships["Spaceships"]:
        return
    grid = state.grid
    records = []
    for data in ships["Spaceships"]:
        cells = [
            gridx.cell_of(grid, point["X"], point["Y"])
            for point in data["GridPoints"]
            if 0 <= point["X"] < grid.width and 0 <= point["Y"] < grid.height
        ]
        body = gridx.make_target(NUMBER, -1, 1, obstacle=True, hittable=False)
        gridx.add(grid, body, cells)
        records.append({"target": body.id, "cells": cells, "color": data["Material"], "pig": -1})
    state.features[NUMBER] = {"ships": records}


def standing(state: base.State, ship: dict) -> bool:
    return not state.grid.targets[ship["target"]].dead


def take_vanish(state: base.State, pig: base.Pig) -> bool:
    """An astro pig is about to vanish: it takes the seat of the first standing ship of its color that has one, and the
    ship launches once the pig has landed. Never takes the vanish over."""
    mine = state.features.get(NUMBER)
    if mine is None or TAG not in pig.tags or REFUSED in pig.tags:
        return False
    for index, ship in enumerate(mine["ships"]):
        if standing(state, ship) and ship["pig"] < 0 and ship["color"] == pig.color:
            ship["pig"] = pig.id
            base.schedule(state, ASTRO_PLACE_JUMP, "ship_launch", index)
            base.emit(
                state,
                "ship_seat",
                {"ship": index, "pig": pig.id, "color": pig.color, "land": state.tick + ASTRO_PLACE_JUMP},
            )
            return False
    return False


def ship_launch(state: base.State, index: int) -> None:
    """Timer: the pig has landed and the ship takes off, unless a revive already took it."""
    launch(state, index, "pig")


def launch(state: base.State, index: int, why: str) -> None:
    """The ship is gone from the picture and its cells are free at once. The hit event makes keys and Surprise Pixels
    look at the picture again. Its flight is drawn by the page."""
    ship = state.features[NUMBER]["ships"][index]
    body = state.grid.targets[ship["target"]]
    if body.dead:
        return
    body.health = 0
    body.dead = True
    gridx.remove(state.grid, body)
    base.emit(state, "ship_launch", {"ship": index, "target": body.id, "why": why})
    base.emit(state, "hit", {"target": body.id, "cell": -1, "health": 0})


base.register_timer("ship_launch", base.PHASE_FEATURES, ship_launch)


def busy(state: base.State) -> bool:
    """A ship with its astro pig on the way holds the stuck check until it has launched."""
    mine = state.features.get(NUMBER)
    return mine is not None and any(standing(state, ship) and ship["pig"] >= 0 for ship in mine["ships"])


def fail_counts(state: base.State) -> dict[str, int]:
    """The stuck fail's name counts the spaceships still standing."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return {}
    return {"spaceship": sum(1 for ship in mine["ships"] if standing(state, ship))}


def revive(state: base.State, name: str) -> int:
    """The Spaceship and Obstacles revives launch every standing ship, in file order. Returns the ticks the revive
    waits (none)."""
    mine = state.features.get(NUMBER)
    if name not in ("spaceship", "obstacles") or mine is None:
        return 0
    for index, ship in enumerate(mine["ships"]):
        if standing(state, ship):
            launch(state, index, "revive")
    return 0


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    h = base.mix(h, len(mine["ships"]))
    for ship in mine["ships"]:
        h = base.mix(base.mix(h, int(not standing(state, ship))), ship["pig"])
    return h
