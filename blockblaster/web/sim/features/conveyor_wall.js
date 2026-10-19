// Feature 33, the Conveyor Wall: a wall across the belt that lets pigs of its color through and throws the rest off.
// Each wall stands at a lap percent (`Percent`, 0 at the start point and 1 at the clip end) and checks trays at a point
// CONVEYOR_WALL_LEAD before it (ConveyorDoorFeature$$AttachInternal, RVA 0x5600BA8, through
// ConveyorController$$GetPathPercentBefore). A tray crossing that point passes when its pig is the wall's color, or is
// in a Connected group with a member of that color (ConveyorDoorFeature$$EvaluateEject, RVA 0x55FB52C); every pig of
// the wall's color that passes takes 1 health off it, and at 0 the wall opens and is gone (NotifyItemPassed, RVA
// 0x55FDD30). Any other pig is thrown off the belt, the same as reaching the lap's end (belt.processEjects): it takes
// the first free slot, flying there in WALL_EJECT_JUMP ticks (the wall handles the placing, HandleShooterJump), or
// waits at the exit and fails "Out of space" after the grace. The belt checks no gates while the auto-finisher runs. A
// frame after a pig is about to vanish or the stuck check's repair trims ammo, every wall whose color has no pig with
// ammo left opens by itself (ConveyorDoorFeatureController$$Evaluate, RVA 0x56227B8; HasAmmoSupply, RVA 0x56228D4).
// Walls are no grid targets: they never block shots. common/sim/features/conveyor_wall.py mirrors this file.
import * as base from "../base.js";
import * as belt from "../belt.js";
import * as checks from "../checks.js";
import { CONVEYOR_WALL_LEAD, WALL_EJECT_JUMP } from "../numbers.js";
import * as places from "../places.js";

export const NUMBER = 33;

// Every wall in file order with the lap position it stands at and the one it checks at, and the order the belt checks
// them in (by check point, ConveyorController$$RefreshGateBuffer sorts its gates)
export function setup(state) {
  const listed = state.level.features.ConveyorDoors;
  if (!listed || !listed.Doors.length) {
    return;
  }
  const walls = listed.Doors.map((data) => {
    // The level file's percent as whole millionths, the same in both languages
    const pos = belt.lapAtPercent(state, Math.floor(data.Percent * 1000000 + 0.5));
    return {
      color: data.Material,
      start: data.Health,
      health: data.Health,
      pos,
      trigger: Math.max(0, pos - CONVEYOR_WALL_LEAD),
      open: data.Health <= 0,
      thrown: [],
    };
  });
  // A stable sort, like Python's sorted
  const order = walls.map((_, index) => index).sort((a, b) => walls[a].trigger - walls[b].trigger || a - b);
  state.features[NUMBER] = { walls, order, pending: false };
}

// The tray ran from old to its pos: each wall whose check point it crossed lets its pig pass or throws it off. True
// when a wall throws it off; the walls after that one don't see it (ConveyorController$$CheckGates)
export function gate(state, tray, old) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return false;
  }
  const pig = state.pigs[tray.pig];
  for (const index of mine.order) {
    const wall = mine.walls[index];
    if (!(old < wall.trigger && wall.trigger <= tray.pos)) {
      continue;
    }
    if (rejects(state, index, pig)) {
      return true;
    }
    passed(state, index, pig);
  }
  return false;
}

// The pig is the wall's color, or is in a Connected group with a member of that color still in play
function matches(state, wall, pig) {
  for (const pigId of places.batchOf(state, pig)) {
    const member = state.pigs[pigId];
    if (member.place !== "gone" && member.color === wall.color) {
      return true;
    }
  }
  return false;
}

// A standing wall throws off a pig that doesn't match it, and remembers it until it lands in a slot
// (ConveyorDoorFeature$$ShouldEject, RVA 0x55FF32C)
function rejects(state, index, pig) {
  const wall = state.features[NUMBER].walls[index];
  if (wall.open || wall.health < 1 || matches(state, wall, pig)) {
    return false;
  }
  if (!wall.thrown.includes(pig.id)) {
    wall.thrown.push(pig.id);
  }
  base.emit(state, "wall_reject", { wall: index, pig: pig.id });
  return true;
}

// A pig went through a standing wall: one of its color takes 1 health off it, and at 0 the wall opens
function passed(state, index, pig) {
  const wall = state.features[NUMBER].walls[index];
  if (wall.open || wall.health < 1 || pig.color !== wall.color) {
    return;
  }
  wall.health -= 1;
  base.emit(state, "wall_pass", { wall: index, pig: pig.id, health: wall.health });
  if (wall.health <= 0) {
    openWall(state, index, "pass");
  }
}

function openWall(state, index, cause) {
  const wall = state.features[NUMBER].walls[index];
  if (wall.open) {
    return;
  }
  wall.open = true;
  base.emit(state, "wall_open", { wall: index, cause });
}

// A pig a wall threw off flies to its slot on the wall's own jump (ConveyorDoorFeature$$CanHandleShooterPlace, RVA
// 0x5600184, and HandleShooterJump, which forgets the pig)
export function slotHop(state, pig) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return null;
  }
  for (const wall of mine.walls) {
    const at = wall.thrown.indexOf(pig.id);
    if (at >= 0) {
      wall.thrown.splice(at, 1);
      return WALL_EJECT_JUMP;
    }
  }
  return null;
}

// A pig is about to vanish, or the repair trimmed ammo: look at every wall's ammo supply next frame, once
// (ConveyorDoorFeatureController$$ScheduleEvaluation, RVA 0x5622784, waits a frame with UniTask.Yield)
export function onEvent(state, name) {
  const mine = state.features[NUMBER];
  if (!mine || (name !== "pig_vanishing" && name !== "ammo_trimmed") || mine.pending) {
    return;
  }
  mine.pending = true;
  base.schedule(state, 1, "wall_supply", null);
}

// Timer: every standing wall whose color no pig on the map has ammo for opens by itself
export function wallSupply(state) {
  const mine = state.features[NUMBER];
  mine.pending = false;
  mine.walls.forEach((wall, index) => {
    if (wall.health >= 1 && !hasSupply(state, wall.color)) {
      openWall(state, index, "supply");
    }
  });
}

// Some pig on the map of this color has ammo left (ShooterProvider$$GetShootersWithMaterial)
function hasSupply(state, color) {
  return checks.ammoPigs(state).some((pig) => pig.color === color && pig.ammo >= 1);
}

// The original's deferred evaluation resumes before every script's Update, so it lands at the start of a tick
base.registerTimer("wall_supply", base.PHASE_TAPS, wallSupply);

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  return base.mix(mixWalls(mine.walls, h), mine.pending ? 1 : 0);
}

function mixWalls(walls, h) {
  h = base.mix(h, walls.length);
  for (const wall of walls) {
    h = base.mix(base.mix(base.mix(h, wall.health), wall.open ? 1 : 0), wall.thrown.length);
    for (const pigId of wall.thrown) {
      h = base.mix(h, pigId);
    }
  }
  return h;
}
