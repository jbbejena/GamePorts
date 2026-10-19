// Feature 21, Curtains: an obstacle over a patch of cubes, in stacked blocks that open one after another, bottom first.
// A curtain holds a list of segments, each with a color and a health. Segment i owns block (count - 1 - i) of the
// curtain's cells, listed row by row from the bottom, one block being BaseArea.x * BaseArea.y cells (CurtainModel$$Setup,
// RVA 0x5656E7C, takes GetRange(block * area, area) of the grid points). So the last segment is the bottom block and the
// first one is the top block (CurtainFeature$$SetSegments, RVA 0x5647E14, makes the last segment the active one). Every
// death of a single-cell cube anywhere whose color is the active segment's does 1 to every curtain whose active color it
// is, unless that curtain's pending damage is already lethal (CurtainFeatureController$$OnTargetDeath, RVA 0x564E624,
// skips big cubes; DamageCurtains, RVA 0x564E040). The damage is pending at once and lands when a copy of the cube
// finishes its jump into the curtain, CUBE_FLY_IN ticks later (CurtainFeature$$DamageCurtain, RVA 0x564B148). The moment
// the pending damage is lethal the active block's cells are free (ReleaseSegmentOccupation, RVA 0x5647B18), and when that
// was the top block the curtain leaves the grid there and then. When the damage lands and the segment's health reaches 0
// the segment closes and the next one becomes the active one (OnDamage, RVA 0x5649A74; CloseActiveSegment, RVA
// 0x564735C). The curtain is an IRemovablePixelGridObstacle: RemoveObstacle (RVA 0x564731C) closes every segment and
// leaves, which the Curtains Closed! revive (MapRescueController.<RemoveCurtains>d__28) and the Obstacles revive both do.
// Shots never hit a curtain, and nothing holds the stuck check. The health sync booster is left out.
// common/sim/features/curtain.py mirrors this file.
import * as base from "../base.js";
import * as gridx from "../grid.js";
import { CUBE_FLY_IN } from "../numbers.js";

export const NUMBER = 21;

// Every curtain as a record, in file order, with its body standing on all its cells as an obstacle
export function setup(state) {
  const listed = state.level.features.curtains;
  if (!listed || !listed.Curtains.length) {
    return;
  }
  const { grid } = state;
  const curtains = [];
  for (const data of listed.Curtains) {
    const cells = data.GridPoints.filter(
      (point) => point.X >= 0 && point.X < grid.width && point.Y >= 0 && point.Y < grid.height,
    ).map((point) => gridx.cellOf(grid, point.X, point.Y));
    const area = data.BaseArea.x * data.BaseArea.y;
    const count = data.Segments.length;
    const segments = data.Segments.map((segment, index) => {
      const first = (count - 1 - index) * area;
      return {
        color: segment.Material,
        start: segment.Health,
        left: segment.Health,
        cells: cells.slice(first, first + area),
        freed: false,
      };
    });
    const body = gridx.makeTarget(NUMBER, -1, 1, true, false);
    gridx.add(grid, body, cells);
    curtains.push({ target: body.id, segments, active: count - 1, pending: 0 });
  }
  state.features[NUMBER] = { curtains };
}

function standing(state, curtain) {
  return !state.grid.targets[curtain.target].dead;
}

// A single-cell cube died: every curtain whose active segment is its color and isn't doomed gets 1 damage on its way
export function onEvent(state, name, data) {
  const mine = state.features[NUMBER];
  if (!mine || name !== "cube_died" || !data.single) {
    return;
  }
  mine.curtains.forEach((curtain, index) => {
    if (!standing(state, curtain) || curtain.active < 0) {
      return;
    }
    const segment = curtain.segments[curtain.active];
    if (segment.color !== data.color || curtain.pending >= segment.left) {
      return;
    }
    curtain.pending += 1;
    base.schedule(state, CUBE_FLY_IN, "curtain_land", index);
    base.emit(state, "curtain_feed", { curtain: index, segment: curtain.active, cell: data.cell, color: data.color });
    if (curtain.pending >= segment.left) {
      doom(state, index, curtain.active);
    }
  });
}

