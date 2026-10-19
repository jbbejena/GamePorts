// Feature 25, the Bull Totem: a queue entry that never shoots and can't be tapped, worn down by every pig that leaves a
// queue once the totem stands first in its own.
// A totem is active from the start when it begins first in its queue, else from the first exit event that finds it
// first (BullTotemFeature$$Start and CheckActivation, RVA 0x55B1FF0). While active, an exit event (pigs leaving a
// queue) takes 1 off its count for every pig in it except the totem itself, all at once and not at all when the event
// holds any other disabled entry (a lock, a hammer, a pipe, another totem), and never in the tick the totem became
// active (OnShootersExitingQueue, RVA 0x55B266C: it compares the activation frame with the current one). Pigs sent from
// slots leave no queue, so they don't count. At 0 the totem's entry vanishes like any pig and its queue moves up
// (DestroySelf, RVA 0x55B1818, then MapInputEvents$$TriggerMakeShooterDisappear). While the totem is breaking it takes
// no more events. During a booster the original reads its queue differently (countSyncPowerupChannels); the game is
// stopped while a booster works, so the remake keeps one rule. A totem standing at a queue front blocks the level as
// "totem"; the revive destroys every totem first in its queue, queue by queue
// (MapRescueController.<DestroyFirstBullTotems>d__25, which calls BullTotemFeature$$Rescue, a jump to DestroySelf).
// common/sim/features/bull_totem.py mirrors this file.
import * as base from "../base.js";
import * as places from "../places.js";

export const NUMBER = 25;

// Every totem as a record, in file order, with its count. A totem that starts first in its queue is active from the
// start, before any tick (the original activates it in Start)
export function setup(state) {
  const listed = state.level.features.BullTotems;
  if (!listed) {
    return;
  }
  const totems = [];
  for (const data of listed.Totems) {
    const pig = state.pigs[data.ShooterId];
    if (pig === undefined) {
      continue;
    }
    pig.tags.push("disabled", "untappable");
    totems.push({
      pig: pig.id,
      start: data.Count,
      count: data.Count,
      active: firstInQueue(state, pig.id),
      since: -1,
      done: false,
    });
  }
  if (totems.length) {
    state.features[NUMBER] = { totems };
  }
}

function firstInQueue(state, pigId) {
  return state.queues.some((queue) => queue.length > 0 && queue[0] === pigId);
}

// The totem record of an entry that is still standing, else null
export function record(state, pigId) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return null;
  }
  return mine.totems.find((totem) => totem.pig === pigId && !totem.done) || null;
}

// CheckActivation: a totem that is first in its queue becomes active
function activate(state, totem) {
  if (totem.active || !firstInQueue(state, totem.pig)) {
    return;
  }
  totem.active = true;
  totem.since = state.tick;
  base.emit(state, "totem_activated", { pig: totem.pig });
}

// DestroySelf: the totem takes no more events and its entry vanishes
function destroy(state, totem, why) {
  totem.done = true;
  base.emit(state, "totem_broken", { pig: totem.pig, why });
  places.vanish(state, state.pigs[totem.pig], "totem");
}

// How many pigs of this exit event wear the totem down: every pig that left a level queue except the totem itself, or
// 0 for the whole event when it holds any other disabled entry
function chipsOf(state, totem, data) {
  let chips = 0;
  for (let i = 0; i < data.ids.length; i++) {
    const pigId = data.ids[i];
    if (pigId === totem.pig) {
      continue;
    }
    if (state.pigs[pigId].tags.includes("disabled")) {
      return 0;
    }
    if (data.queues[i] >= 0) {
      chips += 1;
    }
  }
  return chips;
}

// OnShootersExitingQueue for one totem
function onExit(state, totem, data) {
  if (totem.done) {
    return;
  }
  if (!totem.active) {
    activate(state, totem);
    return;
  }
  if (totem.since === state.tick) {
    return;
  }
  const chips = chipsOf(state, totem, data);
  if (chips === 0) {
    return;
  }
  totem.count = Math.max(0, totem.count - chips);
  base.emit(state, "totem_hit", { pig: totem.pig, health: totem.count, chips });
  if (totem.count === 0) {
    destroy(state, totem, "count");
  }
}

export function onEvent(state, name, data) {
  const mine = state.features[NUMBER];
  if (!mine || name !== "pigs_exit_queue") {
    return;
  }
  for (const totem of mine.totems) {
    onExit(state, totem, data);
  }
}

export function blocker(state, pig) {
  return record(state, pig.id) !== null ? "totem" : null;
}

// The Bull totem revive destroys every totem first in its queue, queue by queue; the fronts are read before the first
// one goes. Returns the ticks the revive waits (none: the original only yields a frame)
export function revive(state, name) {
  if (name !== "totem" || !(NUMBER in state.features)) {
    return 0;
  }
  const fronts = state.queues.filter((queue) => queue.length > 0).map((queue) => queue[0]);
  for (const pigId of fronts) {
    const totem = record(state, pigId);
    if (totem !== null) {
      destroy(state, totem, "revive");
    }
  }
  return 0;
}

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  h = base.mix(h, mine.totems.length);
  for (const totem of mine.totems) {
    h = base.mix(base.mix(h, totem.pig), totem.count);
    h = base.mix(base.mix(h, Number(totem.active)), totem.since);
    h = base.mix(h, Number(totem.done));
  }
  return h;
}
