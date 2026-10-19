"""Feature 34, the Pixel Mixer: a machine over a patch of cubes whose hose is drained by cubes of its color dying.

The body and every hose block stand on the grid as one obstacle that shots never hit. Every destroyed single-cell cube
of the mixer's color anywhere does 1 damage to it at once (PixelMixerFeature$$OnTargetDeath, RVA 0x56E6318, skips big
cubes and a mixer that is spent). The health is split over one stage per straight hose block: a corner block is a
square whose cell count is the hose's width squared (PixelMixerTailLogic$$IsCornerBlock, RVA 0x99CE288, with the width
the longer side of the first block, PixelMixerFeature$$get_TailWidth, RVA 0x56E1D00). Each stage costs HpPerBlock, and
the first `H - HpPerBlock x N` stages cost one more (PixelMixerSchedule$$FromCapacity, RVA 0x99CD1F0, and $$StageHp,
RVA 0x99CD0B4). When a stage's health runs out (PixelMixerFeature$$OnDamage, RVA 0x56E8648) the next batch of hose
blocks is released from the tip: the corners at the tip, one straight block, then the corners behind it
(ReleaseNextBatch, RVA 0x56E46A4). The cubes under released blocks can be shot at once. When no stage is left, every
block still standing and the body are released (ReleaseAllRemainingBlocks, RVA 0x56E2A68). The mixer implements
IRemovablePixelGridObstacle, so the Obstacles revive releases all of it (cpw, RVA 0x56E2A24). web/sim/features/
pixel_mixer.js mirrors this file.
"""

from __future__ import annotations

from .. import base
from .. import grid as gridx
from ..mathx import idiv

NUMBER = 34


def tail_width(blocks: list[list[int]], grid: gridx.Grid) -> int:
    """The hose's width: the longer side of the first block's bounding box, at least 1."""
    if not blocks:
        return 1
    xs = [cell % grid.width for cell in blocks[0]]
    ys = [idiv(cell, grid.width) for cell in blocks[0]]
    return max(max(xs) - min(xs) + 1, max(ys) - min(ys) + 1, 1)


def setup(state: base.State) -> None:
    """Every mixer as a record, in file order, with its body and hose standing on their cells as one obstacle."""
    listed = state.level.features.get("pixelMixers")
    if not listed or not listed["Mixers"]:
        return
    grid = state.grid
    mixers = []
    for data in listed["Mixers"]:
        body = cells_of(grid, data["GridPoints"])
        blocks = [cells_of(grid, block["GridPoints"]) for block in data["TailGridPoints"]]
        width = tail_width(blocks, grid)
        corners = [width > 1 and len(block) == width * width for block in blocks]
        stages = max(1, sum(1 for corner in corners if not corner))
        per_block = max(1, idiv(data["Health"], stages))
        bonus = max(0, data["Health"] - per_block * stages)
        target = gridx.make_target(NUMBER, -1, 0, obstacle=True, hittable=False)
        gridx.add(grid, target, body + [cell for block in blocks for cell in block])
        mixer = {
            "target": target.id,
            "color": data["Material"],
            "body": body,
            "blocks": blocks,
            "corners": corners,
            "stages": stages,
            "per_block": per_block,
            "bonus": bonus,
            "released": 0,
            "left": 0,
            "spent": False,
        }
        mixer["left"] = stage_hp(mixer, stages)
        target.health = mixer["left"]
        mixers.append(mixer)
    state.features[NUMBER] = {"mixers": mixers}


def cells_of(grid: gridx.Grid, points: list[dict]) -> list[int]:
    return [
        gridx.cell_of(grid, point["X"], point["Y"])
        for point in points
        if 0 <= point["X"] < grid.width and 0 <= point["Y"] < grid.height
    ]


def stage_hp(mixer: dict, stages_left: int) -> int:
    """What the stage with this many stages left (itself included) costs: the first `bonus` stages cost one more."""
    return mixer["per_block"] + (1 if mixer["stages"] - mixer["bonus"] < stages_left else 0)


def released_stages(mixer: dict) -> int:
    """Straight blocks among the ones released so far."""
    count = 0
    for step in range(mixer["released"]):
        if not corner_from_tip(mixer, step):
            count += 1
    return count


