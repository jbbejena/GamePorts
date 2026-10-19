// Feature 26, the Music Toy: a row of colored notes over a patch of the picture, and mallets in the queues that each
// break one note of their color.
// A mallet is a queue entry that never shoots; once it is first in its queue it jumps onto a note of its color and takes
// the note's one health. The controller tries a strike pass after the same things the hammers' does (a pig tapped, pigs
// entering or leaving a queue, a booster or the Super Unicorn finishing, a revive finishing: MusicToyFeatureController
// $$TryToHitToys, RVA 0x56B8504). A pass gives every unused mallet first in its queue, in the order the level lists
// them, the first toy that has a note of its color with no lethal damage on its way, and in that toy the lowest such
// note (TryFindTargetSegment, RVA 0x56B8BF0). A mallet with no such note waits for a later pass. The k-th mallet that
// strikes in a pass starts MALLET_GAP x k ticks after the first. A strike that takes the note's last health marks it
// broken at once, so the next mallet takes another note (the hammers' rule: MusicToyMalletFeature$$Hit). Each mallet
// lifts for HAMMER_LIFT ticks and leaves its queue (the queue closes up, which can start another pass), its damage
// lands STRIKE_LANDS ticks after its strike starts and it is gone HAMMER_DONE ticks after it starts. When no unbroken
// note is left anywhere, every unused mallet vanishes, last listed first.
// The swing time of the original's mallet is not fully resolved in its code, so the damage lands as the hammer's does.
// A Hand tap on a mallet runs a pass with only that mallet, which strikes even when it isn't first. The toy is an
// obstacle over all its cells until every note has broken: shots stop at it and the cubes under it can't be hit, but
// the stuck check sees through it (IIgnoredObstacleAttachable). When the last note breaks the toy collapses and its
// cells are free at once. The notes lie along the toy's long axis in the order the level lists them, the first at the
// lowest coordinate. common/sim/features/music_toy.py mirrors this file.
import * as base from "../base.js";
import * as checks from "../checks.js";
import * as gridx from "../grid.js";
import { HAMMER_DONE, HAMMER_LIFT, MALLET_GAP, STRIKE_LANDS } from "../numbers.js";
import * as places from "../places.js";

export const NUMBER = 26;

// Events after which a strike pass runs at once: a pig tapped, pigs entering or leaving a queue, and the outside
// triggers (a booster or the Super Unicorn finished, a revive finished)
const STRIKE_AFTER = ["pig_tapped", "queue_changed", "pigs_exit_queue", "booster_done", "revive_done"];

// The mallets in the level's order (a mallet inside a Pig Pipe too, so it comes out as a mallet) with their note
// colors, and every toy standing on its cells as an obstacle, in file order
export function setup(state) {
  const listed = state.level.features.MusicToyMallets;
  const placed = state.level.features.musicToys;
  const mallets = listed ? listed.Mallets.filter((m) => m.ShooterId in state.pigs) : [];
  const dataToys = placed ? placed.MusicToys : [];
  if (!mallets.length && !dataToys.length) {
    return;
  }
  for (const mallet of mallets) {
    state.pigs[mallet.ShooterId].tags.push("disabled");
  }
  const { grid } = state;
  const toys = [];
  for (const data of dataToys) {
    const cells = data.GridPoints.filter(
      (point) => point.X >= 0 && point.X < grid.width && point.Y >= 0 && point.Y < grid.height,
    ).map((point) => gridx.cellOf(grid, point.X, point.Y));
    const body = gridx.makeTarget(NUMBER, -1, 1, true, false);
    gridx.add(grid, body, cells);
    const notes = data.Segments.map((note) => ({
      color: note.Material,
      health: note.Health,
      pending: 0,
      broken: false,
      dead: false,
    }));
    toys.push({ target: body.id, notes });
  }
  state.features[NUMBER] = {
    mallets: mallets.map((m) => m.ShooterId),
    colors: mallets.map((m) => m.Material),
    toys,
    used: [],
    strikes: [],
    active: toys.some((toy) => toy.notes.length > 0),
  };
}

