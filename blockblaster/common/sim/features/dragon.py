"""Feature 23, the Dragon: a body of colored segments along a snake-like path, each segment its own target.

The path is the Snake's (spline.body_sections and spline.control_points over the nest and its corner squares), but
nest first and with two more control points straight under the nest center, so the body rises out of the board
(MultiSnakeFeature$$SyncSplinePoints, RVA 0x5695C18: startPaddingDistance 2.0 world units, then 0.01 under it). The
body's cross-sections ("slices") are the Snake's with every cell kept only in its first slice and empty slices dropped
(RemoveDuplicateSlicePoints, RVA 0x5699C20).

A segment covers a stretch of the path, from and to as shares of its length. Which slices that stretch covers comes
from a table worked out once (BuildSliceCoverage, RVA 0x56A3670): at evenly spaced points along the path, a few
points across the body are looked up, and each slice keeps the lowest and highest share that landed on it
(MultiSnakeSliceCoverage Seal, FillUncoveredSlices, CloseCoverageGaps). A segment's slices are every slice whose
shares overlap its stretch (TryGetSliceRange, RVA 0x56AEA7C), and the first living segment always reaches slice 0
(the nest). Neighbors usually share their boundary slice, so a cell can hold two segments.

At the start every segment takes the stretch the level gives it (InitializeSegmentCaches, RVA 0x5696B88). After every
hit on any segment the stretches are worked out again (OnSegmentDamaged, RVA 0x569ABC4; RecalculateClipRanges, RVA
0x569A428): each living segment's length is minLen + health% x (L - minLen), with L its starting length and minLen
the smaller of one cell and L / 2 (ComputeSegmentTargetLengths, RVA 0x5698C4C), and the segments are laid end to end
from the nest by walking the path's samples (SampleCollection$$Travel, RVA 0x5E00890). A dead segment leaves the
grid and the dragon is gone when none live. No part of it is an obstacle (the nest blocks nothing once it is gone).

The path's samples and tables stay out of the state, in PATHS, worked out once per dragon (the CPU player deep-copies
states). Lengths are in cubes; the original works in float32 with world units, this port in doubles with float32
rounding where the original's formulas round, so it can land one slice away from the original at rare points.
web/sim/features/dragon.js mirrors this file.
"""

from __future__ import annotations

import math
import typing as t

from .. import base, checks, spline
from .. import grid as gridx
from ..mathx import f32
from ..numbers import L_PER_UNIT

NUMBER = 23

# startPaddingDistance (world units, not scaled by the cube size) and the second point's depth under the nest
PADDING = 2.0
PADDING_TOP = 0.01
# minSegmentLengthCells times the cube size plus the grid's spacing (0), in cubes
MIN_LENGTH = 1.0
# The first living segment always starts here (RecalculateClipRanges)
START = f32(0.0001)
# BuildSliceCoverage's sample count: slices x 24, kept within 128..2048
SLICE_SAMPLES = 24
LEAST_SAMPLES = 128
MOST_SAMPLES = 2048
NO_RIGHT = 1e-5
FLOAT_MAX = 3.4028234663852886e38

# Every dragon's path, by key_of
PATHS: dict[str, dict] = {}


def squares_of(data: dict) -> list[list[list[int]]]:
    """The nest, then each corner square, as lists of [x, y] cells."""
    squares = [[[point["X"], point["Y"]] for point in data["MainGridPoints"]]]
    for square in data["SnakeGridPoints"]:
        squares.append([[point["X"], point["Y"]] for point in square["GridPoints"]])
    return squares


def key_of(width: int, height: int, pw: int, data: dict) -> str:
    """What a dragon's path depends on, as text."""
    clips = [[segment["ClipFrom"], segment["ClipTo"]] for segment in data["Segments"]]
    return repr([width, height, pw, squares_of(data), clips])


