// Feature 23, the Dragon: a body of colored segments along a snake-like path, each segment its own target.
// The path is the Snake's (spline.bodySections and spline.controlPoints over the nest and its corner squares), but
// nest first and with two more control points straight under the nest center, so the body rises out of the board
// (MultiSnakeFeature$$SyncSplinePoints, RVA 0x5695C18: startPaddingDistance 2.0 world units, then 0.01 under it). The
// body's cross-sections ("slices") are the Snake's with every cell kept only in its first slice and empty slices
// dropped (RemoveDuplicateSlicePoints, RVA 0x5699C20).
// A segment covers a stretch of the path, from and to as shares of its length. Which slices that stretch covers comes
// from a table worked out once (BuildSliceCoverage, RVA 0x56A3670): at evenly spaced points along the path, a few
// points across the body are looked up, and each slice keeps the lowest and highest share that landed on it
// (MultiSnakeSliceCoverage Seal, FillUncoveredSlices, CloseCoverageGaps). A segment's slices are every slice whose
// shares overlap its stretch (TryGetSliceRange, RVA 0x56AEA7C), and the first living segment always reaches slice 0
// (the nest). Neighbors usually share their boundary slice, so a cell can hold two segments.
// At the start every segment takes the stretch the level gives it (InitializeSegmentCaches, RVA 0x5696B88). After
// every hit on any segment the stretches are worked out again (OnSegmentDamaged, RVA 0x569ABC4;
// RecalculateClipRanges, RVA 0x569A428): each living segment's length is minLen + health% x (L - minLen), with L its
// starting length and minLen the smaller of one cell and L / 2 (ComputeSegmentTargetLengths, RVA 0x5698C4C), and the
// segments are laid end to end from the nest by walking the path's samples (SampleCollection$$Travel, RVA
// 0x5E00890). A dead segment leaves the grid and the dragon is gone when none live. No part of it is an obstacle (the
// nest blocks nothing once it is gone).
// The path's samples and tables stay out of the state, in PATHS, worked out once per dragon (the CPU player
// deep-copies states). Lengths are in cubes; the original works in float32 with world units, this port in doubles
// with float32 rounding where the original's formulas round, so it can land one slice away from the original at rare
// points. common/sim/features/dragon.py mirrors this file.
import * as base from "../base.js";
import * as checks from "../checks.js";
import * as gridx from "../grid.js";
import { f32 } from "../mathx.js";
import { L_PER_UNIT } from "../numbers.js";
import * as spline from "../spline.js";

export const NUMBER = 23;

// startPaddingDistance (world units, not scaled by the cube size) and the second point's depth under the nest
const PADDING = 2.0;
const PADDING_TOP = 0.01;
// minSegmentLengthCells times the cube size plus the grid's spacing (0), in cubes
const MIN_LENGTH = 1.0;
// The first living segment always starts here (RecalculateClipRanges)
export const START = f32(0.0001);
// BuildSliceCoverage's sample count: slices x 24, kept within 128..2048
const SLICE_SAMPLES = 24;
const LEAST_SAMPLES = 128;
const MOST_SAMPLES = 2048;
const NO_RIGHT = 1e-5;
const FLOAT_MAX = 3.4028234663852886e38;

// Every dragon's path, by keyOf
const PATHS = new Map();

// The nest, then each corner square, as lists of [x, y] cells
export function squaresOf(data) {
  const squares = [data.MainGridPoints.map((point) => [point.X, point.Y])];
  for (const square of data.SnakeGridPoints) {
    squares.push(square.GridPoints.map((point) => [point.X, point.Y]));
  }
  return squares;
}

// What a dragon's path depends on, as text
export function keyOf(width, height, pw, data) {
  const clips = data.Segments.map((segment) => [segment.ClipFrom, segment.ClipTo]);
  return JSON.stringify([width, height, pw, squaresOf(data), clips]);
}

