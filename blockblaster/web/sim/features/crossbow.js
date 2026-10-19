// Feature 27, the Crossbow: a target of its color that, shot down to 0, fires arrows that hit every cube in line.
//
// A crossbow is a hit target of its Material with its Health, standing on every cell of its square box, and no
// obstacle, so it hides what is behind it like a cube of another color (CrossbowFeature: IHitTarget, no IObstacle).
// At 0 it fires at once (OnHitTargetDamaged, RVA 0x56348E4, starts TriggerFireSequence), unless a booster is
// running: the sequence waits until the board isn't busy (boardBusyCondition, resources #9808), so a crossbow a booster
// kills fires right after that booster ends (<TriggerFireSequence>d__64$$MoveNext, RVA 0x563A074).
//
// It fires 1 arrow when its side is odd and 2 when it is even (GetArrowCount, RVA 0x5632778), from the line just
// outside its box in its Direction, on the middle line or the two middle lines (GetArrowStartPoints, RVA 0x5633A40).
// Each arrow's path is fixed when it fires (PixelGridController$$ScanDirectionalPixels, RVA 0x54BE4C8): from the start
// cell one cell at a time to the picture's edge it skips the crossbow's own cells, stops at the first cell with any
// feature on it or a big cube, and lists every other cube. The arrow flies from the start cell's middle to the stop
// cell's (or the last cell's) at 15 units a second (CrossbowArrowInstance #11514, Fire RVA 0x562FA40) and each listed
// cube still alive takes 1 as the arrow passes it (CheckPixelProgress, RVA 0x562D4FC; CrossbowFeature$$DamagePixel,
// RVA 0x5638370). The arrow then shrinks away in 0.15 s (OnArrowReachedEnd, RVA 0x562D888); once every arrow is gone
// the crossbow leaves the picture at the next frame, and its controller waits a frame and until no shot and no other
// crossbow is in flight, then syncs the pigs with the picture, which trims the spare ammo the arrows left
// (CrossbowFeatureController OnCrossbowArrowsFinished RVA 0x563F880, WaitAndSync RVA 0x5641768,
// MapInputEvents$$TriggerSyncShootersAndPixels).
//
// The Super Shooter kills the crossbows of its color: the controller notes the color when the booster is about to fire
// (AddPendingMaterialsToFire, RVA 0x563D984) and, when a booster finishes (its outside trigger), gives every crossbow
// of a noted color with health left damage equal to that health (ExecutePendingMaterials, RVA 0x563E444).
// common/sim/features/crossbow.py mirrors this file.
import * as aim from "../aim.js";
import * as base from "../base.js";
import * as checks from "../checks.js";
import * as gridx from "../grid.js";
import { idiv } from "../mathx.js";
import { ARROW_DAMAGE, ARROW_SPEED, ARROW_VANISH } from "../numbers.js";
import * as unicorn from "../unicorn.js";

export const NUMBER = 27;

// A crossbow's life: standing, killed while a booster runs (waits for it to end), firing, gone from the picture
const STATES = ["standing", "armed", "firing", "gone"];

// FacingDirection Left, Up, Right, Down and the step one cell that way (DirectionToStep, RVA 0x563266C)
const STEPS = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];

// Events that start a booster's work and the end of it
const BOOSTER_STARTS = ["bombed", "super_shot", "unicorn_start"];

// Every crossbow as a record in file order, its target standing on its box's cells
export function setup(state) {
  const listed = state.level.features.crossbows;
  if (!listed || !listed.Crossbows.length) {
    return;
  }
  const { grid } = state;
  const bows = [];
  for (const data of listed.Crossbows) {
    const points = data.GridPoints.map((point) => [point.X, point.Y]);
    const cells = points
      .filter(([x, y]) => x >= 0 && x < grid.width && y >= 0 && y < grid.height)
      .map(([x, y]) => gridx.cellOf(grid, x, y));
    const target = gridx.add(grid, gridx.makeTarget(NUMBER, data.Material, data.Health), cells);
    bows.push({
      target: target.id,
      points,
      side: data.Area + 2,
      direction: data.Direction,
      state: "standing",
      fired: -1,
      arrows: [],
    });
  }
  state.features[NUMBER] = { bows, boosting: false, pending: [] };
}

function bowOf(state, target) {
  const index = state.features[NUMBER].bows.findIndex((bow) => bow.target === target.id);
  if (index < 0) {
    throw new Error(`target ${target.id} is no crossbow`);
  }
  return index;
}