def control_points(squares: list[list[list[int]]], padding: float) -> list[list[float]]:
    """The Snake's control points the other way round (nest first), lifted to [x, y, height], with the two points
    under the nest center first."""
    flat = spline.control_points(squares, spline.STRAIGHT_DISTANCE)
    flat.reverse()
    points = [[x, y, 0.0] for x, y in flat]
    if padding > 0.0:
        nest = points[0]
        points = [[nest[0], nest[1], -padding], [nest[0], nest[1], -PADDING_TOP]] + points
    return points


def slices_of(squares: list[list[list[int]]]) -> list[list[list[int]]]:
    """The body's cross-sections, nest first, each cell only in its first section and no empty ones (each section
    walked from its end, as RemoveDuplicateSlicePoints walks it)."""
    seen: set[tuple[int, int]] = set()
    kept = []
    for section in spline.body_sections(squares):
        cells = []
        for x, y in reversed(section):
            if (x, y) not in seen:
                seen.add((x, y))
                cells.append([x, y])
        cells.reverse()
        if cells:
            kept.append(cells)
    return kept


def sampling(path: dict, percent: float) -> tuple[int, float]:
    """The sample before percent and the share past it (SampleCollection$$GetSamplingValues, uniform samples)."""
    spot = (len(path["samples"]) - 1) * percent
    index = math.floor(spot)
    return index, spot - index


def sample_percent(path: dict, index: int) -> float:
    return index / (len(path["samples"]) - 1)


def position(path: dict, percent: float) -> list[float]:
    """The point percent of the way along, blending the two nearest samples (SampleCollection$$EvaluatePosition)."""
    samples = path["samples"]
    index, share = sampling(path, percent)
    if share <= 0.0:
        return samples[index]
    share = spline.clamp01(share)
    a, b = samples[index], samples[index + 1]
    return [a[k] + (b[k] - a[k]) * share for k in range(3)]


def stretch_length(path: dict, start: float, end: float) -> float:
    """The path's length from start to end, sample to sample (SampleCollection$$CalculateLength, RVA 0x5E05F0C)."""
    samples = path["samples"]
    here = position(path, start)
    first, _ = sampling(path, start)
    last, share = sampling(path, end)
    if share > 0.0 and last < len(samples) - 1:
        last += 1
    length = 0.0
    for index in range(first + 1, last):
        length += spline.distance(samples[index], here)
        here = samples[index]
    return length + spline.distance(position(path, end), here)


def travel(path: dict, start: float, length: float) -> float:
    """The share of the way `length` farther on from start, walking sample to sample (SampleCollection$$Travel)."""
    if start >= 1.0:
        return 1.0
    if length == 0.0:
        return spline.clamp01(start)
    samples = path["samples"]
    here = position(path, start)
    before = start
    index, share = sampling(path, start)
    if share > 0.0:
        index += 1
    moved = 0.0
    gap = 0.0
    while moved < length:
        gap = spline.distance(samples[index], here)
        moved += gap
        if moved >= length:
            break
        here = samples[index]
        before = sample_percent(path, index)
        if index == len(samples) - 1:
            break
        index += 1
    excess = moved - length if moved > length else 0.0
    back = excess / gap if gap > 0.0 else 0.0
    return before + (sample_percent(path, index) - before) * (1.0 - back)


def point_percent(path: dict, point: int) -> float:
    """Where control point `point` sits on the evenly spaced samples (SplineComputer$$GetPointPercent, RVA 0x5DB4924):
    its share of the control points, found among the samples' own spots on the spline."""
    wanted = spline.clamp01(point / (len(path["points"]) - 1))
    spots = path["spots"]
    for index in range(len(spots) - 2, -1, -1):
        if spots[index] < wanted:
            low, high = spots[index], spots[index + 1]
            share = 0.0 if low == high else spline.clamp01((wanted - low) / (high - low))
            low_percent = sample_percent(path, index)
            return low_percent + (sample_percent(path, index + 1) - low_percent) * share
    return 0.0