def corner_from_tip(mixer: dict, index: int) -> bool:
    """Whether the block this many places from the tip is a corner (false past the body end)."""
    place = len(mixer["blocks"]) - 1 - index
    return place >= 0 and mixer["corners"][place]


def release_one(state: base.State, index: int) -> None:
    """The block next from the tip leaves: its cells are free at once."""
    mixer = state.features[NUMBER]["mixers"][index]
    place = len(mixer["blocks"]) - 1 - mixer["released"]
    mixer["released"] += 1
    free_cells(state, mixer, mixer["blocks"][place])
    base.emit(state, "mixer_release", {"mixer": index, "block": place, "corner": mixer["corners"][place]})


def release_corners(state: base.State, index: int) -> None:
    mixer = state.features[NUMBER]["mixers"][index]
    while mixer["released"] < len(mixer["blocks"]) and corner_from_tip(mixer, mixer["released"]):
        release_one(state, index)


def release_batch(state: base.State, index: int) -> None:
    """Corners at the tip, one straight block, then the corners behind it."""
    mixer = state.features[NUMBER]["mixers"][index]
    release_corners(state, index)
    if mixer["released"] < len(mixer["blocks"]):
        release_one(state, index)
    release_corners(state, index)


def free_cells(state: base.State, mixer: dict, cells: list[int]) -> None:
    """Take these cells off the mixer's obstacle."""
    target = state.grid.targets[mixer["target"]]
    gone = set(cells)
    gridx.move(state.grid, target, [cell for cell in target.cells if cell not in gone])


def on_event(state: base.State, name: str, data: dict) -> None:
    """A single-cell cube died: every mixer of its color that isn't spent takes 1 damage at once."""
    mine = state.features.get(NUMBER)
    if mine is None or name != "cube_died" or not data["single"]:
        return
    for index, mixer in enumerate(mine["mixers"]):
        if mixer["color"] == data["color"] and not mixer["spent"]:
            damage(state, index, data["cell"])


def damage(state: base.State, index: int, cell: int) -> None:
    """One point off the standing stage; at 0 the next batch of hose leaves and the next stage starts, or the whole
    mixer goes with the last."""
    mixer = state.features[NUMBER]["mixers"][index]
    target = state.grid.targets[mixer["target"]]
    mixer["left"] -= 1
    target.health = mixer["left"]
    base.emit(state, "mixer_hit", {"mixer": index, "cell": cell, "left": mixer["left"]})
    if mixer["left"] > 0:
        return
    release_batch(state, index)
    stages_left = mixer["stages"] - released_stages(mixer)
    if stages_left >= 1:
        mixer["left"] = stage_hp(mixer, stages_left)
        target.health = mixer["left"]
        base.emit(state, "mixer_stage", {"mixer": index, "left": mixer["left"], "stages_left": stages_left})
    else:
        finish(state, index, "cubes")
    base.emit(state, "hit", {"target": target.id, "cell": -1, "health": target.health})


def finish(state: base.State, index: int, why: str) -> None:
    """Every block still standing and the body are released; the mixer is spent."""
    mixer = state.features[NUMBER]["mixers"][index]
    target = state.grid.targets[mixer["target"]]
    mixer["spent"] = True
    while mixer["released"] < len(mixer["blocks"]):
        release_one(state, index)
    mixer["left"] = 0
    target.health = 0
    target.dead = True
    gridx.remove(state.grid, target)
    base.emit(state, "mixer_done", {"mixer": index, "target": target.id, "why": why})


def revive(state: base.State, name: str) -> int:
    """The Obstacles revive releases every mixer that stands, in file order. Returns the ticks the revive waits (none)."""
    mine = state.features.get(NUMBER)
    if name != "obstacles" or mine is None:
        return 0
    for index, mixer in enumerate(mine["mixers"]):
        if not mixer["spent"]:
            finish(state, index, "revive")
            base.emit(state, "hit", {"target": mixer["target"], "cell": -1, "health": 0})
    return 0


def checksum(state: base.State, h: int) -> int:
    mine = state.features.get(NUMBER)
    if mine is None:
        return h
    h = base.mix(h, len(mine["mixers"]))
    for mixer in mine["mixers"]:
        h = base.mix(base.mix(h, mixer["released"]), mixer["left"])
        h = base.mix(h, int(mixer["spent"]))
    return h