// Damage lands on a crossbow: at 0 it leaves the grid and fires, or waits for the running booster to end
export function onHit(state, target, damage, source) {
  target.health = Math.max(0, target.health - damage);
  const cell = source === null ? -1 : source.cell;
  base.emit(state, "hit", { target: target.id, cell, health: target.health });
  if (target.health > 0) {
    return;
  }
  target.dead = true;
  gridx.remove(state.grid, target);
  base.emit(state, "target_died", { target: target.id, owner: NUMBER });
  checks.requestWinCheck(state);
  const index = bowOf(state, target);
  if (state.features[NUMBER].boosting) {
    state.features[NUMBER].bows[index].state = "armed";
    return;
  }
  fire(state, index);
}

// Mathf.RoundToInt of twice / 2
function roundHalfEven(twice) {
  const low = idiv(twice, 2);
  if (twice % 2 === 0 || low % 2 === 0) {
    return low;
  }
  return low + 1;
}

// Where the arrows start: the line just outside the box in its direction, on the middle line for an odd side or the
// two middle lines (lower first) for an even one
function startPoints(bow) {
  const xs = bow.points.map(([x]) => x);
  const ys = bow.points.map(([, y]) => y);
  const { direction } = bow;
  const rows = direction === 0 || direction === 2;
  let fixed;
  let twice;
  if (rows) {
    fixed = direction === 0 ? Math.min(...xs) - 1 : Math.max(...xs) + 1;
    twice = Math.min(...ys) + Math.max(...ys);
  } else {
    fixed = direction === 1 ? Math.max(...ys) + 1 : Math.min(...ys) - 1;
    twice = Math.min(...xs) + Math.max(...xs);
  }
  const across = bow.side % 2 === 1 ? [roundHalfEven(twice)] : [idiv(twice, 2), -idiv(-twice, 2)];
  return across.map((line) => (rows ? [fixed, line] : [line, fixed]));
}

// A feature stands on the cell: any feature target, or a crossbow still in the picture after it fired
function featureOn(state, cell) {
  if (gridx.at(state.grid, cell).some((target) => target.owner !== 0)) {
    return true;
  }
  for (const bow of state.features[NUMBER].bows) {
    if ((bow.state === "armed" || bow.state === "firing") && bowCells(state, bow).includes(cell)) {
      return true;
    }
  }
  return false;
}

function bowCells(state, bow) {
  const { grid } = state;
  return bow.points
    .filter(([x, y]) => x >= 0 && x < grid.width && y >= 0 && y < grid.height)
    .map(([x, y]) => gridx.cellOf(grid, x, y));
}

function livingCube(state, cell) {
  for (const target of gridx.at(state.grid, cell)) {
    if (target.owner === 0 && !target.dead) {
      return target;
    }
  }
  return null;
}

// One arrow's path: [cube id, cells from the start] for every cube it will hit, how many cells from the start its
// flight ends (-1 when it starts off the picture), and whether a feature or a big cube stopped it
function scan(state, bow, start, step) {
  const { grid } = state;
  const own = bowCells(state, bow);
  let [x, y] = start;
  let steps = 0;
  const cubes = [];
  while (x >= 0 && x < grid.width && y >= 0 && y < grid.height) {
    const cell = gridx.cellOf(grid, x, y);
    if (!own.includes(cell)) {
      if (featureOn(state, cell)) {
        return [cubes, steps, true];
      }
      const cube = livingCube(state, cell);
      if (cube !== null && cube.cells.length > 1) {
        return [cubes, steps, true];
      }
      if (cube !== null) {
        cubes.push([cube.id, steps]);
      }
    }
    x += step[0];
    y += step[1];
    steps += 1;
  }
  return [cubes, steps - 1, false];
}

// The tick the arrow, moving ARROW_SPEED a tick from this tick on, has flown `distance` L
function reachTick(state, distance) {
  return state.tick + Math.max(1, -idiv(-distance, ARROW_SPEED)) - 1;
}

// The crossbow fires: every arrow's path is fixed now, with the tick each listed cube is hit and the tick the arrow's
// flight ends
function fire(state, index) {
  const bow = state.features[NUMBER].bows[index];
  bow.state = "firing";
  bow.fired = state.tick;
  const step = STEPS[bow.direction];
  const { size } = state.grid;
  const arrows = [];
  for (const start of startPoints(bow)) {
    const [cubes, end, blocked] = scan(state, bow, start, step);
    arrows.push({
      start,
      stop: [start[0] + step[0] * end, start[1] + step[1] * end],
      cubes: cubes.map(([cube, steps]) => [cube, reachTick(state, steps * size)]),
      next: 0,
      end: reachTick(state, Math.abs(end) * size),
      blocked,
    });
  }
  bow.arrows = arrows;
  base.emit(state, "crossbow_fire", {
    bow: index,
    arrows: arrows.map((a) => ({ start: a.start, stop: a.stop, cubes: a.cubes.map((c) => [...c]), end: a.end })),
  });
  base.schedule(state, 0, "crossbow_arrows", index);
}

