// Feature 34, the Pixel Mixer: a machine over a patch of cubes whose hose is drained by cubes of its color dying.
// The body and every hose block stand on the grid as one obstacle that shots never hit. Every destroyed single-cell cube
// of the mixer's color anywhere does 1 damage to it at once (PixelMixerFeature$$OnTargetDeath, RVA 0x56E6318, skips big
// cubes and a mixer that is spent). The health is split over one stage per straight hose block: a corner block is a
// square whose cell count is the hose's width squared (PixelMixerTailLogic$$IsCornerBlock, RVA 0x99CE288, with the width
// the longer side of the first block, PixelMixerFeature$$get_TailWidth, RVA 0x56E1D00). Each stage costs HpPerBlock, and
// the first `H - HpPerBlock x N` stages cost one more (PixelMixerSchedule$$FromCapacity, RVA 0x99CD1F0, and $$StageHp,
// RVA 0x99CD0B4). When a stage's health runs out (PixelMixerFeature$$OnDamage, RVA 0x56E8648) the next batch of hose
// blocks is released from the tip: the corners at the tip, one straight block, then the corners behind it
// (ReleaseNextBatch, RVA 0x56E46A4). The cubes under released blocks can be shot at once. When no stage is left, every
// block still standing and the body are released (ReleaseAllRemainingBlocks, RVA 0x56E2A68). The mixer implements
// IRemovablePixelGridObstacle, so the Obstacles revive releases all of it (cpw, RVA 0x56E2A24).
// common/sim/features/pixel_mixer.py mirrors this file.
import * as base from "../base.js";
import * as gridx from "../grid.js";
import { idiv } from "../mathx.js";

export const NUMBER = 34;

// The hose's width: the longer side of the first block's bounding box, at least 1
function tailWidth(blocks, grid) {
  if (!blocks.length) {
    return 1;
  }
  const xs = blocks[0].map((cell) => cell % grid.width);
  const ys = blocks[0].map((cell) => idiv(cell, grid.width));
  return Math.max(Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1, 1);
}

function cellsOf(grid, points) {
  return points
    .filter((point) => point.X >= 0 && point.X < grid.width && point.Y >= 0 && point.Y < grid.height)
    .map((point) => gridx.cellOf(grid, point.X, point.Y));
}

// Every mixer as a record, in file order, with its body and hose standing on their cells as one obstacle
export function setup(state) {
  const listed = state.level.features.pixelMixers;
  if (!listed || !listed.Mixers.length) {
    return;
  }
  const { grid } = state;
  const mixers = [];
  for (const data of listed.Mixers) {
    const body = cellsOf(grid, data.GridPoints);
    const blocks = data.TailGridPoints.map((block) => cellsOf(grid, block.GridPoints));
    const width = tailWidth(blocks, grid);
    const corners = blocks.map((block) => width > 1 && block.length === width * width);
    const stages = Math.max(1, corners.filter((corner) => !corner).length);
    const perBlock = Math.max(1, idiv(data.Health, stages));
    const bonus = Math.max(0, data.Health - perBlock * stages);
    const target = gridx.makeTarget(NUMBER, -1, 0, true, false);
    gridx.add(grid, target, [...body, ...blocks.flat()]);
    const mixer = {
      target: target.id,
      color: data.Material,
      body,
      blocks,
      corners,
      stages,
      perBlock,
      bonus,
      released: 0,
      left: 0,
      spent: false,
    };
    mixer.left = stageHp(mixer, stages);
    target.health = mixer.left;
    mixers.push(mixer);
  }
  state.features[NUMBER] = { mixers };
}

// What the stage with this many stages left (itself included) costs: the first `bonus` stages cost one more
function stageHp(mixer, stagesLeft) {
  return mixer.perBlock + (mixer.stages - mixer.bonus < stagesLeft ? 1 : 0);
}

// Whether the block this many places from the tip is a corner (false past the body end)
function cornerFromTip(mixer, index) {
  const place = mixer.blocks.length - 1 - index;
  return place >= 0 && mixer.corners[place];
}

