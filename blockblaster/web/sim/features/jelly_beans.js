// Feature 24, Jelly Beans: a box of beans holding one hit target per color group, each covering the whole box.
// A group is a target of its color with the health TotalHealth, standing on every cell of the box
// (BeanGroupInstance$$get_OccupiedPoints, RVA 0x55A1304, returns the box's own point set; BeanGroupInstance$$Setup, RVA
// 0x55A0280, takes the health from the group data). It is a hit target and no obstacle. A pig hits any living group of
// its color; a group's damage handler (BeanGroupInstance$$OnHitTargetDamaged, RVA 0x55A0144, calls
// BeanBoxFeature$$OnGroupDamaged, RVA 0x5591C68) counts the dead ones, and the box is gone with the last (a count of
// living groups at 0 detaches it). A group whose health is 0 gets no instance (BeanBoxFeature$$AttachInternal, RVA
// 0x55947BC). BeanCount and BeanScale only size the drawn beans. common/sim/features/jelly_beans.py mirrors this file.
import * as base from "../base.js";
import * as checks from "../checks.js";
import * as gridx from "../grid.js";

export const NUMBER = 24;

// Every box as a record in file order, with one target per group that has health, all on the box's cells
export function setup(state) {
  const listed = state.level.features.beanBoxes;
  if (!listed || !listed.BeanBoxes.length) {
    return;
  }
  const { grid } = state;
  const boxes = [];
  for (const data of listed.BeanBoxes) {
    const cells = data.GridPoints.filter(
      (point) => point.X >= 0 && point.X < grid.width && point.Y >= 0 && point.Y < grid.height,
    ).map((point) => gridx.cellOf(grid, point.X, point.Y));
    const groups = [];
    for (const group of data.Groups) {
      if (group.TotalHealth <= 0) {
        continue;
      }
      const target = gridx.makeTarget(NUMBER, group.MaterialId, group.TotalHealth);
      gridx.add(grid, target, cells);
      groups.push(target.id);
    }
    boxes.push({ cells, groups });
  }
  state.features[NUMBER] = { boxes };
}

// A shot lands on a group: it loses health and at 0 it leaves the grid; the box is gone with its last group
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
  const { boxes } = state.features[NUMBER];
  const index = boxes.findIndex((box) => box.groups.includes(target.id));
  if (boxes[index].groups.every((group) => state.grid.targets[group].dead)) {
    base.emit(state, "bean_box_gone", { box: index });
  }
  checks.requestWinCheck(state);
}

// The hits the living groups of this color still take
export function remainingHits(state, color) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return 0;
  }
  let total = 0;
  for (const box of mine.boxes) {
    for (const group of box.groups) {
      const target = state.grid.targets[group];
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
  h = base.mix(h, mine.boxes.length);
  for (const box of mine.boxes) {
    h = base.mix(h, box.groups.length);
    for (const group of box.groups) {
      const target = state.grid.targets[group];
      h = base.mix(base.mix(h, target.health), target.dead ? 1 : 0);
    }
  }
  return h;
}