def across(path: dict, percent: float) -> tuple[list[float], list[float]]:
    """The point percent of the way along and the flat unit direction across the body there (cross(up, forward);
    zero where the path runs straight up). The forward blends the two nearest samples' headings."""
    headings = path["headings"]
    index, share = sampling(path, percent)
    heading = headings[index]
    if share > 0.0:
        share = spline.clamp01(share)
        other = headings[index + 1]
        heading = [heading[k] + (other[k] - heading[k]) * share for k in range(3)]
    size = spline.distance([0.0, 0.0, 0.0], heading)
    side = math.sqrt(heading[0] * heading[0] + heading[1] * heading[1])
    if size <= 0.0 or side / size <= NO_RIGHT:
        return position(path, percent), [0.0, 0.0]
    return position(path, percent), [heading[1] / side, -heading[0] / side]


def new_coverage(count: int) -> dict:
    return {"low": [FLOAT_MAX] * count, "high": [-FLOAT_MAX] * count}


def covered(coverage: dict, index: int) -> bool:
    return coverage["low"][index] <= coverage["high"][index]


def nearest_covered(coverage: dict, index: int, step: int) -> int:
    """The next covered slice from index (not counting it) in direction step, or -1."""
    index += step
    while 0 <= index < len(coverage["low"]):
        if covered(coverage, index):
            return index
        index += step
    return -1


def seal(coverage: dict) -> None:
    """Give every slice a share range (MultiSnakeSliceCoverage$$Seal, RVA 0x56ADEAC): the end slices copy the
    nearest covered one, a gap takes the shares between its covered neighbors, touching slices meet halfway, and the
    first slice starts at 0 and the last ends at 1."""
    low, high = coverage["low"], coverage["high"]
    count = len(low)
    first = nearest_covered(coverage, -1, 1)
    if first < 0:
        coverage["low"] = [0.0] * count
        coverage["high"] = [1.0] * count
        return
    last = nearest_covered(coverage, count, -1)
    for index in range(first):
        low[index], high[index] = low[first], high[first]
    for index in range(last + 1, count):
        low[index], high[index] = low[last], high[last]
    for index in range(count):
        if covered(coverage, index):
            continue
        before = nearest_covered(coverage, index, -1)
        after = nearest_covered(coverage, index, 1)
        start = high[before] if before >= 0 else 0.0
        end = low[after] if after >= 0 else 1.0
        low[index], high[index] = min(start, end), max(start, end)
    for index in range(count - 1):
        if high[index] < low[index + 1]:
            middle = f32((high[index] + low[index + 1]) * 0.5)
            high[index] = middle
            low[index + 1] = middle
    low[0] = 0.0
    high[count - 1] = 1.0


def build_coverage(path: dict, nest: list[list[int]]) -> dict:
    """Each slice's lowest and highest share of the path (BuildSliceCoverage): at count + 1 evenly spaced shares, the
    points across the body (2a - 1 of them, at least 3, a the nest's larger side) are looked up by cell."""
    count = len(path["slices"])
    coverage = new_coverage(count)
    steps = min(max(count * SLICE_SAMPLES, LEAST_SAMPLES), MOST_SAMPLES)
    xs = [x for x, _ in nest]
    ys = [y for _, y in nest]
    side = max(max(xs) - min(xs) + 1, max(ys) - min(ys) + 1, 1)
    points = max(2 * side - 1, 3)
    half = (side - 1) / 2
    for step in range(steps + 1):
        percent = f32(step / steps)
        middle, right = across(path, percent)
        for point in range(points):
            offset = spline.clamp01(f32(point / (points - 1))) * (half + half) - half
            x = spline.round_even(middle[0] + right[0] * offset)
            y = spline.round_even(middle[1] + right[1] * offset)
            index = path["lookup"].get(f"{x},{y}", -1)
            if index >= 0:
                coverage["low"][index] = min(coverage["low"][index], percent)
                coverage["high"][index] = max(coverage["high"][index], percent)
    seal(coverage)
    return coverage