// The pending damage is lethal: the active block's cells are free now, and the curtain is gone if that was the top block
function doom(state, index, segmentIndex) {
  freeBlock(state, index, segmentIndex, "cubes");
  if (segmentIndex <= 0) {
    leave(state, index);
  }
}

// A block's cells leave the curtain's body. The hit event makes keys and Surprise Pixels look at the picture again
function freeBlock(state, index, segmentIndex, why) {
  const curtain = state.features[NUMBER].curtains[index];
  const segment = curtain.segments[segmentIndex];
  const body = state.grid.targets[curtain.target];
  if (segment.freed || body.dead) {
    return;
  }
  segment.freed = true;
  const freed = new Set(segment.cells);
  gridx.move(
    state.grid,
    body,
    body.cells.filter((cell) => !freed.has(cell)),
  );
  base.emit(state, "curtain_free", { curtain: index, segment: segmentIndex, why });
  base.emit(state, "hit", { target: body.id, cell: -1, health: body.health });
}

// The curtain is gone from the grid
function leave(state, index) {
  const curtain = state.features[NUMBER].curtains[index];
  const body = state.grid.targets[curtain.target];
  if (body.dead) {
    return;
  }
  body.health = 0;
  body.dead = true;
  gridx.remove(state.grid, body);
  base.emit(state, "curtain_leave", { curtain: index, target: body.id });
  base.emit(state, "hit", { target: body.id, cell: -1, health: 0 });
}

// Timer: the cube copy lands in the curtain, whose active segment loses 1 health and closes at 0
export function curtainLand(state, index) {
  const curtain = state.features[NUMBER].curtains[index];
  curtain.pending = Math.max(0, curtain.pending - 1);
  if (curtain.active < 0) {
    return;
  }
  const segmentIndex = curtain.active;
  const segment = curtain.segments[segmentIndex];
  segment.left -= 1;
  base.emit(state, "curtain_hit", { curtain: index, segment: segmentIndex, left: segment.left });
  if (segment.left <= 0) {
    close(state, index, "cubes");
  }
}

// The active segment closes and the next one down the list becomes the active one
function close(state, index, why) {
  const curtain = state.features[NUMBER].curtains[index];
  const segmentIndex = curtain.active;
  freeBlock(state, index, segmentIndex, why);
  curtain.active -= 1;
  base.emit(state, "curtain_close", { curtain: index, segment: segmentIndex, why });
}

base.registerTimer("curtain_land", base.PHASE_FEATURES, curtainLand);

// The stuck fail's name counts the curtains still standing
export function failCounts(state) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return {};
  }
  return { curtain: mine.curtains.filter((curtain) => standing(state, curtain)).length };
}

// The Curtains Closed! and Obstacles revives close every segment of every standing curtain, in file order, and the
// curtains leave. Returns the ticks the revive waits (none)
export function revive(state, name) {
  const mine = state.features[NUMBER];
  if ((name !== "curtain" && name !== "obstacles") || !mine) {
    return 0;
  }
  mine.curtains.forEach((curtain, index) => {
    if (!standing(state, curtain)) {
      return;
    }
    while (curtain.active >= 0) {
      close(state, index, "revive");
    }
    leave(state, index);
  });
  return 0;
}

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  h = base.mix(h, mine.curtains.length);
  for (const curtain of mine.curtains) {
    h = base.mix(base.mix(h, state.grid.targets[curtain.target].dead ? 1 : 0), curtain.active);
    h = base.mix(h, curtain.pending);
    for (const segment of curtain.segments) {
      h = base.mix(base.mix(h, segment.left), segment.freed ? 1 : 0);
    }
  }
  return h;
}