// The Snake's control points the other way round (nest first), lifted to [x, y, height], with the two points under
// the nest center first
export function controlPoints(squares, padding) {
  const flat = spline.controlPoints(squares, spline.STRAIGHT_DISTANCE);
  flat.reverse();
  let points = flat.map(([x, y]) => [x, y, 0.0]);
  if (padding > 0.0) {
    const nest = points[0];
    points = [[nest[0], nest[1], -padding], [nest[0], nest[1], -PADDING_TOP], ...points];
  }
  return points;
}

// The body's cross-sections, nest first, each cell only in its first section and no empty ones (each section walked
// from its end, as RemoveDuplicateSlicePoints walks it)
export function slicesOf(squares) {
  const seen = new Set();
  const kept = [];
  for (const section of spline.bodySections(squares)) {
    const cells = [];
    for (let i = section.length - 1; i >= 0; i--) {
      const [x, y] = section[i];
      if (!seen.has(`${x},${y}`)) {
        seen.add(`${x},${y}`);
        cells.push([x, y]);
      }
    }
    cells.reverse();
    if (cells.length) {
      kept.push(cells);
    }
  }
  return kept;
}

// The sample before percent and the share past it (SampleCollection$$GetSamplingValues, uniform samples)
export function sampling(path, percent) {
  const spot = (path.samples.length - 1) * percent;
  const index = Math.floor(spot);
  return [index, spot - index];
}

export function samplePercent(path, index) {
  return index / (path.samples.length - 1);
}

// The point percent of the way along, blending the two nearest samples (SampleCollection$$EvaluatePosition)
export function position(path, percent) {
  const { samples } = path;
  const [index, rawShare] = sampling(path, percent);
  if (rawShare <= 0.0) {
    return samples[index];
  }
  const share = spline.clamp01(rawShare);
  const [a, b] = [samples[index], samples[index + 1]];
  return [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * share);
}

// The path's length from start to end, sample to sample (SampleCollection$$CalculateLength, RVA 0x5E05F0C)
export function stretchLength(path, start, end) {
  const { samples } = path;
  let here = position(path, start);
  const [first] = sampling(path, start);
  let [last, share] = sampling(path, end);
  if (share > 0.0 && last < samples.length - 1) {
    last += 1;
  }
  let length = 0.0;
  for (let index = first + 1; index < last; index++) {
    length += spline.distance(samples[index], here);
    here = samples[index];
  }
  return length + spline.distance(position(path, end), here);
}

// The share of the way `length` farther on from start, walking sample to sample (SampleCollection$$Travel)
export function travel(path, start, length) {
  if (start >= 1.0) {
    return 1.0;
  }
  if (length === 0.0) {
    return spline.clamp01(start);
  }
  const { samples } = path;
  let here = position(path, start);
  let before = start;
  let [index, share] = sampling(path, start);
  if (share > 0.0) {
    index += 1;
  }
  let moved = 0.0;
  let gap = 0.0;
  while (moved < length) {
    gap = spline.distance(samples[index], here);
    moved += gap;
    if (moved >= length) {
      break;
    }
    here = samples[index];
    before = samplePercent(path, index);
    if (index === samples.length - 1) {
      break;
    }
    index += 1;
  }
  const excess = moved > length ? moved - length : 0.0;
  const back = gap > 0.0 ? excess / gap : 0.0;
  return before + (samplePercent(path, index) - before) * (1.0 - back);
}

// Where control point `point` sits on the evenly spaced samples (SplineComputer$$GetPointPercent, RVA 0x5DB4924):
// its share of the control points, found among the samples' own spots on the spline
export function pointPercent(path, point) {
  const wanted = spline.clamp01(point / (path.points.length - 1));
  const { spots } = path;
  for (let index = spots.length - 2; index >= 0; index--) {
    if (spots[index] < wanted) {
      const [low, high] = [spots[index], spots[index + 1]];
      const share = low === high ? 0.0 : spline.clamp01((wanted - low) / (high - low));
      const lowPercent = samplePercent(path, index);
      return lowPercent + (samplePercent(path, index + 1) - lowPercent) * share;
    }
  }
  return 0.0;
}