def slice_range(path: dict, start: float, end: float) -> tuple[int, int]:
    """The first and last slice whose shares overlap start..end; with none, the slice nearest its middle."""
    low = min(start, end)
    high = max(start, end)
    lows, highs = path["low"], path["high"]
    first = last = -1
    for index in range(len(lows)):
        if highs[index] >= low and lows[index] <= high:
            if first < 0:
                first = index
            last = index
    if first >= 0:
        return first, last
    middle = f32((low + high) * 0.5)
    best = 0
    best_gap = FLOAT_MAX
    for index in range(len(lows)):
        gap = 0.0
        if lows[index] > middle:
            gap = lows[index] - middle
        elif highs[index] < middle:
            gap = middle - highs[index]
        if gap < best_gap:
            best_gap = gap
            best = index
    return best, best


def path_of(level: t.Any, data: dict) -> dict:
    """A dragon's path, worked out the first time it is asked for."""
    key = key_of(level.width, level.height, level.pw, data)
    if key not in PATHS:
        PATHS[key] = make_path(level, data)
    return PATHS[key]


def make_path(level: t.Any, data: dict) -> dict:
    """The control points, the evenly spaced samples (with their spots on the spline and headings), the slices, the
    slice table, the share under the padding and each segment's starting length."""
    squares = squares_of(data)
    padding = PADDING * L_PER_UNIT * max(level.width, level.height) / level.pw
    points = control_points(squares, padding)
    spots = spline.uniform_percents(points)
    slices = slices_of(squares)
    lookup = {}
    for index, section in enumerate(slices):
        for x, y in section:
            lookup[f"{x},{y}"] = index
    path = {
        "points": points,
        "spots": spots,
        "samples": [spline.bspline_at(points, spot) for spot in spots],
        "headings": [spline.bspline_heading(points, spot) for spot in spots],
        "slices": slices,
        "cells": spline.cross_sections({"sections": slices}, (level.width, level.height)),
        "lookup": lookup,
    }
    coverage = build_coverage(path, squares[0])
    path["low"] = coverage["low"]
    path["high"] = coverage["high"]
    pad = f32(point_percent(path, 2)) if padding > 0.0 else 0.0
    path["pad"] = pad
    path["starts"] = [initial_stretch(pad, segment) for segment in data["Segments"]]
    path["lengths"] = [f32(stretch_length(path, start, end)) for start, end in path["starts"]]
    return path


def initial_stretch(pad: float, segment: dict) -> list[float]:
    """A segment's stretch as the level gives it, moved past the padding."""
    rest = f32(1.0 - pad)
    return [f32(pad + f32(rest * segment["ClipFrom"])), f32(pad + f32(rest * segment["ClipTo"]))]


def stretches(path: dict, segments: list[dict], healths: list[int]) -> list[list[float] | None]:
    """Every segment's stretch at these healths (None for a dead one): living segments end to end from the nest,
    each minLen + health% x (L - minLen) long, the first starting at START."""
    cursor = f32(path["pad"] + START)
    first = True
    out: list[list[float] | None] = []
    for segment, health in zip(segments, healths, strict=True):
        if health <= 0:
            out.append(None)
            continue
        whole = path["lengths"][segment["slot"]]
        least = min(MIN_LENGTH, f32(whole * 0.5))
        percent = f32(f32(health) / f32(segment["count"]))
        length = f32(least + f32(percent * f32(whole - least)))
        start = START if first else cursor
        first = False
        if length > 0.0:
            cursor = min(f32(travel(path, cursor, length)), 1.0)
        out.append([start, cursor])
    return out


def slices_for(path: dict, stretch: list[float], first: bool) -> list[int]:
    """[start, end] slices a stretch covers; the first living segment reaches the nest."""
    start, end = slice_range(path, stretch[0], stretch[1])
    if first and start >= 1:
        start = 0
    return [start, end]


def cells_for(path: dict, span: list[int]) -> list[int]:
    cells: list[int] = []
    for section in path["cells"][span[0] : min(span[1], len(path["cells"]) - 1) + 1]:
        cells.extend(section)
    return cells


