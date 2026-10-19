"""Feature 20, Shackles: pigs chained together across queues, set free when every one of them is first in line.

After any queue enter or exit, any tap and any finished booster or revive, every chain whose members are all first in
their queues starts breaking; SHACKLE_BREAK ticks later the pigs are free (ChainedShooterFeatureController$$
TryToBreakChains, RVA 0x55D84A0, BreakAllChains(false); the wait is ChainedShooterVisualizer.<BreakAsync> breakDelay,
resumed at the start of a frame). A chained pig is tapped through the Connected group check (it implements
IConnectedShooterFeature): one free tray a member, and every member free to go, which means first in its queue. Such a
tap breaks the chain at once and sends only that pig, one tick later: the tap logic breaks it immediately, waits until
its feature is destroyed at the end of the frame, then auto-taps the pig, which places it without the tap check unless
it is leaving (<BreakChainsAndTriggerShooterAction>d__16$$MoveNext, RVA 0x55D9CA8; MapController$$OnAutoTapShooter,
RVA 0x58D5874). A tap on a chain that is already breaking does nothing (the same MoveNext returns when IsBreaking is
set), though it still counts as a tap. A chained pig about to vanish breaks its chain at once
(TryToMakeConnectedShootersDisappear, RVA 0x55D9320). web/sim/features/shackles.js mirrors this file.
"""

from __future__ import annotations

from .. import base, places
from ..numbers import SHACKLE_BREAK

NUMBER = 20

# A chain's phase
CHAINED = 0
BREAKING = 1
BROKEN = 2

# Events after which every chain with all its members first in their queues starts breaking (the controller's
# subscriptions: shooters entering or leaving a queue, a shooter tapped, and the two outside triggers)
BREAK_AFTER = ("pigs_exit_queue", "queue_changed", "pig_tapped", "booster_done", "revive_done")


def setup(state: base.State) -> None:
    """The level's chains, each a list of pig ids first to last, and each chain's phase."""
    listed = state.level.features.get("ChainedShooters")
    if not listed:
        return
    chains = []
    for chain in listed["Chains"]:
        members = [pig_id for pig_id in chain["Shooters"] if pig_id in state.pigs]
        if len(members) >= 2:
            chains.append(members)
    if chains:
        state.features[NUMBER] = {"chains": chains, "phase": [CHAINED] * len(chains)}