// The point percent of the way along and the flat unit direction across the body there (cross(up, forward); zero
// where the path runs straight up). The forward blends the two nearest samples' headings.
export function across(path, percent) {
  const { headings } = path;
  const [index, rawShare] = sampling(path, percent);
  let heading = headings[index];
  if (rawShare > 0.0) {
    const share = spline.clamp01(rawShare);
    const other = headings[index + 1];
    heading = [0, 1, 2].map((k) => heading[k] + (other[k] - heading[k]) * share);
  }
  const size = spline.distance([0.0, 0.0, 0.0], heading);
  const side = Math.sqrt(heading[0] * heading[0] + heading[1] * heading[1]);
  if (size <= 0.0 || side / size <= NO_RIGHT) {
    return [position(path, percent), [0.0, 0.0]];
  }
  return [position(path, percent), [heading[1] / side, -heading[0] / side]];
}

function newCoverage(count) {
  return { low: new Array(count).fill(FLOAT_MAX), high: new Array(count).fill(-FLOAT_MAX) };
}

function covered(coverage, index) {
  return coverage.low[index] <= coverage.high[index];
}

// The next covered slice from index (not counting it) in direction step, or -1
function nearestCovered(coverage, start, step) {
  let index = start + step;
  while (index >= 0 && index < coverage.low.length) {
    if (covered(coverage, index)) {
      return index;
    }
    index += step;
  }
  return -1;
}

// Give every slice a share range (MultiSnakeSliceCoverage$$Seal, RVA 0x56ADEAC): the end slices copy the nearest
// covered one, a gap takes the shares between its covered neighbors, touching slices meet halfway, and the first slice
// starts at 0 and the last ends at 1
export function seal(coverage) {
  const { low, high } = coverage;
  const count = low.length;
  const first = nearestCovered(coverage, -1, 1);
  if (first < 0) {
    coverage.low = new Array(count).fill(0.0);
    coverage.high = new Array(count).fill(1.0);
    return;
  }
  const last = nearestCovered(coverage, count, -1);
  for (let index = 0; index < first; index++) {
    [low[index], high[index]] = [low[first], high[first]];
  }
  for (let index = last + 1; index < count; index++) {
    [low[index], high[index]] = [low[last], high[last]];
  }
  for (let index = 0; index < count; index++) {
    if (covered(coverage, index)) {
      continue;
    }
    const before = nearestCovered(coverage, index, -1);
    const after = nearestCovered(coverage, index, 1);
    const start = before >= 0 ? high[before] : 0.0;
    const end = after >= 0 ? low[after] : 1.0;
    [low[index], high[index]] = [Math.min(start, end), Math.max(start, end)];
  }
  for (let index = 0; index < count - 1; index++) {
    if (high[index] < low[index + 1]) {
      const middle = f32((high[index] + low[index + 1]) * 0.5);
      high[index] = middle;
      low[index + 1] = middle;
    }
  }
  low[0] = 0.0;
  high[count - 1] = 1.0;
}

// Each slice's lowest and highest share of the path (BuildSliceCoverage): at count + 1 evenly spaced shares, the
// points across the body (2a - 1 of them, at least 3, a the nest's larger side) are looked up by cell
export function buildCoverage(path, nest) {
  const count = path.slices.length;
  const coverage = newCoverage(count);
  const steps = Math.min(Math.max(count * SLICE_SAMPLES, LEAST_SAMPLES), MOST_SAMPLES);
  const xs = nest.map(([x]) => x);
  const ys = nest.map(([, y]) => y);
  const side = Math.max(Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1, 1);
  const points = Math.max(2 * side - 1, 3);
  const half = (side - 1) / 2;
  for (let step = 0; step <= steps; step++) {
    const percent = f32(step / steps);
    const [middle, right] = across(path, percent);
    for (let point = 0; point < points; point++) {
      const offset = spline.clamp01(f32(point / (points - 1))) * (half + half) - half;
      const x = spline.roundEven(middle[0] + right[0] * offset);
      const y = spline.roundEven(middle[1] + right[1] * offset);
      const index = path.lookup[`${x},${y}`] ?? -1;
      if (index >= 0) {
        coverage.low[index] = Math.min(coverage.low[index], percent);
        coverage.high[index] = Math.max(coverage.high[index], percent);
      }
    }
  }
  seal(coverage);
  return coverage;
}

