// Feature 19, the Pumpkin: a patch of pumpkins taking hits one at a time, the first living one over the whole patch.
// Every pumpkin is a target of its color with its own health, but only one of a patch stands on the grid, covering all
// the patch's cells (PumpkinFeature$$SetCurrentInstance, RVA 0x5762E00; PumpkinItemInstance$$OccupiesPoint, RVA
// 0x576946C). The others wait off the grid and cannot be aimed at. It is a hit target and no obstacle. When the
// standing one dies the next living one in file order takes the cells at once, in the same step the killing shot lands
// (the damage handler PumpkinFeature$$knw, RVA 0x5762AD8, calls AdvanceFromDeadCurrent, RVA 0x5762B84, which asks
// TryGetNextAliveInstanceIndex, RVA 0x5763C64, for the first living one after it); the 0.05 s pop-in is a look. While a
// shot that will kill the standing pumpkin is in flight it stays on the grid with a claim on it, so no pig aims at it and
// the next one is not there yet. A pumpkin whose health is 0 starts dead (MarkDepletedInstancesDead, RVA 0x5762EF8). When
// none are left the patch is gone. Every pumpkin counts toward its color's hits left (the health sum at RVA 0x5764DF0),
// and the Super Unicorn can shoot a waiting one directly. common/sim/features/pumpkin.py mirrors this file.
import * as aim from "../aim.js";
import * as base from "../base.js";
import * as checks from "../checks.js";
import * as gridx from "../grid.js";
import * as unicorn from "../unicorn.js";

export const NUMBER = 19;

// Where the Super Unicorn ranks a patch's pumpkins inside a tier: the standing one first, the waiting ones after
export const RANK_STANDING = 1;
export const RANK_WAITING = 3;

// Every patch as a record, in file order, with one target per pumpkin; the first living one stands on the cells
export function setup(state) {
  const listed = state.level.features.pumpkins;
  if (!listed || !listed.Pumpkins.length) {
    return;
  }
  const { grid } = state;
  const patches = [];
  for (const data of listed.Pumpkins) {
    const cells = data.GridPoints.filter(
      (point) => point.X >= 0 && point.X < grid.width && point.Y >= 0 && point.Y < grid.height,
    ).map((point) => gridx.cellOf(grid, point.X, point.Y));
    const items = [];
    for (const item of data.Pumpkins) {
      const target = gridx.makeTarget(NUMBER, item.MaterialId, item.Health);
      target.dead = item.Health <= 0;
      gridx.add(grid, target, []);
      items.push(target.id);
    }
    const patch = { cells, items, current: -1 };
    patches.push(patch);
    advance(state, patch);
  }
  state.features[NUMBER] = { patches };
}

// Put the first living pumpkin after the standing one on the patch's cells. False when none is left
export function advance(state, patch) {
  const { grid } = state;
  for (let index = patch.current + 1; index < patch.items.length; index++) {
    const target = grid.targets[patch.items[index]];
    if (!target.dead) {
      patch.current = index;
      gridx.move(grid, target, patch.cells);
      return true;
    }
  }
  patch.current = patch.items.length;
  return false;
}

export function patchOf(state, targetId) {
  return state.features[NUMBER].patches.find((p) => p.items.includes(targetId));
}

// A shot lands on a pumpkin: it loses health, and at 0 it is gone; when it was the standing one the next living pumpkin
// takes its place at once, and the patch is gone with the last
export function onHit(state, target, damage, source) {
  const patch = patchOf(state, target.id);
  target.health = Math.max(0, target.health - damage);
  const cell = source === null ? -1 : source.cell;
  base.emit(state, "hit", { target: target.id, cell, health: target.health });
  if (target.health > 0) {
    return;
  }
  target.dead = true;
  const standing = patch.items.indexOf(target.id) === patch.current;
  gridx.remove(state.grid, target);
  base.emit(state, "target_died", { target: target.id, owner: NUMBER });
  if (standing) {
    if (advance(state, patch)) {
      base.emit(state, "pumpkin_next", { target: patch.items[patch.current], from: target.id });
    } else {
      base.emit(state, "pumpkin_patch_gone", { target: target.id });
    }
  }
  checks.requestWinCheck(state);
}

// The hits the living pumpkins of this color still take, the waiting ones too
export function remainingHits(state, color) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return 0;
  }
  let total = 0;
  for (const patch of mine.patches) {
    for (const targetId of patch.items) {
      const target = state.grid.targets[targetId];
      if (!target.dead && target.color === color) {
        total += target.health;
      }
    }
  }
  return total;
}

// The Super Unicorn's rank of the standing pumpkin, which it finds as an ordinary feature target
export function unicornRank() {
  return RANK_STANDING;
}

// For the Super Unicorn: [target id, cells, tier, rank, hits] for every waiting pumpkin of this color, in the tier of
// its patch's cells (open, or blocked when some other obstacle stands on them)
export function unicornReserves(state, color) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return [];
  }
  const found = [];
  for (const patch of mine.patches) {
    const tier = unicorn.blockedOn(state, patch.cells, -1) ? unicorn.TIER_BLOCKED_FEATURE : unicorn.TIER_OPEN_FEATURE;
    patch.items.forEach((targetId, index) => {
      const target = state.grid.targets[targetId];
      if (index > patch.current && !target.dead && target.color === color) {
        found.push([targetId, [...patch.cells], tier, RANK_WAITING, target.health]);
      }
    });
  }
  return found;
}

// The hits the pumpkin takes while it still waits; 0 once it stands (the Unicorn then finds it on the grid)
export function unicornReserveLeft(state, targetId, color) {
  const target = state.grid.targets[targetId];
  const patch = patchOf(state, targetId);
  if (target.dead || target.color !== color || patch.items.indexOf(targetId) <= patch.current) {
    return 0;
  }
  return target.health;
}

// A Super Unicorn shot at a waiting pumpkin hits it where it waits. Nothing is left for the Unicorn to break
export function unicornPop(state, targetId) {
  aim.hit(state, state.grid.targets[targetId], 1, null);
  return null;
}

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  let out = base.mix(h, mine.patches.length);
  for (const patch of mine.patches) {
    out = base.mix(base.mix(out, patch.current), patch.items.length);
    for (const targetId of patch.items) {
      const target = state.grid.targets[targetId];
      out = base.mix(base.mix(out, target.health), target.dead ? 1 : 0);
    }
  }
  return out;
}