export function isMallet(state, pigId) {
  const mine = state.features[NUMBER];
  return Boolean(mine) && mine.mallets.includes(pigId);
}

export function firstInQueue(state, pigId) {
  return state.queues.some((queue) => queue.length > 0 && queue[0] === pigId);
}

// Unused and first in its queue
export function available(state, pigId) {
  return !state.features[NUMBER].used.includes(pigId) && firstInQueue(state, pigId);
}

// TryFindTargetSegment: the first toy with a note of this color and no lethal damage on its way, and its lowest such
// note, as [toy, note] (null when there is none)
export function findNote(state, color) {
  const { toys } = state.features[NUMBER];
  for (let toyIndex = 0; toyIndex < toys.length; toyIndex++) {
    const { notes } = toys[toyIndex];
    for (let noteIndex = 0; noteIndex < notes.length; noteIndex++) {
      const note = notes[noteIndex];
      if (note.color === color && !note.dead && !note.broken) {
        return [toyIndex, noteIndex];
      }
    }
  }
  return null;
}

// Some note is neither broken nor marked broken by a strike on its way
export function hasOpenNote(state) {
  return state.features[NUMBER].toys.some((toy) => toy.notes.some((note) => !note.dead && !note.broken));
}

// A strike pass over these mallets (TryToHitToys). Without force only available mallets strike. With no unbroken note
// left, before or after, the leftover mallets vanish
export function tryStrikes(state, mallets, force) {
  const mine = state.features[NUMBER];
  if (!mine.active || state.reviving) {
    return;
  }
  let count = 0;
  for (const pigId of mallets) {
    if (!hasOpenNote(state)) {
      break;
    }
    if (!force && !available(state, pigId)) {
      continue;
    }
    const found = findNote(state, mine.colors[mine.mallets.indexOf(pigId)]);
    if (found === null) {
      continue;
    }
    strike(state, pigId, found, MALLET_GAP * count);
    count += 1;
  }
  if (!hasOpenNote(state)) {
    cleanUp(state);
  }
}

// One mallet takes this note: it is used, the note is marked broken now if this strike takes its last health, and its
// leave, damage and end are timed from its start, delay ticks from now
export function strike(state, pigId, [toyIndex, noteIndex], delay) {
  const mine = state.features[NUMBER];
  const note = mine.toys[toyIndex].notes[noteIndex];
  mine.used.push(pigId);
  if (note.health - (note.pending + 1) < 1) {
    note.broken = true;
  }
  note.pending += 1;
  const start = state.tick + delay;
  mine.strikes.push([pigId, toyIndex, noteIndex, start]);
  base.schedule(state, delay + HAMMER_LIFT, "mallet_lift", pigId);
  base.schedule(state, delay + STRIKE_LANDS, "mallet_land", [pigId, toyIndex, noteIndex]);
  base.schedule(state, delay + HAMMER_DONE, "mallet_done", pigId);
  base.emit(state, "mallet_strike", { pig: pigId, toy: toyIndex, note: noteIndex, start });
}

// No unbroken note is left: no more passes, and every unused mallet vanishes, last listed first
export function cleanUp(state) {
  const mine = state.features[NUMBER];
  mine.active = false;
  for (const pigId of [...mine.mallets].reverse()) {
    if (!mine.used.includes(pigId)) {
      places.vanish(state, state.pigs[pigId], "mallet");
    }
  }
}

// Timer: the lift is over and the mallet leaves its queue for the note; the queue closes up
export function malletLift(state, pigId) {
  const pig = state.pigs[pigId];
  if (pig.place !== "queue") {
    return;
  }
  const index = places.queueIndex(state, pig);
  const queue = places.takeOut(state, pig);
  pig.place = "held";
  if (queue >= 0) {
    base.emit(state, "pigs_exit_queue", { ids: [pigId], queues: [queue], indices: [index] });
  }
  checks.requestStuckCheck(state);
}

