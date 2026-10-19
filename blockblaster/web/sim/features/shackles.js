// Feature 20, Shackles: pigs chained together across queues, set free when every one of them is first in line.
// After any queue enter or exit, any tap and any finished booster or revive, every chain whose members are all first in
// their queues starts breaking; SHACKLE_BREAK ticks later the pigs are free (ChainedShooterFeatureController$$
// TryToBreakChains, RVA 0x55D84A0, BreakAllChains(false); the wait is ChainedShooterVisualizer.<BreakAsync> breakDelay,
// resumed at the start of a frame). A chained pig is tapped through the Connected group check (it implements
// IConnectedShooterFeature): one free tray a member, and every member free to go, which means first in its queue. Such a
// tap breaks the chain at once and sends only that pig, one tick later: the tap logic breaks it immediately, waits until
// its feature is destroyed at the end of the frame, then auto-taps the pig, which places it without the tap check unless
// it is leaving (<BreakChainsAndTriggerShooterAction>d__16$$MoveNext, RVA 0x55D9CA8; MapController$$OnAutoTapShooter,
// RVA 0x58D5874). A tap on a chain that is already breaking does nothing (the same MoveNext returns when IsBreaking is
// set), though it still counts as a tap. A chained pig about to vanish breaks its chain at once
// (TryToMakeConnectedShootersDisappear, RVA 0x55D9320). common/sim/features/shackles.py mirrors this file.
import * as base from "../base.js";
import { SHACKLE_BREAK } from "../numbers.js";
import * as places from "../places.js";

export const NUMBER = 20;

// A chain's phase
export const CHAINED = 0;
export const BREAKING = 1;
export const BROKEN = 2;

// Events after which every chain with all its members first in their queues starts breaking (the controller's
// subscriptions: shooters entering or leaving a queue, a shooter tapped, and the two outside triggers)
const BREAK_AFTER = ["pigs_exit_queue", "queue_changed", "pig_tapped", "booster_done", "revive_done"];

// The level's chains, each a list of pig ids first to last, and each chain's phase
export function setup(state) {
  const listed = state.level.features.ChainedShooters;
  if (!listed) {
    return;
  }
  const chains = [];
  for (const chain of listed.Chains) {
    const members = chain.Shooters.filter((pigId) => pigId in state.pigs);
    if (members.length >= 2) {
      chains.push(members);
    }
  }
  if (chains.length) {
    state.features[NUMBER] = { chains, phase: chains.map(() => CHAINED) };
  }
}

// The index of the chain still holding this pig (chained or breaking), or -1
export function chainIndex(state, pigId) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return -1;
  }
  return mine.chains.findIndex((members, index) => mine.phase[index] !== BROKEN && members.includes(pigId));
}

// A pig still in a chain carries the feature, so Shuffle leaves it where it is
export function pins(state, pigId) {
  return chainIndex(state, pigId) >= 0;
}

// The level queue holding this pig, or null
export function queueOf(state, pigId) {
  for (const queue of state.queues) {
    if (queue.includes(pigId)) {
      return queue;
    }
  }
  return null;
}

// A member in a queue is blocked when any pig in front of it is not in its chain (IConnectedShooterFeature$$
// IsShooterBlockedInFront, RVA 0x55D50E0). Members sit in different queues, so this means not first
export function blockedInFront(state, pigId, members) {
  const queue = queueOf(state, pigId);
  if (queue === null) {
    return false;
  }
  return queue.slice(0, queue.indexOf(pigId)).some((other) => !members.includes(other));
}

// The other tap conditions the group check runs on every member: a non-tappable feature on it, or another feature
// against it
export function otherRulesRefuse(state, pig, hand) {
  if (pig.tags.includes("untappable")) {
    return true;
  }
  for (const module of base.MODULES) {
    if (!module.canTap || module.canTap === canTap) {
      continue;
    }
    const reason = module.canTap(state, pig, hand);
    if (reason !== null && reason !== undefined) {
      return true;
    }
  }
  return false;
}

// One member's part of the group check (ConnectedShooterCanTapCondition$$CheckWithReason, RVA 0x55D5438): busy, the
// other tap conditions, then with the Hand on any member in a queue goes; without it a member mustn't be blocked in
// its queue or on the belt
export function memberRefused(state, pigId, members, hand) {
  const pig = state.pigs[pigId];
  if (state.tick < pig.freeAt || otherRulesRefuse(state, pig, hand)) {
    return true;
  }
  const inQueue = queueOf(state, pigId) !== null;
  if (hand) {
    return !inQueue;
  }
  return blockedInFront(state, pigId, members) || pig.place === "belt";
}

