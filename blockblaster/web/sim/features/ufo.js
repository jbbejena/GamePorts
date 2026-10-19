// Feature 18, U.F.O.s: an obstacle over a patch of cubes with four colored seats, filled by pigs that run dry.
// A pig that runs dry anywhere, unless it is an astro pig or a disabled entry (a hammer, a lock, a pipe entry), takes the
// first empty seat of its color instead of vanishing: the first U.F.O. in file order that has one, and its first such seat
// (IShooterDisappearHandlerAttachable$$FindHandler, RVA 0x578CDCC, takes the first attachable whose
// UfoFeature$$CanHandleShooterDisappear, RVA 0x580B0D0, says yes; UfoModel$$TryPlaceShooter, RVA 0x5810E80, finds the
// first empty seat of the shooter's color). The seat is taken at once, and the pig still leaves the game as a vanished
// pig (MapController$$MakeShooterDisappear, RVA 0x58CF424, removes it from its place and raises the vanish before
// looking for a handler), so frozen pigs and the auto-finisher count it. When every seat is full the U.F.O. leaves the
// grid at once and its cells are free (UfoFeature$$TryPlaceShooter, RVA 0x580908C, starts LaunchUfo, RVA 0x5809C40, whose
// <LaunchUfo>d__36$$MoveNext, RVA 0x580E714, detaches it before its flight animation); nothing waits for the flight.
// The U.F.O. is an IRemovablePixelGridObstacle whose RemoveObstacle (RVA 0x580B9A0) is the same launch, so both the
// "UFO Block!" revive (MapRescueController.<RemoveUfos>d__26) and the Obstacles revive launch every standing one. Shots
// never hit a U.F.O. common/sim/features/ufo.py mirrors this file.
import * as base from "../base.js";
import * as gridx from "../grid.js";

export const NUMBER = 18;

// Pigs a U.F.O. refuses (a disabled entry; the Astro Pig's tag is added by its own feature)
const REFUSED = ["disabled", "astro"];

// Every U.F.O. as a record, in file order, with its body standing on its cells as an obstacle
export function setup(state) {
  const listed = state.level.features.ufos;
  if (!listed || !listed.Ufos.length) {
    return;
  }
  const { grid } = state;
  const ufos = [];
  for (const data of listed.Ufos) {
    const cells = data.GridPoints.filter(
      (point) => point.X >= 0 && point.X < grid.width && point.Y >= 0 && point.Y < grid.height,
    ).map((point) => gridx.cellOf(grid, point.X, point.Y));
    const body = gridx.makeTarget(NUMBER, -1, 1, true, false);
    gridx.add(grid, body, cells);
    const seats = data.Seats.map((seat) => ({ color: seat.Material, pig: -1 }));
    ufos.push({ target: body.id, cells, seats });
  }
  state.features[NUMBER] = { ufos };
}

function standing(state, ufo) {
  return !state.grid.targets[ufo.target].dead;
}

// A pig is about to vanish: it fills the first empty seat of its color, and the U.F.O. leaves when that was its last
// empty seat. Never takes the vanish over
export function takeVanish(state, pig) {
  const mine = state.features[NUMBER];
  if (!mine || REFUSED.some((tag) => pig.tags.includes(tag))) {
    return false;
  }
  for (let index = 0; index < mine.ufos.length; index++) {
    const ufo = mine.ufos[index];
    if (!standing(state, ufo)) {
      continue;
    }
    const seatIndex = ufo.seats.findIndex((seat) => seat.pig < 0 && seat.color === pig.color);
    if (seatIndex < 0) {
      continue;
    }
    ufo.seats[seatIndex].pig = pig.id;
    base.emit(state, "ufo_seat", { ufo: index, seat: seatIndex, pig: pig.id, color: pig.color });
    if (ufo.seats.every((seat) => seat.pig >= 0)) {
      launch(state, index, "full");
    }
    return false;
  }
  return false;
}

// The U.F.O. is gone from the picture and its cells are free at once. The hit event makes keys and Surprise Pixels look
// at the picture again. Its flight is drawn by the page
function launch(state, index, why) {
  const body = state.grid.targets[state.features[NUMBER].ufos[index].target];
  body.health = 0;
  body.dead = true;
  gridx.remove(state.grid, body);
  base.emit(state, "ufo_launch", { ufo: index, target: body.id, why });
  base.emit(state, "hit", { target: body.id, cell: -1, health: 0 });
}

// The stuck fail's name counts the U.F.O.s still standing
export function failCounts(state) {
  const mine = state.features[NUMBER];
  if (!mine) {
    return {};
  }
  return { ufo: mine.ufos.filter((ufo) => standing(state, ufo)).length };
}

// The UFO Block! and Obstacles revives launch every standing U.F.O., in file order. Returns the ticks the revive waits
// (none)
export function revive(state, name) {
  const mine = state.features[NUMBER];
  if ((name !== "ufo" && name !== "obstacles") || !mine) {
    return 0;
  }
  mine.ufos.forEach((ufo, index) => {
    if (standing(state, ufo)) {
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
  h = base.mix(h, mine.ufos.length);
  for (const ufo of mine.ufos) {
    h = base.mix(h, state.grid.targets[ufo.target].dead ? 1 : 0);
    for (const seat of ufo.seats) {
      h = base.mix(base.mix(h, seat.color), seat.pig);
    }
  }
  return h;
}