def chain_index(state: base.State, pig_id: int) -> int:
    """The index of the chain still holding this pig (chained or breaking), or -1."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return -1
    for index, members in enumerate(mine["chains"]):
        if mine["phase"][index] != BROKEN and pig_id in members:
            return index
    return -1


def pins(state: base.State, pig_id: int) -> bool:
    """A pig still in a chain carries the feature, so Shuffle leaves it where it is."""
    return chain_index(state, pig_id) >= 0


def queue_of(state: base.State, pig_id: int) -> list[int] | None:
    """The level queue holding this pig, or None."""
    for queue in state.queues:
        if pig_id in queue:
            return queue
    return None


def blocked_in_front(state: base.State, pig_id: int, members: list[int]) -> bool:
    """A member in a queue is blocked when any pig in front of it is not in its chain (IConnectedShooterFeature$$
    IsShooterBlockedInFront, RVA 0x55D50E0). Members sit in different queues, so this means not first."""
    queue = queue_of(state, pig_id)
    if queue is None:
        return False
    return any(other not in members for other in queue[: queue.index(pig_id)])


def other_rules_refuse(state: base.State, pig: base.Pig, hand: bool) -> bool:
    """The other tap conditions the group check runs on every member: a non-tappable feature on it, or another
    feature against it."""
    if "untappable" in pig.tags:
        return True
    for module in base.MODULES:
        hook = getattr(module, "can_tap", None)
        if hook is None or hook is can_tap:
            continue
        if hook(state, pig, hand) is not None:
            return True
    return False


def member_refused(state: base.State, pig_id: int, members: list[int], hand: bool) -> bool:
    """One member's part of the group check (ConnectedShooterCanTapCondition$$CheckWithReason, RVA 0x55D5438): busy,
    the other tap conditions, then with the Hand on any member in a queue goes; without it a member mustn't be blocked
    in its queue or on the belt."""
    pig = state.pigs[pig_id]
    if state.tick < pig.free_at or other_rules_refuse(state, pig, hand):
        return True
    in_queue = queue_of(state, pig_id) is not None
    if hand:
        return not in_queue
    return blocked_in_front(state, pig_id, members) or pig.place == "belt"


def can_tap(state: base.State, pig: base.Pig, hand: bool) -> str | None:
    """The Connected group check over the chain: one free tray a member, and every member free to go."""
    index = chain_index(state, pig.id)
    if index < 0:
        return None
    members = state.features[NUMBER]["chains"][index]
    if state.tray_total - len(state.belt) < len(members):
        return "belt full"
    for pig_id in members:
        if member_refused(state, pig_id, members, hand):
            return "chained"
    return None


def can_tap_normally(state: base.State, pig: base.Pig) -> str | None:
    """The stuck check's version (ConnectedShooterIsUnblockedCondition$$CheckWithReason, RVA 0x55D5DBC): every member
    passes the other tap conditions and none is blocked in its queue."""
    index = chain_index(state, pig.id)
    if index < 0:
        return None
    members = state.features[NUMBER]["chains"][index]
    for pig_id in members:
        if other_rules_refuse(state, state.pigs[pig_id], False) or blocked_in_front(state, pig_id, members):
            return "chained"
    return None


def break_now(state: base.State, index: int, cause: str) -> None:
    """The chain falls apart at once (BreakAllChains(true))."""
    mine = state.features[NUMBER]
    mine["phase"][index] = BROKEN
    base.emit(state, "shackles_broken", {"chain": index, "ids": list(mine["chains"][index]), "cause": cause})


def on_tap(state: base.State, pig: base.Pig, hand: bool) -> bool:
    """A tap on a chained pig breaks its chain at once and auto-taps the pig next tick; on a breaking chain it does
    nothing."""
    index = chain_index(state, pig.id)
    if index < 0:
        return False
    if state.features[NUMBER]["phase"][index] == CHAINED:
        break_now(state, index, "tap")
        base.schedule(state, 1, "shackle_tap", pig.id)
    return True


def shackle_tap(state: base.State, pig_id: int) -> None:
    """Timer: the auto-tap after a chain broke under a tap. It places the pig (or nothing without enough free trays)
    and counts as a tap; a pig that left its place meanwhile is skipped."""
    pig = state.pigs[pig_id]
    if pig.place not in ("queue", "slot", "rescue"):
        return
    places.place_batch(state, places.batch_of(state, pig))
    base.emit(state, "pig_tapped", {"pig": pig_id})


def try_breaks(state: base.State) -> None:
    """Every chain whose members are all first in their queues starts breaking, in queue order."""
    mine = state.features[NUMBER]
    fronts = [queue[0] for queue in state.queues if queue]
    for pig_id in fronts:
        index = chain_index(state, pig_id)
        if index < 0 or mine["phase"][index] != CHAINED:
            continue
        if all(member in fronts for member in mine["chains"][index]):
            mine["phase"][index] = BREAKING
            base.schedule(state, SHACKLE_BREAK, "shackle_break", index)
            base.emit(state, "shackles_breaking", {"chain": index, "ids": list(mine["chains"][index])})


def shackle_break(state: base.State, index: int) -> None:
    """Timer: a breaking chain's wait ended; its pigs are free (unless a vanish broke it already)."""
    if state.features[NUMBER]["phase"][index] == BREAKING:
        break_now(state, index, "free")


def on_event(state: base.State, name: str, data: dict) -> None:
    if NUMBER not in state.features:
        return
    if name == "pig_vanishing":
        index = chain_index(state, data["pig"])
        if index >= 0:
            break_now(state, index, "vanish")
    elif name in BREAK_AFTER:
        try_breaks(state)


def checksum(state: base.State, h: int) -> int:
    if NUMBER not in state.features:
        return h
    phases = state.features[NUMBER]["phase"]
    h = base.mix(h, len(phases))
    for phase in phases:
        h = base.mix(h, phase)
    return h


# Both waits are async tasks resumed at PlayerLoopTiming.Update, before every script's Update: they land at the start
# of a tick
base.register_timer("shackle_tap", base.PHASE_TAPS, shackle_tap)
base.register_timer("shackle_break", base.PHASE_TAPS, shackle_break)