def setup(state: base.State) -> None:
    """Every dragon as a record, in file order, with each segment's target on its starting slices."""
    listed = state.level.features.get("multiSnakes")
    if not listed or not listed["MultiSnakes"]:
        return
    grid = state.grid
    dragons = []
    for data in listed["MultiSnakes"]:
        path = path_of(state.level, data)
        segments = []
        for slot, item in enumerate(data["Segments"]):
            # A segment of no health is a leftover the original never creates (CreateSegmentInstances)
            if item["Count"] <= 0:
                continue
            stretch = path["starts"][slot]
            first = not segments
            # The first segment reaches from the very start of the path (InitializeSegmentCaches)
            if first:
                stretch = [START, stretch[1]]
            span = slices_for(path, stretch, first)
            target = gridx.make_target(NUMBER, item["Material"], item["Count"])
            gridx.add(grid, target, cells_for(path, span))
            segments.append({"target": target.id, "slot": slot, "count": item["Count"], "span": span})
        dragons.append({"key": key_of(grid.width, grid.height, state.level.pw, data), "segments": segments})
    state.features[NUMBER] = {"dragons": dragons}


def path_for(dragon: dict) -> dict:
    """The path a dragon record lies along."""
    return PATHS[dragon["key"]]


def relay(state: base.State, dragon: dict) -> bool:
    """Lay the living segments out again at their healths and move their targets; True when any moved."""
    grid = state.grid
    path = path_for(dragon)
    targets = [grid.targets[segment["target"]] for segment in dragon["segments"]]
    laid = stretches(path, dragon["segments"], [target.health for target in targets])
    moved = False
    first = True
    for segment, target, stretch in zip(dragon["segments"], targets, laid, strict=True):
        if stretch is None:
            # A dead segment holds no slices (UpdateSegmentSlices sets both to -1)
            segment["span"] = [-1, -1]
            continue
        span = slices_for(path, stretch, first)
        first = False
        if span != segment["span"]:
            segment["span"] = span
            gridx.move(grid, target, cells_for(path, span))
            moved = True
    return moved


def on_hit(state: base.State, target: gridx.Target, damage: int, source: t.Any) -> None:
    """A shot lands on a segment: it loses health, every segment is laid out again, and at 0 it leaves the grid."""
    dragons = state.features[NUMBER]["dragons"]
    index = next(i for i, d in enumerate(dragons) if any(s["target"] == target.id for s in d["segments"]))
    dragon = dragons[index]
    target.health = max(0, target.health - damage)
    cell = -1 if source is None else source.cell
    base.emit(state, "hit", {"target": target.id, "cell": cell, "health": target.health})
    if target.health == 0:
        target.dead = True
        gridx.remove(state.grid, target)
    if relay(state, dragon):
        base.emit(state, "dragon_move", {"dragon": index})
    if not target.dead:
        return
    base.emit(state, "target_died", {"target": target.id, "owner": NUMBER})
    if all(state.grid.targets[segment["target"]].dead for segment in dragon["segments"]):
        base.emit(state, "dragon_gone", {"dragon": index})
    checks.request_win_check(state)


def remaining_hits(state: base.State, color: int) -> int:
    """The hits the living segments of this color still take."""
    mine = state.features.get(NUMBER)
    if mine is None:
        return 0
    total = 0
    for dragon in mine["dragons"]:
        for segment in dragon["segments"]:
            target = state.grid.targets[segment["target"]]
            if not target.dead and target.color == color:
                total += target.health
    return total


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    h = base.mix(h, len(mine["dragons"]))
    for dragon in mine["dragons"]:
        h = base.mix(h, len(dragon["segments"]))
        for segment in dragon["segments"]:
            target = state.grid.targets[segment["target"]]
            h = base.mix(base.mix(h, target.health), int(target.dead))
            h = base.mix(base.mix(h, segment["span"][0]), segment["span"][1])
    return h
