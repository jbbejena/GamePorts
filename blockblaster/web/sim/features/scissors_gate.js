// Feature 28, the Scissors Gate: an obstacle over a strip of cubes that folds shorter, from both ends, as cubes of its
// color are destroyed anywhere on the picture.
// A gate lies along one axis (Orientation 0: x, 1: y) for BaseDimensions.y cells and is BaseDimensions.x cells thick.
// Its length starts at that and drops by 2 at every shrink, freeing one full line at each end: a cell stays only while
// its coordinate along the axis, counted from the strip's lowest, is at least (base - length) / 2 and below
// base - (base - length) / 2 (AccordionFeature$$RebuildOccupiedPoints, RVA 0x556091C). Every destroyed single-cell cube
// of the gate's color gives it 1 damage, pending at once and landing CUBE_FLY_IN ticks later (AccordionFeature
// $$OnTargetDeath, RVA 0x555F30C, skips big cubes; DamageAccordion, RVA 0x555F530). A gate takes damage while it is not
// doomed. The step counter starts at HpPerShrink, plus LastShrinkBonus while the length is 2; when a landing takes it
// to 0 the gate shrinks once (OnDamage -> ShrinkOnce, RVA 0x555E1E4) and the counter resets for the new length. A gate
// gone to length 0 leaves the grid. At length 2 or less, a damage whose pending total is lethal (WillKillingHit, RVA
// 0x555FE24) frees all of the gate's cells at once and dooms it, so it takes no more damage; its last landing then
// removes it. Total cubes needed are HpPerShrink x length / 2 + LastShrinkBonus. Shots never hit a gate and nothing
// holds the stuck check. The gate is an IRemovablePixelGridObstacle, so the Obstacles revive removes it.
// common/sim/features/scissors_gate.py mirrors this file.
import * as base from "../base.js";
import * as gridx from "../grid.js";
import { CUBE_FLY_IN } from "../numbers.js";

export const NUMBER = 28;

// The counter a gate of this length starts a step with
function stepHealth(gate, length) {
  return gate.hp + (length === 2 ? gate.bonus : 0);
}

// The cells a gate of this length stands on, in the order they were listed
export function keptCells(gate, length) {
  const trim = Math.floor((gate.base - length) / 2);
  return gate.cells.filter(([, along]) => along >= trim && along < gate.base - trim).map(([cell]) => cell);
}

// Every gate as a record in file order, its body standing on all its cells as an obstacle
export function setup(state) {
  const listed = state.level.features.accordions;
  if (!listed || !listed.Accordions.length) {
    return;
  }
  const { grid } = state;
  const gates = [];
  for (const data of listed.Accordions) {
    const axis = data.Orientation === 1 ? "Y" : "X";
    const lowest = Math.min(...data.GridPoints.map((point) => point[axis]));
    const cells = data.GridPoints.filter(
      (point) => point.X >= 0 && point.X < grid.width && point.Y >= 0 && point.Y < grid.height,
    ).map((point) => [gridx.cellOf(grid, point.X, point.Y), point[axis] - lowest]);
    const gate = {
      color: data.Material,
      hp: data.HpPerShrink,
      bonus: data.LastShrinkBonus,
      base: data.BaseDimensions.y,
      cells,
      length: data.BaseDimensions.y,
      pending: 0,
      doomed: false,
    };
    gate.left = stepHealth(gate, gate.length);
    const body = gridx.makeTarget(NUMBER, -1, 1, true, false);
    gridx.add(grid, body, keptCells(gate, gate.length));
    gate.target = body.id;
    gates.push(gate);
  }
  state.features[NUMBER] = { gates };
}

function standing(state, gate) {
  return !state.grid.targets[gate.target].dead;
}

// A single-cell cube died: every standing gate of its color that isn't doomed gets 1 damage on its way
export function onEvent(state, name, data) {
  const mine = state.features[NUMBER];
  if (!mine || name !== "cube_died" || !data.single) {
    return;
  }
  mine.gates.forEach((gate, index) => {
    if (gate.color !== data.color || gate.doomed || !standing(state, gate)) {
      return;
    }
    gate.pending += 1;
    base.schedule(state, CUBE_FLY_IN, "gate_land", index);
    base.emit(state, "gate_feed", { gate: index, cell: data.cell, color: data.color });
    if (gate.length <= 2 && gate.pending >= gate.left) {
      gate.doomed = true;
      setCells(state, index, [], "cubes");
    }
  });
}

// The gate's body stands on these cells now. The hit event makes keys and Surprise Pixels look at the picture again
function setCells(state, index, cells, why) {
  const gate = state.features[NUMBER].gates[index];
  const body = state.grid.targets[gate.target];
  gridx.move(state.grid, body, cells);
  base.emit(state, "gate_cells", { gate: index, length: gate.length, cells: cells.length, why });
  base.emit(state, "hit", { target: body.id, cell: -1, health: body.health });
}

// Timer: the cube copy lands in the gate, whose counter loses 1; at 0 it shrinks once
export function gateLand(state, index) {
  const gate = state.features[NUMBER].gates[index];
  gate.pending = Math.max(0, gate.pending - 1);
  if (!standing(state, gate)) {
    return;
  }
  gate.left -= 1;
  base.emit(state, "gate_hit", { gate: index, left: gate.left });
  if (gate.left <= 0) {
    shrink(state, index);
  }
}

// ShrinkOnce: the gate is 2 shorter, its two end lines are free, and the counter resets; at length 0 it is gone
function shrink(state, index) {
  const gate = state.features[NUMBER].gates[index];
  gate.length -= 2;
  if (gate.length <= 0) {
    gate.length = 0;
    leave(state, index, "cubes");
    return;
  }
  gate.left = stepHealth(gate, gate.length);
  base.emit(state, "gate_shrink", { gate: index, length: gate.length });
  if (!gate.doomed) {
    setCells(state, index, keptCells(gate, gate.length), "shrink");
  }
}

// The gate is gone from the grid
function leave(state, index, why) {
  const gate = state.features[NUMBER].gates[index];
  const body = state.grid.targets[gate.target];
  if (body.dead) {
    return;
  }
  gate.doomed = true;
  body.health = 0;
  body.dead = true;
  gridx.remove(state.grid, body);
  base.emit(state, "gate_leave", { gate: index, target: body.id, why });
  base.emit(state, "hit", { target: body.id, cell: -1, health: 0 });
}

base.registerTimer("gate_land", base.PHASE_FEATURES, gateLand);

// The Obstacles revive removes every standing gate, in file order. Returns the ticks the revive waits (none)
export function revive(state, name) {
  const mine = state.features[NUMBER];
  if (name !== "obstacles" || !mine) {
    return 0;
  }
  mine.gates.forEach((gate, index) => {
    if (standing(state, gate)) {
      leave(state, index, "revive");
    }
  });
  return 0;
}

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  h = base.mix(h, mine.gates.length);
  for (const gate of mine.gates) {
    h = base.mix(base.mix(h, standing(state, gate) ? 0 : 1), gate.length);
    h = base.mix(base.mix(h, gate.left), gate.pending);
    h = base.mix(h, gate.doomed ? 1 : 0);
  }
  return h;
}
