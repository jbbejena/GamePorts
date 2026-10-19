// Feature 22, the Pig Cell: a real pig shut in a cage over a patch of the picture, freed when the picture around it is
// cleared to the outside.
// The caged pig is a pig of the level from the start (its own color and ammo, ids from 10000), held where no rule
// reaches it, so it can't be tapped (ShooterCageFeature$$CreateCagedShooter, RVA 0x579490C). The cage is neither an
// obstacle nor a target: it never stops a shot. It is freed when any of its cells is reached by the edge flood, which
// only reaches cells that are not solid, so a solid cage cell fails the check (ShooterCageFeature$$IsUnblocked, RVA
// 0x5794A50; PixelGridController$$CanAnyPointReachOutside, RVA 0x54C1160). The check runs at the end of a tick after any
// hit, tap, vanish, booster or revive, in the release phase and not while a revive pauses the map, like the keys
// (ReleasablePixelGridAttachablesController, RVA 0x578EAD8; ShooterCageFeatureController$$OnReleasablesUnblocked, RVA
// 0x57990DC). A freed pig jumps for RESCUE_JUMP ticks and then joins the back of the rescue queue
// (ShooterCageFeature.<RescueAsync>d__48$$MoveNext, RVA 0x5797494). While it jumps it still counts as a live pig, and it
// holds the stuck check so the level isn't called stuck with a rescue on its way. common/sim/features/pig_cell.py
// mirrors this file.
import * as base from "../base.js";
import * as gridx from "../grid.js";
import { RESCUE_JUMP } from "../numbers.js";

export const NUMBER = 22;

// Events after which the release check runs at the end of the tick: a target damaged, a pig tapped, a pig about to
// vanish, and the outside triggers (a booster or a revive finished, the walls removed)
const CHECK_AFTER = ["hit", "pig_tapped", "pig_vanishing", "booster_done", "revive_done", "walls_removed"];

// Every cage as a record, in file order, and its pig held. A cage's cells are the ones inside the picture
export function setup(state) {
  const listed = state.level.features.shooterCages;
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
    cages.push({ pig: shooter.id, cells, freed: false });
  }
  state.features[NUMBER] = { cages, flights: [], pending: false };
}

export function onEvent(state, name) {
  if (NUMBER in state.features && CHECK_AFTER.includes(name)) {
    state.features[NUMBER].pending = true;
  }
}

// End of tick: when something asked for it and the map isn't paused by a revive, every cage with a cell the edge flood
// reaches opens, in file order
export function release(state) {
  const mine = state.features[NUMBER];
  if (!mine || !mine.pending) {
    return;
  }
  mine.pending = false;
  if (state.reviving) {
    return;
  }
  const reach = gridx.reachOutside(state.grid);
  mine.cages.forEach((cage, index) => {
    if (!cage.freed && cage.cells.some((cell) => reach[cell])) {
      free(state, index, cage);
    }
  });
}

// The cage opens and its pig starts its jump to the rescue queue
function free(state, index, cage) {
  const mine = state.features[NUMBER];
  cage.freed = true;
  const land = state.tick + RESCUE_JUMP;
  mine.flights.push([cage.pig, land]);
  base.schedule(state, RESCUE_JUMP, "cage_land", cage.pig);
  base.emit(state, "cage_free", { cage: index, pig: cage.pig, land });
}

// Timer: the pig has landed and joins the back of the rescue queue
export function cageLand(state, pigId) {
  const mine = state.features[NUMBER];
  mine.flights = mine.flights.filter((flight) => flight[0] !== pigId);
  state.pigs[pigId].place = "rescue";
  state.rescue.push(pigId);
  base.emit(state, "to_rescue", { pig: pigId, index: state.rescue.length - 1, from: "cage" });
}

base.registerTimer("cage_land", base.PHASE_FEATURES, cageLand);

// A pig jumping out of its cage holds the stuck check
export function busy(state) {
  const mine = state.features[NUMBER];
  return Boolean(mine) && mine.flights.length > 0;
}

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  for (const cage of mine.cages) {
    h = base.mix(h, cage.freed ? 1 : 0);
  }
  h = base.mix(h, mine.flights.length);
  for (const [pigId, land] of mine.flights) {
    h = base.mix(base.mix(h, pigId), land);
  }
  return base.mix(h, mine.pending ? 1 : 0);
}