// Timer: the swing lands and the note loses 1; at 0 it breaks, and the toy collapses with its last note
export function malletLand(state, [pigId, toyIndex, noteIndex]) {
  const toy = state.features[NUMBER].toys[toyIndex];
  const note = toy.notes[noteIndex];
  note.pending = Math.max(0, note.pending - 1);
  if (note.dead) {
    return;
  }
  note.health = Math.max(0, note.health - 1);
  base.emit(state, "note_hit", { pig: pigId, toy: toyIndex, note: noteIndex, health: note.health });
  if (note.health > 0) {
    return;
  }
  note.dead = true;
  note.broken = true;
  base.emit(state, "note_break", { pig: pigId, toy: toyIndex, note: noteIndex });
  if (toy.notes.every((n) => n.dead)) {
    collapse(state, toyIndex);
  }
}

// The last note is gone: the toy leaves the grid and its cells are free at once
export function collapse(state, toyIndex) {
  const toy = state.features[NUMBER].toys[toyIndex];
  const body = state.grid.targets[toy.target];
  if (body.dead) {
    return;
  }
  body.health = 0;
  body.dead = true;
  gridx.remove(state.grid, body);
  base.emit(state, "hit", { target: body.id, cell: -1, health: 0 });
  base.emit(state, "toy_collapse", { toy: toyIndex, target: body.id });
  base.emit(state, "target_died", { target: body.id, owner: NUMBER });
  checks.requestWinCheck(state);
}

// Timer: the swing is over and the mallet is gone
export function malletDone(state, pigId) {
  const mine = state.features[NUMBER];
  mine.strikes = mine.strikes.filter((entry) => entry[0] !== pigId);
  places.vanish(state, state.pigs[pigId], "mallet");
}

base.registerTimer("mallet_lift", base.PHASE_FEATURES, malletLift);
base.registerTimer("mallet_land", base.PHASE_FEATURES, malletLand);
base.registerTimer("mallet_done", base.PHASE_FEATURES, malletDone);

// A mallet can be tapped only with the Hand, and only before it has struck
export function canTap(state, pig, hand) {
  if (!isMallet(state, pig.id)) {
    return null;
  }
  if (!hand) {
    return "can't tap that";
  }
  if (state.features[NUMBER].used.includes(pig.id)) {
    return "busy";
  }
  return null;
}

// The Hand on a mallet: it strikes at once, first in its queue or not
export function onTap(state, pig) {
  if (!isMallet(state, pig.id)) {
    return false;
  }
  tryStrikes(state, [pig.id], true);
  return true;
}

export function onEvent(state, name) {
  const mine = state.features[NUMBER];
  if (mine && STRIKE_AFTER.includes(name)) {
    tryStrikes(state, mine.mallets, false);
  }
}

// A mallet at work holds the stuck check
export function busy(state) {
  const mine = state.features[NUMBER];
  return Boolean(mine) && mine.strikes.length > 0;
}

// The stuck check sees through every standing toy
export function ignoredObstacles(state) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return [];
  }
  return mine.toys.filter((toy) => !state.grid.targets[toy.target].dead).map((toy) => toy.target);
}

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  h = base.mix(h, mine.active ? 1 : 0);
  h = base.mix(h, mine.toys.length);
  for (const toy of mine.toys) {
    h = base.mix(h, state.grid.targets[toy.target].dead ? 1 : 0);
    for (const note of toy.notes) {
      h = base.mix(base.mix(h, note.health), note.pending);
      h = base.mix(base.mix(h, note.broken ? 1 : 0), note.dead ? 1 : 0);
    }
  }
  h = base.mix(h, mine.used.length);
  for (const pigId of mine.used) {
    h = base.mix(h, pigId);
  }
  h = base.mix(h, mine.strikes.length);
  for (const [pigId, toyIndex, noteIndex, start] of mine.strikes) {
    h = base.mix(base.mix(base.mix(base.mix(h, pigId), toyIndex), noteIndex), start);
  }
  return h;
}
