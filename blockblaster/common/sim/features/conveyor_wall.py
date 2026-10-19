"""Feature 33, the Conveyor Wall: a wall across the belt that lets pigs of its color through and throws the rest off.

Each wall stands at a lap percent (`Percent`, 0 at the start point and 1 at the clip end) and checks trays at a point
CONVEYOR_WALL_LEAD before it (ConveyorDoorFeature$$AttachInternal, RVA 0x5600BA8, through
ConveyorController$$GetPathPercentBefore). A tray crossing that point passes when its pig is the wall's color, or is in
a Connected group with a member of that color (ConveyorDoorFeature$$EvaluateEject, RVA 0x55FB52C); every pig of the
wall's color that passes takes 1 health off it, and at 0 the wall opens and is gone (NotifyItemPassed, RVA 0x55FDD30).
Any other pig is thrown off the belt, the same as reaching the lap's end (belt.process_ejects): it takes the first free
slot, flying there in WALL_EJECT_JUMP ticks (the wall handles the placing, HandleShooterJump), or waits at the exit and
fails "Out of space" after the grace. The belt checks no gates while the auto-finisher runs. A frame after a pig is
about to vanish or the stuck check's repair trims ammo, every wall whose color has no pig with ammo left opens by
itself (ConveyorDoorFeatureController$$Evaluate, RVA 0x56227B8; HasAmmoSupply, RVA 0x56228D4). Walls are no grid
targets: they never block shots. web/sim/features/conveyor_wall.js mirrors this file.
"""

from __future__ import annotations

from .. import base, belt, checks, places
from ..numbers import CONVEYOR_WALL_LEAD, WALL_EJECT_JUMP

NUMBER = 33


def setup(state: base.State) -> None:
    """Every wall in file order with the lap position it stands at and the one it checks at, and the order the belt
    checks them in (by check point, ConveyorController$$RefreshGateBuffer sorts its gates)."""
    listed = state.level.features.get("ConveyorDoors")
    if not listed or not listed["Doors"]:
        return
    walls = []
    for data in listed["Doors"]:
        # The level file's percent as whole millionths, the same in both languages
        pos = belt.lap_at_percent(state, int(data["Percent"] * 1_000_000 + 0.5))
        walls.append(
            {
                "color": data["Material"],
                "start": data["Health"],
                "health": data["Health"],
                "pos": pos,
                "trigger": max(0, pos - CONVEYOR_WALL_LEAD),
                "open": data["Health"] <= 0,
                "thrown": [],
            }
        )
    order = sorted(range(len(walls)), key=lambda index: walls[index]["trigger"])
    state.features[NUMBER] = {"walls": walls, "order": order, "pending": False}


def gate(state: base.State, tray: base.Tray, old: int) -> bool:
    """The tray ran from old to its pos: each wall whose check point it crossed lets its pig pass or throws it off.
    True when a wall throws it off; the walls after that one don't see it (ConveyorController$$CheckGates)."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return False
    pig = state.pigs[tray.pig]
    for index in mine["order"]:
        wall = mine["walls"][index]
        if not old < wall["trigger"] <= tray.pos:
            continue
        if rejects(state, index, pig):
            return True
        passed(state, index, pig)
    return False


def matches(state: base.State, wall: dict, pig: base.Pig) -> bool:
    """The pig is the wall's color, or is in a Connected group with a member of that color still in play."""
    for pig_id in places.batch_of(state, pig):
        member = state.pigs[pig_id]
        if member.place != "gone" and member.color == wall["color"]:
            return True
    return False


def rejects(state: base.State, index: int, pig: base.Pig) -> bool:
    """A standing wall throws off a pig that doesn't match it, and remembers it until it lands in a slot
    (ConveyorDoorFeature$$ShouldEject, RVA 0x55FF32C)."""
    wall = state.features[NUMBER]["walls"][index]
    if wall["open"] or wall["health"] < 1 or matches(state, wall, pig):
        return False
    if pig.id not in wall["thrown"]:
        wall["thrown"].append(pig.id)
    base.emit(state, "wall_reject", {"wall": index, "pig": pig.id})
    return True


def passed(state: base.State, index: int, pig: base.Pig) -> None:
    """A pig went through a standing wall: one of its color takes 1 health off it, and at 0 the wall opens."""
    wall = state.features[NUMBER]["walls"][index]
    if wall["open"] or wall["health"] < 1 or pig.color != wall["color"]:
        return
    wall["health"] -= 1
    base.emit(state, "wall_pass", {"wall": index, "pig": pig.id, "health": wall["health"]})
    if wall["health"] <= 0:
        open_wall(state, index, "pass")


def open_wall(state: base.State, index: int, cause: str) -> None:
    wall = state.features[NUMBER]["walls"][index]
    if wall["open"]:
        return
    wall["open"] = True
    base.emit(state, "wall_open", {"wall": index, "cause": cause})


def slot_hop(state: base.State, pig: base.Pig) -> int | None:
    """A pig a wall threw off flies to its slot on the wall's own jump (ConveyorDoorFeature$$CanHandleShooterPlace,
    RVA 0x5600184, and HandleShooterJump, which forgets the pig)."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return None
    for wall in mine["walls"]:
        if pig.id in wall["thrown"]:
            wall["thrown"].remove(pig.id)
            return WALL_EJECT_JUMP
    return None


def on_event(state: base.State, name: str, data: dict) -> None:  # noqa: ARG001
    """A pig is about to vanish, or the repair trimmed ammo: look at every wall's ammo supply next frame, once
    (ConveyorDoorFeatureController$$ScheduleEvaluation, RVA 0x5622784, waits a frame with UniTask.Yield)."""
    mine = state.features.get(NUMBER)
    if mine is None or name not in ("pig_vanishing", "ammo_trimmed") or mine["pending"]:
        return
    mine["pending"] = True
    base.schedule(state, 1, "wall_supply", None)


def wall_supply(state: base.State, args: None) -> None:  # noqa: ARG001
    """Timer: every standing wall whose color no pig on the map has ammo for opens by itself."""
    mine = state.features[NUMBER]
    mine["pending"] = False
    for index, wall in enumerate(mine["walls"]):
        if wall["health"] >= 1 and not has_supply(state, wall["color"]):
            open_wall(state, index, "supply")


def has_supply(state: base.State, color: int) -> bool:
    """Some pig on the map of this color has ammo left (ShooterProvider$$GetShootersWithMaterial)."""
    return any(pig.color == color and pig.ammo >= 1 for pig in checks.ammo_pigs(state))


# The original's deferred evaluation resumes before every script's Update, so it lands at the start of a tick
base.register_timer("wall_supply", base.PHASE_TAPS, wall_supply)


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    return base.mix(mix_walls(mine["walls"], h), int(mine["pending"]))


def mix_walls(walls: list[dict], h: int) -> int:
    h = base.mix(h, len(walls))
    for wall in walls:
        h = base.mix(base.mix(base.mix(h, wall["health"]), int(wall["open"])), len(wall["thrown"]))
        for pig_id in wall["thrown"]:
            h = base.mix(h, pig_id)
    return h
