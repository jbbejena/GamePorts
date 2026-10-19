// Feature 29, the Dungeon: a cage over empty cells with a cat inside, shot down by the color on the cage; the cat joins
// the rescue queue once the cage is gone.
// A dungeon is a hit target of the cage's Material (not the cat's color) with the cage's Health, standing on its cells,
// and no obstacle. The cat inside is a cat of the level from the start (its own color and ammo, ids from 20000), held
// where no rule reaches it. When the cage's health reaches 0 it plays its death, waits DUNGEON_WAIT ticks, and then the
// cat, if it has ammo, jumps for RESCUE_JUMP ticks and joins the back of the rescue queue (ColoredShooterCageFeature
// .<HandleDeathAsync>d__73$$MoveNext, RVA 0x55C7ED8; ReleaseCagedShooter, RVA 0x55C3584). While it waits and jumps the
// cat still counts as a live pig, and it holds the stuck check so the level isn't called stuck with a rescue on its
// way. common/sim/features/dungeon.py mirrors this file.
import * as base from "../base.js";
import * as checks from "../checks.js";
import * as gridx from "../grid.js";
import { DUNGEON_WAIT, RESCUE_JUMP } from "../numbers.js";

export const NUMBER = 29;

// Every dungeon as a record in file order, with its cage target and its cat held
export function setup(state) {
  const listed = state.level.features.coloredShooterCages;
  if (!listed || !listed.Cages.length) {
    return;
  }
  const { grid } = state;
  const cages = [];
  for (const data of listed.Cages) {
    const shooter = data.CagedShooter;
    state.pigs[shooter.id] = base.makePig(shooter.id, shooter.material, shooter.ammo, "held");
    const cells = data.GridPoints.filter(
      (point) => point.X >= 0 && point.X < grid.width && point.Y >= 0 && point.Y < grid.height,
    ).map((point) => gridx.cellOf(grid, point.X, point.Y));
    const target = gridx.makeTarget(NUMBER, data.Material, data.Health);
    gridx.add(grid, target, cells);
    cages.push({ target: target.id, pig: shooter.id, start: data.Health, freed: false });
  }
  state.features[NUMBER] = { cages, waits: [], flights: [] };
}

// A shot lands on a cage: it loses health and at 0 it leaves the grid; its cat is freed after the wait
export function onHit(state, target, damage, source) {
  target.health = Math.max(0, target.health - damage);
  const cell = source === null || source === undefined ? -1 : source.cell;
  base.emit(state, "hit", { target: target.id, cell, health: target.health });
  if (target.health > 0) {
    return;
  }
  target.dead = true;
  gridx.remove(state.grid, target);
  const mine = state.features[NUMBER];
  const index = mine.cages.findIndex((cage) => cage.target === target.id);
  const pigId = mine.cages[index].pig;
  mine.waits.push(pigId);
  base.schedule(state, DUNGEON_WAIT, "dungeon_open", index);
  base.emit(state, "target_died", { target: target.id, owner: NUMBER });
  base.emit(state, "dungeon_dead", { cage: index, pig: pigId });
  checks.requestWinCheck(state);
}

// Timer: the wait is over. A cat with ammo starts its jump to the rescue queue; one without is simply gone
export function dungeonOpen(state, index) {
  const mine = state.features[NUMBER];
  const cage = mine.cages[index];
  const pig = state.pigs[cage.pig];
  mine.waits.splice(mine.waits.indexOf(cage.pig), 1);
  cage.freed = true;
  if (pig.ammo <= 0) {
    pig.place = "gone";
    checks.requestWinCheck(state);
    return;
  }
  const land = state.tick + RESCUE_JUMP;
  mine.flights.push([pig.id, land]);
  base.schedule(state, RESCUE_JUMP, "dungeon_land", pig.id);
  base.emit(state, "dungeon_free", { cage: index, pig: pig.id, land });
}

// Timer: the cat has landed and joins the back of the rescue queue
export function dungeonLand(state, pigId) {
  const mine = state.features[NUMBER];
  mine.flights = mine.flights.filter((flight) => flight[0] !== pigId);
  state.pigs[pigId].place = "rescue";
  state.rescue.push(pigId);
  base.emit(state, "to_rescue", { pig: pigId, index: state.rescue.length - 1, from: "cage" });
}

base.registerTimer("dungeon_open", base.PHASE_FEATURES, dungeonOpen);
base.registerTimer("dungeon_land", base.PHASE_FEATURES, dungeonLand);

// A cat waiting in a broken cage or jumping out of it holds the stuck check
export function busy(state) {
  const mine = state.features[NUMBER];
  return Boolean(mine) && (mine.waits.length > 0 || mine.flights.length > 0);
}

// The hits the standing cages of this color still take
export function remainingHits(state, color) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return 0;
  }
  let total = 0;
  for (const cage of mine.cages) {
    const target = state.grid.targets[cage.target];
    if (!target.dead && target.color === color) {
      total += target.health;
    }
  }
  return total;
}

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  for (const cage of mine.cages) {
    const target = state.grid.targets[cage.target];
    h = base.mix(base.mix(h, target.health), target.dead ? 1 : 0);
    h = base.mix(h, cage.freed ? 1 : 0);
  }
  h = base.mix(h, mine.waits.length);
  for (const pigId of mine.waits) {
    h = base.mix(h, pigId);
  }
  h = base.mix(h, mine.flights.length);
  for (const [pigId, land] of mine.flights) {
    h = base.mix(base.mix(h, pigId), land);
  }
  return h;
}
