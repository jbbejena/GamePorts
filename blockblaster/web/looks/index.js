// The feature looks, called in feature-number order. A look module exports `NUMBER` and `create(scene, picture)`
// (`picture` is picture.js's handle, for looks that move cubes), which loads what it draws with and returns an object
// with any of: `build(state)` (a new level), `clear()` (the level is left), `onEvents(events, state)`,
// `frame(alpha, state)` (every drawn frame), `begin(state, spots)` and `end()` (around the pigs' placing each frame;
// `spots` holds the queue, slot and rescue places the pigs stand on) and `shape(id, pig, pose)` (dress one pig, between
// the two). Looks change only what is drawn.
import * as astroPig from "./astro_pig.js";
import * as biscuit from "./biscuit.js";
import * as bullTotem from "./bull_totem.js";
import * as connected from "./connected.js";
import * as conveyorWall from "./conveyor_wall.js";
import * as crossbow from "./crossbow.js";
import * as curtain from "./curtain.js";
import * as dragon from "./dragon.js";
import * as dungeon from "./dungeon.js";
import * as eggBox from "./egg_box.js";
import * as frozenPig from "./frozen_pig.js";
import * as gate from "./gate.js";
import * as hardPixels from "./hard_pixels.js";
import * as hungryDoor from "./hungry_door.js";
import * as iceBlock from "./ice_block.js";
import * as jellyBeans from "./jelly_beans.js";
import * as locksKeys from "./locks_keys.js";
import * as musicToy from "./music_toy.js";
import * as pigCell from "./pig_cell.js";
import * as pigPipe from "./pig_pipe.js";
import * as pigroshka from "./pigroshka.js";
import * as pixelMixer from "./pixel_mixer.js";
import * as pixelPipe from "./pixel_pipe.js";
import * as pumpkin from "./pumpkin.js";
import * as rocket from "./rocket.js";
import * as scissorsGate from "./scissors_gate.js";
import * as shackles from "./shackles.js";
import * as slotCage from "./slot_cage.js";
import * as snake from "./snake.js";
import * as surprisePig from "./surprise_pig.js";
import * as surprisePixel from "./surprise_pixel.js";
import * as ufo from "./ufo.js";
import * as wall from "./wall.js";
import * as woodHammer from "./wood_hammer.js";

const MODULES = [
  surprisePig,
  connected,
  hardPixels,
  locksKeys,
  gate,
  pixelPipe,
  surprisePixel,
  snake,
  wall,
  eggBox,
  pigPipe,
  iceBlock,
  woodHammer,
  frozenPig,
  hungryDoor,
  biscuit,
  rocket,
  ufo,
  pumpkin,
  shackles,
  curtain,
  pigCell,
  dragon,
  jellyBeans,
  bullTotem,
  musicToy,
  crossbow,
  scissorsGate,
  dungeon,
  slotCage,
  pigroshka,
  astroPig,
  conveyorWall,
  pixelMixer,
];

class Looks {
  constructor(looks) {
    this.looks = looks;
  }

  call(name, ...args) {
    for (const look of this.looks) {
      if (look[name]) {
        look[name](...args);
      }
    }
  }

  build(state) {
    this.call("build", state);
  }

  clear() {
    this.call("clear");
  }

  onEvents(events, state) {
    this.call("onEvents", events, state);
  }

  frame(alpha, state) {
    this.call("frame", alpha, state);
  }

  begin(state, spots) {
    this.call("begin", state, spots);
  }

  shape(id, pig, pose) {
    this.call("shape", id, pig, pose);
  }

  // The first answer that is not null from a look that has the method (the effects ask where a cat is going)
  ask(name, ...args) {
    for (const look of this.looks) {
      const answer = look[name] ? look[name](...args) : null;
      if (answer) {
        return answer;
      }
    }
    return null;
  }

  end() {
    this.call("end");
  }
}

// Make every look for a scene, loading them together
export async function createLooks(scene, picture) {
  return new Looks(await Promise.all(MODULES.map((module) => module.create(scene, picture))));
}
