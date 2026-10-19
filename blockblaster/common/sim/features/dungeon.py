"""Feature 29, the Dungeon: a cage over empty cells with a cat inside, shot down by the color on the cage; the cat joins
the rescue queue once the cage is gone.

A dungeon is a hit target of the cage's Material (not the cat's color) with the cage's Health, standing on its cells,
and no obstacle. The cat inside is a cat of the level from the start (its own color and ammo, ids from 20000), held
where no rule reaches it. When the cage's health reaches 0 it plays its death, waits DUNGEON_WAIT ticks, and then the
cat, if it has ammo, jumps for RESCUE_JUMP ticks and joins the back of the rescue queue (ColoredShooterCageFeature
.<HandleDeathAsync>d__73$$MoveNext, RVA 0x55C7ED8; ReleaseCagedShooter, RVA 0x55C3584). While it waits and jumps the
cat still counts as a live pig, and it holds the stuck check so the level isn't called stuck with a rescue on its way.
web/sim/features/dungeon.js mirrors this file.
"""

from __future__ import annotations

import typing as t

from .. import base, checks
from .. import grid as gridx
from ..numbers import DUNGEON_WAIT, RESCUE_JUMP

NUMBER = 29


def setup(state: base.State) -> None:
    """Every dungeon as a record in file order, with its cage target and its cat held."""
    listed = state.level.features.get("coloredShooterCages")
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
        target = gridx.make_target(NUMBER, data["Material"], data["Health"])
        gridx.add(grid, target, cells)
        cages.append({"target": target.id, "pig": shooter["id"], "start": data["Health"], "freed": False})
    state.features[NUMBER] = {"cages": cages, "waits": [], "flights": []}


def on_hit(state: base.State, target: gridx.Target, damage: int, source: t.Any) -> None:
    """A shot lands on a cage: it loses health and at 0 it leaves the grid; its cat is freed after the wait."""
    target.health = max(0, target.health - damage)
    cell = -1 if source is None else source.cell
    base.emit(state, "hit", {"target": target.id, "cell": cell, "health": target.health})
    if target.health > 0:
        return
    target.dead = True
    gridx.remove(state.grid, target)
    mine = state.features[NUMBER]
    index = next(i for i, cage in enumerate(mine["cages"]) if cage["target"] == target.id)
    pig_id = mine["cages"][index]["pig"]
    mine["waits"].append(pig_id)
    base.schedule(state, DUNGEON_WAIT, "dungeon_open", index)
    base.emit(state, "target_died", {"target": target.id, "owner": NUMBER})
    base.emit(state, "dungeon_dead", {"cage": index, "pig": pig_id})
    checks.request_win_check(state)


def dungeon_open(state: base.State, index: int) -> None:
    """Timer: the wait is over. A cat with ammo starts its jump to the rescue queue; one without is simply gone."""
    mine = state.features[NUMBER]
    cage = mine["cages"][index]
    pig = state.pigs[cage["pig"]]
    mine["waits"].remove(cage["pig"])
    cage["freed"] = True
    if pig.ammo <= 0:
        pig.place = "gone"
        checks.request_win_check(state)
        return
    land = state.tick + RESCUE_JUMP
    mine["flights"].append([pig.id, land])
    base.schedule(state, RESCUE_JUMP, "dungeon_land", pig.id)
    base.emit(state, "dungeon_free", {"cage": index, "pig": pig.id, "land": land})


def dungeon_land(state: base.State, pig_id: int) -> None:
    """Timer: the cat has landed and joins the back of the rescue queue."""
    mine = state.features[NUMBER]
    mine["flights"] = [flight for flight in mine["flights"] if flight[0] != pig_id]
    pig = state.pigs[pig_id]
    pig.place = "rescue"
    state.rescue.append(pig_id)
    base.emit(state, "to_rescue", {"pig": pig_id, "index": len(state.rescue) - 1, "from": "cage"})


base.register_timer("dungeon_open", base.PHASE_FEATURES, dungeon_open)
base.register_timer("dungeon_land", base.PHASE_FEATURES, dungeon_land)


def busy(state: base.State) -> bool:
    """A cat waiting in a broken cage or jumping out of it holds the stuck check."""
    mine = state.features.get(NUMBER)
    return mine is not None and bool(mine["waits"] or mine["flights"])


def remaining_hits(state: base.State, color: int) -> int:
    """The hits the standing cages of this color still take."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return 0
    total = 0
    for cage in mine["cages"]:
        target = state.grid.targets[cage["target"]]
        if not target.dead and target.color == color:
            total += target.health
    return total


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    for cage in mine["cages"]:
        target = state.grid.targets[cage["target"]]
        h = base.mix(base.mix(h, target.health), int(target.dead))
        h = base.mix(h, int(cage["freed"]))
    h = base.mix(h, len(mine["waits"]))
    for pig_id in mine["waits"]:
        h = base.mix(h, pig_id)
    h = base.mix(h, len(mine["flights"]))
    for pig_id, land in mine["flights"]:
        h = base.mix(base.mix(h, pig_id), land)
    return h