// The Connected group check over the chain: one free tray a member, and every member free to go
export function canTap(state, pig, hand) {
  const index = chainIndex(state, pig.id);
  if (index < 0) {
    return null;
  }
  const members = state.features[NUMBER].chains[index];
  if (state.trayTotal - state.belt.length < members.length) {
    return "belt full";
  }
  for (const pigId of members) {
    if (memberRefused(state, pigId, members, hand)) {
      return "chained";
    }
  }
  return null;
}

// The stuck check's version (ConnectedShooterIsUnblockedCondition$$CheckWithReason, RVA 0x55D5DBC): every member
// passes the other tap conditions and none is blocked in its queue
export function canTapNormally(state, pig) {
  const index = chainIndex(state, pig.id);
  if (index < 0) {
    return null;
  }
  const members = state.features[NUMBER].chains[index];
  for (const pigId of members) {
    if (otherRulesRefuse(state, state.pigs[pigId], false) || blockedInFront(state, pigId, members)) {
      return "chained";
    }
  }
  return null;
}

// The chain falls apart at once (BreakAllChains(true))
export function breakNow(state, index, cause) {
  const mine = state.features[NUMBER];
  mine.phase[index] = BROKEN;
  base.emit(state, "shackles_broken", { chain: index, ids: [...mine.chains[index]], cause });
}

// A tap on a chained pig breaks its chain at once and auto-taps the pig next tick; on a breaking chain it does nothing
export function onTap(state, pig, hand) {
  const index = chainIndex(state, pig.id);
  if (index < 0) {
    return false;
  }
  if (state.features[NUMBER].phase[index] === CHAINED) {
    breakNow(state, index, "tap");
    base.schedule(state, 1, "shackle_tap", pig.id);
  }
  return true;
}

// Timer: the auto-tap after a chain broke under a tap. It places the pig (or nothing without enough free trays) and
// counts as a tap; a pig that left its place meanwhile is skipped
export function shackleTap(state, pigId) {
  const pig = state.pigs[pigId];
  if (!["queue", "slot", "rescue"].includes(pig.place)) {
    return;
  }
  places.placeBatch(state, places.batchOf(state, pig));
  base.emit(state, "pig_tapped", { pig: pigId });
}

// Every chain whose members are all first in their queues starts breaking, in queue order
export function tryBreaks(state) {
  const mine = state.features[NUMBER];
  const fronts = state.queues.filter((queue) => queue.length).map((queue) => queue[0]);
  for (const pigId of fronts) {
    const index = chainIndex(state, pigId);
    if (index < 0 || mine.phase[index] !== CHAINED) {
      continue;
    }
    if (mine.chains[index].every((member) => fronts.includes(member))) {
      mine.phase[index] = BREAKING;
      base.schedule(state, SHACKLE_BREAK, "shackle_break", index);
      base.emit(state, "shackles_breaking", { chain: index, ids: [...mine.chains[index]] });
    }
  }
}

// Timer: a breaking chain's wait ended; its pigs are free (unless a vanish broke it already)
export function shackleBreak(state, index) {
  if (state.features[NUMBER].phase[index] === BREAKING) {
    breakNow(state, index, "free");
  }
}

export function onEvent(state, name, data) {
  if (!(NUMBER in state.features)) {
    return;
  }
  if (name === "pig_vanishing") {
    const index = chainIndex(state, data.pig);
    if (index >= 0) {
      breakNow(state, index, "vanish");
    }
  } else if (BREAK_AFTER.includes(name)) {
    tryBreaks(state);
  }
}

export function checksum(state, h) {
  if (!(NUMBER in state.features)) {
    return h;
  }
  const phases = state.features[NUMBER].phase;
  h = base.mix(h, phases.length);
  for (const phase of phases) {
    h = base.mix(h, phase);
  }
  return h;
}

// Both waits are async tasks resumed at PlayerLoopTiming.Update, before every script's Update: they land at the start
// of a tick
base.registerTimer("shackle_tap", base.PHASE_TAPS, shackleTap);
base.registerTimer("shackle_break", base.PHASE_TAPS, shackleBreak);
