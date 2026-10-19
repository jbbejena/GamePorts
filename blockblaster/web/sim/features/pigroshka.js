// Feature 31, the Pigroshka: a nest of dolls on a square of empty cells, shot one layer at a time from the outside in.
// A doll lists its layers with the outermost one LAST (MatryoshkaFeature, get_ConsumedLayerCount, RVA 0x5684EA0;
// GetNextAliveLayerIndex, RVA 0x5683D80). Every layer is a hit target of its own color and health, but only the
// outermost living one stands on the grid, over a centered square of side max(S - 2k, 3 if S is odd else 4) after k
// layers have gone (GetCurrentSize, RVA 0x5682CAC) with S the side the doll started with. When the standing layer dies
// the next one inside opens at once (OpenNextLayer, RVA 0x5683E0C) and the square shrinks, so the ring of cells between
// the two squares is free; after the last layer the doll is gone and nothing is left inside. A doll is a hit target and
// no obstacle, and every layer counts toward its color's hits left. The cells a doll stands on hold no cubes. While a
// shot that will kill the standing layer is in flight it stays on the grid with a claim on it, as a Pumpkin does.
// common/sim/features/pigroshka.py mirrors this file.
import * as aim from "../aim.js";
import * as base from "../base.js";
import * as checks from "../checks.js";
import * as gridx from "../grid.js";
import * as unicorn from "../unicorn.js";

export const NUMBER = 31;

// Where the Super Unicorn ranks a doll's layers inside a tier: the standing one first, the ones inside after
export const RANK_STANDING = 2;
export const RANK_WAITING = 4;

// The doll's cells when `consumed` layers have gone: the centered square of the shrunken side, in the order the level
// listed them
export function squareCells(grid, doll, consumed) {
  const start = doll.side;
  const side = Math.max(start - 2 * consumed, start % 2 === 1 ? 3 : 4);
  const trim = Math.floor((start - side) / 2);
  const [lowX, lowY] = doll.low;
  return doll.cells.filter((cell) => {
    const x = cell % grid.width;
    const y = Math.floor(cell / grid.width);
    return x >= lowX + trim && x < lowX + trim + side && y >= lowY + trim && y < lowY + trim + side;
  });
}

// Every doll as a record in file order, one target per layer; the outermost living one stands on the cells
export function setup(state) {
  const listed = state.level.features.matryoshkas;
  if (!listed || !listed.Matryoshkas.length) {
    return;
  }
  const { grid } = state;
  const dolls = [];
  for (const data of listed.Matryoshkas) {
    const points = data.GridPoints.filter(
      (point) => point.X >= 0 && point.X < grid.width && point.Y >= 0 && point.Y < grid.height,
    );
    const cells = points.map((point) => gridx.cellOf(grid, point.X, point.Y));
    const layers = [];
    for (const item of data.Layers) {
      const target = gridx.makeTarget(NUMBER, item.MaterialId, item.Health);
      target.dead = item.Health <= 0;
      gridx.add(grid, target, []);
      layers.push(target.id);
    }
    const lowX = Math.min(...points.map((point) => point.X));
    const lowY = Math.min(...points.map((point) => point.Y));
    const doll = {
      cells,
      layers,
      side: Math.max(...points.map((point) => point.X)) - lowX + 1,
      low: [lowX, lowY],
      current: layers.length,
    };
    dolls.push(doll);
    advance(state, doll);
  }
  state.features[NUMBER] = { dolls };
}

// Layers gone so far
export function consumed(state, doll) {
  return doll.layers.filter((targetId) => state.grid.targets[targetId].dead).length;
}

// Stand the outermost living layer below the current one on the doll's shrunken square. False when none is left (the
// doll is gone)
export function advance(state, doll) {
  const { grid } = state;
  for (let index = doll.current - 1; index >= 0; index--) {
    const target = grid.targets[doll.layers[index]];
    if (!target.dead) {
      doll.current = index;
      gridx.move(grid, target, squareCells(grid, doll, consumed(state, doll)));
      return true;
    }
  }
  doll.current = -1;
  return false;
}

