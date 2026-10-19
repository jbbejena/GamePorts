// Feature 32, the Astro Pig and its Spaceship: an obstacle over a patch of cubes that leaves when an astro pig of its
// color runs dry.
// Astro pigs are ordinary pigs of the queues, listed by id in AstronautShooters, and carry the tag "astro". They shoot
// and drop into slots like any pig. When one runs dry the spaceship of its color with an empty seat takes it instead of
// the vanish: the first ship in file order whose seat is free (SpaceshipFeature$$CanHandleShooterDisappear, RVA
// 0x57CECE8; the seat check's second type is read as "the pig carries the astro feature and is no disabled entry", like
// the U.F.O. check, open O14). The pig still leaves the game as a vanished pig, so frozen pigs and the auto-finisher
// count it. The ship leaves the grid once the pig's place jump has landed, ASTRO_PLACE_JUMP ticks later (SpaceshipModel
// placeDuration; <PlayLaunchAnimation>d__48$$MoveNext, RVA 0x57CB870), and its cells are free then. While a ship waits
// to launch, the stuck check waits (FailCheckDelayCondition: a spaceship launching). A second astro pig of that color
// finds the seat taken and vanishes normally. The ship is an obstacle and is never shot. It is an
// IRemovablePixelGridObstacle, so the Spaceship revive and the Obstacles revive take every standing ship off the grid
// at once. common/sim/features/astro_pig.py mirrors this file.
import * as base from "../base.js";
import * as gridx from "../grid.js";
import { ASTRO_PLACE_JUMP } from "../numbers.js";

export const NUMBER = 32;

// Pigs a spaceship refuses: anything that is not an astro pig, and a disabled entry
const TAG = "astro";
const REFUSED = "disabled";

// Tag the astro pigs, and put every spaceship on its cells as an obstacle, in file order
export function setup(state) {
  const listed = state.level.features.AstronautShooters;
  for (const pigId of listed ? listed.Shooters : []) {
    state.pigs[pigId].tags.push(TAG);
  }
  const ships = state.level.features.spaceships;
  if (!ships || !ships.Spaceships.length) {
    return;
  }
  const { grid } = state;
  const records = [];
  for (const data of ships.Spaceships) {
    const cells = data.GridPoints.filter(
      (point) => point.X >= 0 && point.X < grid.width && point.Y >= 0 && point.Y < grid.height,
    ).map((point) => gridx.cellOf(grid, point.X, point.Y));
    const body = gridx.makeTarget(NUMBER, -1, 1, true, false);
    gridx.add(grid, body, cells);
    records.push({ target: body.id, cells, color: data.Material, pig: -1 });
  }
  state.features[NUMBER] = { ships: records };
}

function standing(state, ship) {
  return !state.grid.targets[ship.target].dead;
}

// An astro pig is about to vanish: it takes the seat of the first standing ship of its color that has one, and the ship
// launches once the pig has landed. Never takes the vanish over
export function takeVanish(state, pig) {
  const mine = state.features[NUMBER];
  if (!mine || !pig.tags.includes(TAG) || pig.tags.includes(REFUSED)) {
    return false;
  }
  for (let index = 0; index < mine.ships.length; index++) {
    const ship = mine.ships[index];
    if (standing(state, ship) && ship.pig < 0 && ship.color === pig.color) {
      ship.pig = pig.id;
      base.schedule(state, ASTRO_PLACE_JUMP, "ship_launch", index);
      base.emit(state, "ship_seat", {
        ship: index,
        pig: pig.id,
        color: pig.color,
        land: state.tick + ASTRO_PLACE_JUMP,
      });
      return false;
    }
  }
  return false;
}

// Timer: the pig has landed and the ship takes off, unless a revive already took it
export function shipLaunch(state, index) {
  launch(state, index, "pig");
}

// The ship is gone from the picture and its cells are free at once. The hit event makes keys and Surprise Pixels look
// at the picture again. Its flight is drawn by the page
function launch(state, index, why) {
  const ship = state.features[NUMBER].ships[index];
  const body = state.grid.targets[ship.target];
  if (body.dead) {
    return;
  }
  body.health = 0;
  body.dead = true;
  gridx.remove(state.grid, body);
  base.emit(state, "ship_launch", { ship: index, target: body.id, why });
  base.emit(state, "hit", { target: body.id, cell: -1, health: 0 });
}

base.registerTimer("ship_launch", base.PHASE_FEATURES, shipLaunch);

// A ship with its astro pig on the way holds the stuck check until it has launched
export function busy(state) {
  const mine = state.features[NUMBER];
  return Boolean(mine) && mine.ships.some((ship) => standing(state, ship) && ship.pig >= 0);
}

// The stuck fail's name counts the spaceships still standing
export function failCounts(state) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return {};
  }
  return { spaceship: mine.ships.filter((ship) => standing(state, ship)).length };
}

// The Spaceship and Obstacles revives launch every standing ship, in file order. Returns the ticks the revive waits
// (none)
export function revive(state, name) {
  const mine = state.features[NUMBER];
  if ((name !== "spaceship" && name !== "obstacles") || !mine) {
    return 0;
  }
  mine.ships.forEach((ship, index) => {
    if (standing(state, ship)) {
      launch(state, index, "revive");
    }
  });
  return 0;
}

export function checksum(state, h) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return h;
  }
  h = base.mix(h, mine.ships.length);
  for (const ship of mine.ships) {
    h = base.mix(base.mix(h, standing(state, ship) ? 0 : 1), ship.pig);
  }
  return h;
}
