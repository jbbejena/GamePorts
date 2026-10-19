// Feature 30, the Slot Cage: a cage over one of the slots, opened by destroying cubes of its color anywhere.
// A cage blocks its slot while its health is above 0 (SlotCageFeature$$get_BlocksSlot, RVA 0x57AA564). Every destroyed
// single-cell cube of the cage's color gives it 1 damage, pending at once and landing CUBE_FLY_IN ticks later
// (SlotCageFeature$$OnTargetDeath, RVA 0x57A9448); the cage opens at the moment its pending damage covers all its health
// left (Unlock, RVA 0x57A9620), not when the last copy lands. The caged slots are always the first ones (SlotIndex 0 to
// k - 1 in every level), and when a cage opens the remaining cages and the pigs pack left again (places.arrangeSlots,
// the cages moving in a 0.25 s jump), so the blocked slots stay the leftmost. A slot a cage has opened is free at once,
// so pigs waiting at the exit take it. Cages are no grid targets: shots never hit them and nothing holds the stuck
// check. common/sim/features/slot_cage.py mirrors this file.
import * as base from "../base.js";
import { CUBE_FLY_IN } from "../numbers.js";
import * as places from "../places.js";

export const NUMBER = 30;

// Every cage as a record in file order, shut
export function setup(state) {
  const listed = state.level.features.SlotCages;
  if (!listed || !listed.Cages.length) {
    return;
  }
  state.features[NUMBER] = {
    cages: listed.Cages.map((data) => ({
      slot: data.SlotIndex,
      color: data.Material,
      start: data.Health,
      left: data.Health,
      pending: 0,
      open: data.Health <= 0,
    })),
  };
}

// The slots still held shut, which are the leftmost ones
export function blockedSlots(state) {
  const mine = state.features[NUMBER];
  return mine ? mine.cages.filter((cage) => !cage.open).length : 0;
}

// A single-cell cube died: every shut cage of its color gets 1 damage on its way, and opens when the damage on its way
// covers what it has left
export function onEvent(state, name, data) {
  const mine = state.features[NUMBER];
  if (!mine || name !== "cube_died" || !data.single) {
    return;
  }
  mine.cages.forEach((cage, index) => {
    if (cage.color !== data.color || cage.open) {
      return;
    }
    cage.pending += 1;
    base.schedule(state, CUBE_FLY_IN, "cage_land", index);
    base.emit(state, "cage_feed", { cage: index, cell: data.cell, color: data.color });
    if (cage.pending >= cage.left) {
      unlock(state, index);
    }
  });
}

// The cage is open: its slot is free, the other cages and the pigs pack left, and pigs waiting at the exit take the
// slots that opened up
function unlock(state, index) {
  const cage = state.features[NUMBER].cages[index];
  cage.open = true;
  base.emit(state, "cage_open", { cage: index, slot: cage.slot });
  places.arrangeSlots(state);
  places.drainEntrance(state);
}

// Timer: the cube copy lands in the cage, whose health drops by 1 (the count the page shows)
export function cageLand(state, index) {
  const cage = state.features[NUMBER].cages[index];
  cage.pending = Math.max(0, cage.pending - 1);
  cage.left = Math.max(0, cage.left - 1);
  base.emit(state, "cage_hit", { cage: index, left: cage.left });
}

base.registerTimer("cage_land", base.PHASE_FEATURES, cageLand);

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  h = base.mix(h, mine.cages.length);
  for (const cage of mine.cages) {
    h = base.mix(base.mix(h, cage.open ? 1 : 0), cage.left);
    h = base.mix(h, cage.pending);
  }
  return h;
}