// Timer, every tick while a crossbow's arrows fly: each arrow hits the listed cubes it has reached, in arrow order;
// once every flight has ended and the arrows have shrunk away, the crossbow leaves at the next frame
function crossbowArrows(state, index) {
  const bow = state.features[NUMBER].bows[index];
  bow.arrows.forEach((arrow, number) => {
    while (arrow.next < arrow.cubes.length && arrow.cubes[arrow.next][1] <= state.tick) {
      const cube = state.grid.targets[arrow.cubes[arrow.next][0]];
      arrow.next += 1;
      if (!cube.dead && cube.health > 0) {
        base.emit(state, "arrow_hit", { bow: index, arrow: number, target: cube.id });
        aim.hit(state, cube, ARROW_DAMAGE, null);
      }
    }
  });
  const last = Math.max(...bow.arrows.map((arrow) => arrow.end));
  if (state.tick < last) {
    base.schedule(state, 1, "crossbow_arrows", index);
    return;
  }
  base.schedule(state, last + ARROW_VANISH + 1 - state.tick, "crossbow_gone", index);
}

// Timer: the crossbow leaves the picture, and its controller syncs the pigs a frame later
function crossbowGone(state, index) {
  state.features[NUMBER].bows[index].state = "gone";
  base.emit(state, "crossbow_gone", { bow: index });
  base.schedule(state, 1, "crossbow_sync", index);
}

// Timer: once no shot and no crossbow's arrows are in flight, the pigs are synced with the picture: empty pigs vanish,
// spare ammo is trimmed and the auto-finisher may start
function crossbowSync(state, index) {
  if (state.over !== null) {
    return;
  }
  if (state.shots.length || state.features[NUMBER].bows.some((bow) => bow.state === "firing")) {
    base.schedule(state, 1, "crossbow_sync", index);
    return;
  }
  unicorn.sync(state);
}

// The arrows move with the shots; the crossbow leaves at the start of a frame; the sync is a coroutine resumed after
// every script's Update
base.registerTimer("crossbow_arrows", base.PHASE_SHOTS, crossbowArrows);
base.registerTimer("crossbow_gone", base.PHASE_TAPS, crossbowGone);
base.registerTimer("crossbow_sync", base.PHASE_RELEASE, crossbowSync);

// A booster starts or ends. At the end the crossbows it killed fire, then the Super Shooter's colors kill their
// crossbows, which fire at once
export function onEvent(state, name, data) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return;
  }
  if (BOOSTER_STARTS.includes(name)) {
    mine.boosting = true;
    if (name === "super_shot") {
      mine.pending.push(data.color);
    }
    return;
  }
  if (name !== "booster_done") {
    return;
  }
  mine.boosting = false;
  mine.bows.forEach((bow, index) => {
    if (bow.state === "armed") {
      fire(state, index);
    }
  });
  const { pending } = mine;
  mine.pending = [];
  for (const color of pending) {
    for (const bow of mine.bows) {
      const target = state.grid.targets[bow.target];
      if (!target.dead && target.color === color && target.health >= 1) {
        aim.hit(state, target, target.health, null);
      }
    }
  }
}

// The hits the standing crossbows of this color still take
export function remainingHits(state, color) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return 0;
  }
  let total = 0;
  for (const bow of mine.bows) {
    const target = state.grid.targets[bow.target];
    if (!target.dead && target.color === color) {
      total += target.health;
    }
  }
  return total;
}

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  h = base.mix(base.mix(h, mine.bows.length), mine.boosting ? 1 : 0);
  h = base.mix(h, mine.pending.length);
  for (const bow of mine.bows) {
    const target = state.grid.targets[bow.target];
    h = base.mix(base.mix(h, target.health), target.dead ? 1 : 0);
    h = base.mix(base.mix(h, STATES.indexOf(bow.state)), bow.fired);
    h = base.mix(h, bow.arrows.length);
    for (const arrow of bow.arrows) {
      h = base.mix(base.mix(base.mix(h, arrow.cubes.length), arrow.next), arrow.end);
    }
  }
  return h;
}