// Straight blocks among the ones released so far
function releasedStages(mixer) {
  let count = 0;
  for (let step = 0; step < mixer.released; step++) {
    if (!cornerFromTip(mixer, step)) {
      count += 1;
    }
  }
  return count;
}

// Take these cells off the mixer's obstacle
function freeCells(state, mixer, cells) {
  const target = state.grid.targets[mixer.target];
  const gone = new Set(cells);
  gridx.move(
    state.grid,
    target,
    target.cells.filter((cell) => !gone.has(cell)),
  );
}

// The block next from the tip leaves: its cells are free at once
function releaseOne(state, index) {
  const mixer = state.features[NUMBER].mixers[index];
  const place = mixer.blocks.length - 1 - mixer.released;
  mixer.released += 1;
  freeCells(state, mixer, mixer.blocks[place]);
  base.emit(state, "mixer_release", { mixer: index, block: place, corner: mixer.corners[place] });
}

function releaseCorners(state, index) {
  const mixer = state.features[NUMBER].mixers[index];
  while (mixer.released < mixer.blocks.length && cornerFromTip(mixer, mixer.released)) {
    releaseOne(state, index);
  }
}

// Corners at the tip, one straight block, then the corners behind it
function releaseBatch(state, index) {
  const mixer = state.features[NUMBER].mixers[index];
  releaseCorners(state, index);
  if (mixer.released < mixer.blocks.length) {
    releaseOne(state, index);
  }
  releaseCorners(state, index);
}

// A single-cell cube died: every mixer of its color that isn't spent takes 1 damage at once
export function onEvent(state, name, data) {
  const mine = state.features[NUMBER];
  if (!mine || name !== "cube_died" || !data.single) {
    return;
  }
  mine.mixers.forEach((mixer, index) => {
    if (mixer.color === data.color && !mixer.spent) {
      damage(state, index, data.cell);
    }
  });
}

// One point off the standing stage; at 0 the next batch of hose leaves and the next stage starts, or the whole mixer
// goes with the last
function damage(state, index, cell) {
  const mixer = state.features[NUMBER].mixers[index];
  const target = state.grid.targets[mixer.target];
  mixer.left -= 1;
  target.health = mixer.left;
  base.emit(state, "mixer_hit", { mixer: index, cell, left: mixer.left });
  if (mixer.left > 0) {
    return;
  }
  releaseBatch(state, index);
  const stagesLeft = mixer.stages - releasedStages(mixer);
  if (stagesLeft >= 1) {
    mixer.left = stageHp(mixer, stagesLeft);
    target.health = mixer.left;
    base.emit(state, "mixer_stage", { mixer: index, left: mixer.left, stages_left: stagesLeft });
  } else {
    finish(state, index, "cubes");
  }
  base.emit(state, "hit", { target: target.id, cell: -1, health: target.health });
}

// Every block still standing and the body are released; the mixer is spent
function finish(state, index, why) {
  const mixer = state.features[NUMBER].mixers[index];
  const target = state.grid.targets[mixer.target];
  mixer.spent = true;
  while (mixer.released < mixer.blocks.length) {
    releaseOne(state, index);
  }
  mixer.left = 0;
  target.health = 0;
  target.dead = true;
  gridx.remove(state.grid, target);
  base.emit(state, "mixer_done", { mixer: index, target: target.id, why });
}

// The Obstacles revive releases every mixer that stands, in file order. Returns the ticks the revive waits (none)
export function revive(state, name) {
  const mine = state.features[NUMBER];
  if (name !== "obstacles" || !mine) {
    return 0;
  }
  mine.mixers.forEach((mixer, index) => {
    if (!mixer.spent) {
      finish(state, index, "revive");
      base.emit(state, "hit", { target: mixer.target, cell: -1, health: 0 });
    }
  });
  return 0;
}

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  h = base.mix(h, mine.mixers.length);
  for (const mixer of mine.mixers) {
    h = base.mix(base.mix(h, mixer.released), mixer.left);
    h = base.mix(h, mixer.spent ? 1 : 0);
  }
  return h;
}