// The first and last slice whose shares overlap start..end; with none, the slice nearest its middle
export function sliceRange(path, start, end) {
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const lows = path.low;
  const highs = path.high;
  let first = -1;
  let last = -1;
  for (let index = 0; index < lows.length; index++) {
    if (highs[index] >= low && lows[index] <= high) {
      if (first < 0) {
        first = index;
      }
      last = index;
    }
  }
  if (first >= 0) {
    return [first, last];
  }
  const middle = f32((low + high) * 0.5);
  let best = 0;
  let bestGap = FLOAT_MAX;
  for (let index = 0; index < lows.length; index++) {
    let gap = 0.0;
    if (lows[index] > middle) {
      gap = lows[index] - middle;
    } else if (highs[index] < middle) {
      gap = middle - highs[index];
    }
    if (gap < bestGap) {
      bestGap = gap;
      best = index;
    }
  }
  return [best, best];
}

// A dragon's path, worked out the first time it is asked for
export function pathOf(level, data) {
  const key = keyOf(level.width, level.height, level.pw, data);
  if (!PATHS.has(key)) {
    PATHS.set(key, makePath(level, data));
  }
  return PATHS.get(key);
}

// The control points, the evenly spaced samples (with their spots on the spline and headings), the slices, the slice
// table, the share under the padding and each segment's starting length
export function makePath(level, data) {
  const squares = squaresOf(data);
  const padding = (PADDING * L_PER_UNIT * Math.max(level.width, level.height)) / level.pw;
  const points = controlPoints(squares, padding);
  const spots = spline.uniformPercents(points);
  const slices = slicesOf(squares);
  const lookup = {};
  slices.forEach((section, index) => {
    for (const [x, y] of section) {
      lookup[`${x},${y}`] = index;
    }
  });
  const path = {
    points,
    spots,
    samples: spots.map((spot) => spline.bsplineAt(points, spot)),
    headings: spots.map((spot) => spline.bsplineHeading(points, spot)),
    slices,
    cells: spline.crossSections({ sections: slices }, [level.width, level.height]),
    lookup,
  };
  const coverage = buildCoverage(path, squares[0]);
  path.low = coverage.low;
  path.high = coverage.high;
  const pad = padding > 0.0 ? f32(pointPercent(path, 2)) : 0.0;
  path.pad = pad;
  path.starts = data.Segments.map((segment) => initialStretch(pad, segment));
  path.lengths = path.starts.map(([start, end]) => f32(stretchLength(path, start, end)));
  return path;
}

// A segment's stretch as the level gives it, moved past the padding
export function initialStretch(pad, segment) {
  const rest = f32(1.0 - pad);
  return [f32(pad + f32(rest * segment.ClipFrom)), f32(pad + f32(rest * segment.ClipTo))];
}

// Every segment's stretch at these healths (null for a dead one): living segments end to end from the nest, each
// minLen + health% x (L - minLen) long, the first starting at START
export function stretches(path, segments, healths) {
  let cursor = f32(path.pad + START);
  let first = true;
  const out = [];
  healths.forEach((health, index) => {
    if (health <= 0) {
      out.push(null);
      return;
    }
    const whole = path.lengths[segments[index].slot];
    const least = Math.min(MIN_LENGTH, f32(whole * 0.5));
    const percent = f32(f32(health) / f32(segments[index].count));
    const length = f32(least + f32(percent * f32(whole - least)));
    const start = first ? START : cursor;
    first = false;
    if (length > 0.0) {
      cursor = Math.min(f32(travel(path, cursor, length)), 1.0);
    }
    out.push([start, cursor]);
  });
  return out;
}

// [start, end] slices a stretch covers; the first living segment reaches the nest
export function slicesFor(path, stretch, first) {
  let [start, end] = sliceRange(path, stretch[0], stretch[1]);
  if (first && start >= 1) {
    start = 0;
  }
  return [start, end];
}

