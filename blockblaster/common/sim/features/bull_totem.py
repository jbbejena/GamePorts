"""Feature 25, the Bull Totem: a queue entry that never shoots and can't be tapped, worn down by every pig that leaves
a queue once the totem stands first in its own.

A totem is active from the start when it begins first in its queue, else from the first exit event that finds it
first (BullTotemFeature$$Start and CheckActivation, RVA 0x55B1FF0). While active, an exit event (pigs leaving a
queue) takes 1 off its count for every pig in it except the totem itself, all at once and not at all when the event
holds any other disabled entry (a lock, a hammer, a pipe, another totem), and never in the tick the totem became
active (OnShootersExitingQueue, RVA 0x55B266C: it compares the activation frame with the current one). Pigs sent from
slots leave no queue, so they don't count. At 0 the totem's entry vanishes like any pig and its queue moves up
(DestroySelf, RVA 0x55B1818, then MapInputEvents$$TriggerMakeShooterDisappear). While the totem is breaking it takes no
more events. During a booster the original reads its queue differently (countSyncPowerupChannels); the game is
stopped while a booster works, so the remake keeps one rule. A totem standing at a queue front blocks the level as
"totem"; the revive destroys every totem first in its queue, queue by queue (MapRescueController.<DestroyFirstBullTotems>
d__25, which calls BullTotemFeature$$Rescue, a jump to DestroySelf). web/sim/features/bull_totem.js mirrors this file.
"""

from __future__ import annotations

from .. import base, places

NUMBER = 25


def setup(state: base.State) -> None:
    """Every totem as a record, in file order, with its count. A totem that starts first in its queue is active from
    the start, before any tick (the original activates it in Start)."""
    listed = state.level.features.get("BullTotems")
    if not listed:
        return
    totems = []
    for data in listed["Totems"]:
        pig = state.pigs.get(data["ShooterId"])
        if pig is None:
            continue
        pig.tags.extend(["disabled", "untappable"])
        totems.append(
            {
                "pig": pig.id,
                "start": data["Count"],
                "count": data["Count"],
                "active": first_in_queue(state, pig.id),
                "since": -1,
                "done": False,
            }
        )
    if totems:
        state.features[NUMBER] = {"totems": totems}


def first_in_queue(state: base.State, pig_id: int) -> bool:
    return any(queue and queue[0] == pig_id for queue in state.queues)


def record(state: base.State, pig_id: int) -> dict | None:
    """The totem record of an entry that is still standing, else None."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return None
    for totem in mine["totems"]:
        if totem["pig"] == pig_id and not totem["done"]:
            return totem
    return None


def activate(state: base.State, totem: dict) -> None:
    """CheckActivation: a totem that is first in its queue becomes active."""
    if totem["active"] or not first_in_queue(state, totem["pig"]):
        return
    totem["active"] = True
    totem["since"] = state.tick
    base.emit(state, "totem_activated", {"pig": totem["pig"]})


def destroy(state: base.State, totem: dict, why: str) -> None:
    """DestroySelf: the totem takes no more events and its entry vanishes."""
    totem["done"] = True
    base.emit(state, "totem_broken", {"pig": totem["pig"], "why": why})
    places.vanish(state, state.pigs[totem["pig"]], "totem")


def chips_of(state: base.State, totem: dict, data: dict) -> int:
    """How many pigs of this exit event wear the totem down: every pig that left a level queue except the totem
    itself, or 0 for the whole event when it holds any other disabled entry."""
    chips = 0
    for pig_id, queue in zip(data["ids"], data["queues"], strict=True):
        if pig_id == totem["pig"]:
            continue
        if "disabled" in state.pigs[pig_id].tags:
            return 0
        if queue >= 0:
            chips += 1
    return chips


def on_exit(state: base.State, totem: dict, data: dict) -> None:
    """OnShootersExitingQueue for one totem."""
    if totem["done"]:
        return
    if not totem["active"]:
        activate(state, totem)
        return
    if totem["since"] == state.tick:
        return
    chips = chips_of(state, totem, data)
    if chips == 0:
        return
    totem["count"] = max(0, totem["count"] - chips)
    base.emit(state, "totem_hit", {"pig": totem["pig"], "health": totem["count"], "chips": chips})
    if totem["count"] == 0:
        destroy(state, totem, "count")


def on_event(state: base.State, name: str, data: dict) -> None:
    mine = state.features.get(NUMBER)
    if mine is None or name != "pigs_exit_queue":
        return
    for totem in mine["totems"]:
        on_exit(state, totem, data)


def blocker(state: base.State, pig: base.Pig) -> str | None:
    if record(state, pig.id) is not None:
        return "totem"
    return None


def revive(state: base.State, name: str) -> int:
    """The Bull totem revive destroys every totem first in its queue, queue by queue; the fronts are read before the
    first one goes. Returns the ticks the revive waits (none: the original only yields a frame)."""
    if name != "totem" or NUMBER not in state.features:
        return 0
    fronts = [queue[0] for queue in state.queues if queue]
    for pig_id in fronts:
        totem = record(state, pig_id)
        if totem is not None:
            destroy(state, totem, "revive")
    return 0


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    h = base.mix(h, len(mine["totems"]))
    for totem in mine["totems"]:
        h = base.mix(base.mix(h, totem["pig"]), totem["count"])
        h = base.mix(base.mix(h, int(totem["active"])), totem["since"])
        h = base.mix(h, int(totem["done"]))
    return h