export function dollOf(state, targetId) {
  const dolls = state.features[NUMBER].dolls;
  const index = dolls.findIndex((doll) => doll.layers.includes(targetId));
  return [index, dolls[index]];
}

// A shot lands on a layer: it loses health and at 0 it is gone; when it was the standing one the next layer inside
// opens at once and the square shrinks, and the doll is gone with the last layer
export function onHit(state, target, damage, source) {
  const [index, doll] = dollOf(state, target.id);
  target.health = Math.max(0, target.health - damage);
  const cell = source === null ? -1 : source.cell;
  base.emit(state, "hit", { target: target.id, cell, health: target.health });
  if (target.health > 0) {
    return;
  }
  const standing = doll.layers.indexOf(target.id) === doll.current;
  target.dead = true;
  gridx.remove(state.grid, target);
  base.emit(state, "target_died", { target: target.id, owner: NUMBER });
  if (!standing) {
    checks.requestWinCheck(state);
    return;
  }
  if (advance(state, doll)) {
    const inner = doll.layers[doll.current];
    base.emit(state, "doll_open", { doll: index, layer: doll.current, from: target.id, target: inner });
    base.emit(state, "hit", { target: inner, cell: -1, health: state.grid.targets[inner].health });
  } else {
    base.emit(state, "doll_gone", { doll: index, target: target.id });
  }
  checks.requestWinCheck(state);
}

// The hits the living layers of this color still take, the ones inside too
export function remainingHits(state, color) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return 0;
  }
  let total = 0;
  for (const doll of mine.dolls) {
    for (const targetId of doll.layers) {
      const target = state.grid.targets[targetId];
      if (!target.dead && target.color === color) {
        total += target.health;
      }
    }
  }
  return total;
}

// The Super Unicorn's rank of the standing layer, which it finds as an ordinary feature target
export function unicornRank() {
  return RANK_STANDING;
}

// For the Super Unicorn: [target id, cells, tier, rank, hits] for every layer of this color inside the standing one, on
// the cells the doll stands on now
export function unicornReserves(state, color) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return [];
  }
  const found = [];
  for (const doll of mine.dolls) {
    if (doll.current < 0) {
      continue;
    }
    const cells = [...state.grid.targets[doll.layers[doll.current]].cells];
    const tier = unicorn.blockedOn(state, cells, -1) ? unicorn.TIER_BLOCKED_FEATURE : unicorn.TIER_OPEN_FEATURE;
    for (let index = doll.current - 1; index >= 0; index--) {
      const target = state.grid.targets[doll.layers[index]];
      if (!target.dead && target.color === color) {
        found.push([target.id, cells, tier, RANK_WAITING, target.health]);
      }
    }
  }
  return found;
}

// The hits the layer takes while it waits inside; 0 once it stands (the Unicorn then finds it on the grid)
export function unicornReserveLeft(state, targetId, color) {
  const target = state.grid.targets[targetId];
  const [, doll] = dollOf(state, targetId);
  if (target.dead || target.color !== color || doll.layers.indexOf(targetId) >= doll.current) {
    return 0;
  }
  return target.health;
}

// A Super Unicorn shot at a waiting layer hits it where it waits. Nothing is left for the Unicorn to break
export function unicornPop(state, targetId) {
  aim.hit(state, state.grid.targets[targetId], 1, null);
  return null;
}

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  let out = base.mix(h, mine.dolls.length);
  for (const doll of mine.dolls) {
    out = base.mix(base.mix(out, doll.current), doll.layers.length);
    for (const targetId of doll.layers) {
      const target = state.grid.targets[targetId];
      out = base.mix(base.mix(out, target.health), target.dead ? 1 : 0);
    }
  }
  return out;
}