export function cellsFor(path, span) {
  const cells = [];
  for (const section of path.cells.slice(span[0], Math.min(span[1], path.cells.length - 1) + 1)) {
    cells.push(...section);
  }
  return cells;
}

// Every dragon as a record, in file order, with each segment's target on its starting slices
export function setup(state) {
  const listed = state.level.features.multiSnakes;
  if (!listed || !listed.MultiSnakes.length) {
    return;
  }
  const { grid } = state;
  const dragons = [];
  for (const data of listed.MultiSnakes) {
    const path = pathOf(state.level, data);
    const segments = [];
    data.Segments.forEach((item, slot) => {
      // A segment of no health is a leftover the original never creates (CreateSegmentInstances)
      if (item.Count <= 0) {
        return;
      }
      let stretch = path.starts[slot];
      const first = !segments.length;
      // The first segment reaches from the very start of the path (InitializeSegmentCaches)
      if (first) {
        stretch = [START, stretch[1]];
      }
      const span = slicesFor(path, stretch, first);
      const target = gridx.makeTarget(NUMBER, item.Material, item.Count);
      gridx.add(grid, target, cellsFor(path, span));
      segments.push({ target: target.id, slot, count: item.Count, span });
    });
    dragons.push({ key: keyOf(grid.width, grid.height, state.level.pw, data), segments });
  }
  state.features[NUMBER] = { dragons };
}

// The path a dragon record lies along
export function pathFor(dragon) {
  return PATHS.get(dragon.key);
}

// Lay the living segments out again at their healths and move their targets; true when any moved
export function relay(state, dragon) {
  const { grid } = state;
  const path = pathFor(dragon);
  const targets = dragon.segments.map((segment) => grid.targets[segment.target]);
  const laid = stretches(
    path,
    dragon.segments,
    targets.map((target) => target.health),
  );
  let moved = false;
  let first = true;
  dragon.segments.forEach((segment, index) => {
    const stretch = laid[index];
    if (stretch === null) {
      // A dead segment holds no slices (UpdateSegmentSlices sets both to -1)
      segment.span = [-1, -1];
      return;
    }
    const span = slicesFor(path, stretch, first);
    first = false;
    if (span[0] !== segment.span[0] || span[1] !== segment.span[1]) {
      segment.span = span;
      gridx.move(grid, targets[index], cellsFor(path, span));
      moved = true;
    }
  });
  return moved;
}

// A shot lands on a segment: it loses health, every segment is laid out again, and at 0 it leaves the grid
export function onHit(state, target, damage, source) {
  const { dragons } = state.features[NUMBER];
  const index = dragons.findIndex((d) => d.segments.some((s) => s.target === target.id));
  const dragon = dragons[index];
  target.health = Math.max(0, target.health - damage);
  const cell = source === null ? -1 : source.cell;
  base.emit(state, "hit", { target: target.id, cell, health: target.health });
  if (target.health === 0) {
    target.dead = true;
    gridx.remove(state.grid, target);
  }
  if (relay(state, dragon)) {
    base.emit(state, "dragon_move", { dragon: index });
  }
  if (!target.dead) {
    return;
  }
  base.emit(state, "target_died", { target: target.id, owner: NUMBER });
  if (dragon.segments.every((segment) => state.grid.targets[segment.target].dead)) {
    base.emit(state, "dragon_gone", { dragon: index });
  }
  checks.requestWinCheck(state);
}

// The hits the living segments of this color still take
export function remainingHits(state, color) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return 0;
  }
  let total = 0;
  for (const dragon of mine.dragons) {
    for (const segment of dragon.segments) {
      const target = state.grid.targets[segment.target];
      if (!target.dead && target.color === color) {
        total += target.health;
      }
    }
  }
  return total;
}

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  h = base.mix(h, mine.dragons.length);
  for (const dragon of mine.dragons) {
    h = base.mix(h, dragon.segments.length);
    for (const segment of dragon.segments) {
      const target = state.grid.targets[segment.target];
      h = base.mix(base.mix(h, target.health), target.dead ? 1 : 0);
      h = base.mix(base.mix(h, segment.span[0]), segment.span[1]);
    }
  }
  return h;
}
