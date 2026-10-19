"""Feature 30, the Slot Cage: a cage over one of the slots, opened by destroying cubes of its color anywhere.

A cage blocks its slot while its health is above 0 (SlotCageFeature$$get_BlocksSlot, RVA 0x57AA564). Every destroyed
single-cell cube of the cage's color gives it 1 damage, pending at once and landing CUBE_FLY_IN ticks later
(SlotCageFeature$$OnTargetDeath, RVA 0x57A9448); the cage opens at the moment its pending damage covers all its health
left (Unlock, RVA 0x57A9620), not when the last copy lands. The caged slots are always the first ones (SlotIndex 0 to
k - 1 in every level), and when a cage opens the remaining cages and the pigs pack left again (places.arrange_slots,
the cages moving in a 0.25 s jump), so the blocked slots stay the leftmost. A slot a cage has opened is free at once, so
pigs waiting at the exit take it. Cages are no grid targets: shots never hit them and nothing holds the stuck check.
web/sim/features/slot_cage.js mirrors this file.
"""

from __future__ import annotations

from .. import base, places
from ..numbers import CUBE_FLY_IN

NUMBER = 30


def setup(state: base.State) -> None:
    """Every cage as a record in file order, shut."""
    listed = state.level.features.get("SlotCages")
    if not listed or not listed["Cages"]:
        return
    cages = []
    for data in listed["Cages"]:
        cages.append(
            {
                "slot": data["SlotIndex"],
                "color": data["Material"],
                "start": data["Health"],
                "left": data["Health"],
                "pending": 0,
                "open": data["Health"] <= 0,
            }
        )
    state.features[NUMBER] = {"cages": cages}


def blocked_slots(state: base.State) -> int:
    """The slots still held shut, which are the leftmost ones."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return 0
    return sum(1 for cage in mine["cages"] if not cage["open"])


def on_event(state: base.State, name: str, data: dict) -> None:
    """A single-cell cube died: every shut cage of its color gets 1 damage on its way, and opens when the damage on
    its way covers what it has left."""
    mine = state.features.get(NUMBER)
    if mine is None or name != "cube_died" or not data["single"]:
        return
    for index, cage in enumerate(mine["cages"]):
        if cage["color"] != data["color"] or cage["open"]:
            continue
        cage["pending"] += 1
        base.schedule(state, CUBE_FLY_IN, "cage_land", index)
        base.emit(state, "cage_feed", {"cage": index, "cell": data["cell"], "color": data["color"]})
        if cage["pending"] >= cage["left"]:
            unlock(state, index)


def unlock(state: base.State, index: int) -> None:
    """The cage is open: its slot is free, the other cages and the pigs pack left, and pigs waiting at the exit take
    the slots that opened up."""
    cage = state.features[NUMBER]["cages"][index]
    cage["open"] = True
    base.emit(state, "cage_open", {"cage": index, "slot": cage["slot"]})
    places.arrange_slots(state)
    places.drain_entrance(state)


def cage_land(state: base.State, index: int) -> None:
    """Timer: the cube copy lands in the cage, whose health drops by 1 (the count the page shows)."""
    cage = state.features[NUMBER]["cages"][index]
    cage["pending"] = max(0, cage["pending"] - 1)
    cage["left"] = max(0, cage["left"] - 1)
    base.emit(state, "cage_hit", {"cage": index, "left": cage["left"]})


base.register_timer("cage_land", base.PHASE_FEATURES, cage_land)


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    h = base.mix(h, len(mine["cages"]))
    for cage in mine["cages"]:
        h = base.mix(base.mix(h, int(cage["open"])), cage["left"])
        h = base.mix(h, cage["pending"])
    return h
