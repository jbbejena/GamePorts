// Feature 18, U.F.O.s: a violet saucer with a glass dome stands over its cubes, a colored cup inside for each of its four
// seats. A cat that runs dry jumps from where it stood to the first free cup of its color (0.6 s, UfoSeatModel
// placeDuration) and sits there; the dome lifts open while it flies and closes again. When the last cup is filled the
// saucer blinks its lights, rises, waits and flies off up the screen with the cats on board, shrinking away
// (UfoAnimations: liftoffHeight, liftoffDuration, launchPathDelay, launchPathSpeed, scaleDownStartProgress), while its
// cells are already free for the rules. The saucer is the original's `models/features/ufo_model_8x8.glb` (hull, rim,
// floor, dome base, dome, lights) stretched over the cells it covers and the cup is `ufo_seat_model.glb`; the prefabs
// hold no materials, so the paint is the look's choice, taken from the feature's picture. Sounds are the prefab's
// AudioFx clips. Everything comes from the simulation's U.F.O. records (sim/features/ufo.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { SEAT_TICKS } from "../fx.js";
import { COLORS } from "../picture.js";
import { play as sound } from "../sound.js";
import { NUMBER } from "../sim/features/ufo.js";
import { L_PER_UNIT } from "../sim/numbers.js";

export { NUMBER };

const MODEL = "models/features/ufo_model_8x8.glb";
const SEAT_MODEL = "models/features/ufo_seat_model.glb";
const SHADOW = "art/effects/Shadow_2x2Cube.png";
// The most U.F.O.s one level holds is 6, each with 4 seats
const UFOS = 6;
const SEATS = 4;
// The saucer prefab is this wide (model units); everything below is in model units until it is scaled to the footprint
const MODEL_WIDE = 3.99;
// Where the cups stand: the dome's middle, the floor's height, and the ring they sit on (UfoSeatPositioner for 4 seats:
// diameter 1.8, scale 1.2), the first one at this angle
const DOME_Z = -0.29;
const FLOOR_Y = 0.77;
const RING = 0.9;
const SEAT_SCALE = 1.2;
const FIRST_ANGLE = Math.PI / 4;
// A cat in a cup is as big as the cup is wide, and its feet rest this far up the cup (model units)
const CAT_FIT = 1.0;
const CAT_RISE = 0.12;
// The dome: it lifts this far (model units) over this many ticks while a cat flies in and settles back over as many;
// how clear it is shut and open
const OPEN_TICKS = 9;
const OPEN_LIFT = 0.5;
const GLASS_SHUT = 0.32;
const GLASS_OPEN = 0.08;
// After the last cat lands the dome closes for this many ticks before the saucer launches
const CLOSE_TICKS = 12;
// The launch (UfoAnimations): the shadow fades 0.3 s, the saucer rises 2.0 in 0.5 s, waits 0.2 s, then flies up the screen
// for this long and this far (world units), spinning, and shrinks over the last tenth
const SHADOW_FADE = 18;
const LIFT_TICKS = 30;
const LIFT_HIGH = 1.4;
const LAUNCH_DELAY = 12;
const FLY_TICKS = 66;
const FLY_FAR = 9;
const FLY_RISE = 3;
const FLY_SPIN = 4.2;
const SHRINK_FROM = 0.9;
const LIGHT_BLINK = 6;
// Painting (the look's choice)
const HULL = 0x9d8cff;
const RIM = 0xc9c0ff;
const FLOOR = 0xf1eeff;
const DOME_BASE = 0xd9d3ff;
const DOME = 0xcfeaff;
const LIGHT_ON = 0xffe27a;
const LIGHT_OFF = 0x7a6fc4;
// The shadow: against the footprint, how far its middle sits toward the lower right, how dark it is
const SHADOW_WIDE = 1.2;
const SHADOW_SHIFT = 0.1;
const SHADOW_OPACITY = 0.3;
const SHADOW_LIFT = 0.004;

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

function easeOutCubic(u) {
  return 1 - (1 - u) ** 3;
}

function easeInCubic(u) {
  return u ** 3;
}

// A prefab's meshes with their node transforms baked in, in the file's order
function piecesOf(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const geometries = [];
  gltf.scene.traverse((node) => {
    if (node.isMesh) {
      geometries.push(node.geometry.clone().applyMatrix4(node.matrixWorld));
    }
  });
  return geometries;
}

// The ring spot of cup `index` in model units: [x, z]
function cupSpot(index) {
  const angle = FIRST_ANGLE + (index * 2 * Math.PI) / SEATS;
  return [Math.cos(angle) * RING, DOME_Z + Math.sin(angle) * RING];
}

class UfoLook {
  constructor(pieces, seatPieces, shadow, scene) {
    this.pieces = pieces;
    this.seatCup = seatPieces[0];
    this.shadowMap = shadow;
    this.slots = [];
    this.ufos = [];
    this.now = 0;
    // Pig id to [ufo, seat] for every filled cup this tick, and when each cat lands in its cup (ufo * 4 + seat)
    this.seated = new Map();
    this.lands = new Map();
    this.hullMaterials = [HULL, RIM, FLOOR, DOME_BASE].map(
      (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05 }),
    );
    for (let i = 0; i < UFOS; i++) {
      this.slots.push(this.makeSlot(scene));
    }
  }

  makeSlot(scene) {
    const group = new THREE.Group();
    const [hull, rim, floor, base, dome, lights] = this.pieces;
    for (const [geometry, material] of [
      [hull, this.hullMaterials[0]],
      [rim, this.hullMaterials[1]],
      [floor, this.hullMaterials[2]],
      [base, this.hullMaterials[3]],
    ]) {
      group.add(new THREE.Mesh(geometry, material));
    }
    const lightMaterial = new THREE.MeshStandardMaterial({ color: LIGHT_OFF, roughness: 0.4, emissive: 0x000000 });
    group.add(new THREE.Mesh(lights, lightMaterial));
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: DOME,
      roughness: 0.1,
      transparent: true,
      opacity: GLASS_SHUT,
      depthWrite: false,
    });
    const glass = new THREE.Mesh(dome, glassMaterial);
    glass.renderOrder = 3;
    group.add(glass);
    const cups = [];
    for (let i = 0; i < SEATS; i++) {
      const material = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 });
      const cup = new THREE.Mesh(this.seatCup, material);
      const [x, z] = cupSpot(i);
      cup.position.set(x, FLOOR_Y, z);
      cup.scale.setScalar(SEAT_SCALE);
      group.add(cup);
      cups.push({ cup, material });
    }
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).rotateY(Math.PI),
      new THREE.MeshBasicMaterial({
        map: this.shadowMap,
        color: 0x000000,
        transparent: true,
        opacity: SHADOW_OPACITY,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    group.visible = false;
    shadow.visible = false;
    scene.add(group, shadow);
    return { group, glass, glassMaterial, lightMaterial, cups, shadow };
  }

  // A new level: every U.F.O.'s footprint worked out and its cups colored
  build(state) {
    this.clear();
    const mine = state.features[NUMBER];
    if (!mine) {
      return;
    }
    const { grid } = state;
    this.cell = grid.size / L_PER_UNIT;
    this.now = state.tick;
    mine.ufos.slice(0, UFOS).forEach((record, index) => this.setup(index, record, grid));
  }

  setup(index, record, grid) {
    const xs = record.cells.map((c) => c % grid.width);
    const ys = record.cells.map((c) => Math.floor(c / grid.width));
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const slot = this.slots[index];
    record.seats.slice(0, SEATS).forEach((seat, i) => slot.cups[i].material.color.copy(COLORS[seat.color]));
    const across = (maxX - minX + 1) * this.cell;
    const length = (maxY - minY + 1) * this.cell;
    this.ufos[index] = {
      record,
      slot,
      x: ((minX + maxX) / 2 - (grid.width - 1) / 2) * this.cell,
      z: -((minY + maxY) / 2 - (grid.height - 1) / 2) * this.cell,
      k: Math.min(across, length) / MODEL_WIDE,
      across,
      length,
      launch: null,
      lastLand: -1e9,
      pose: { x: 0, y: 0, z: 0, yaw: 0, k: 1, gone: false },
      flew: false,
    };
  }

  clear() {
    this.ufos = [];
    this.seated.clear();
    this.lands.clear();
    for (const slot of this.slots) {
      slot.group.visible = false;
      slot.shadow.visible = false;
    }
  }

  onEvents(events) {
    for (const event of events) {
      if (event.k === "ufo_seat") {
        this.seat(event);
      } else if (event.k === "ufo_launch") {
        this.takeOff(event);
      }
    }
  }

  // A cat takes a cup: the dome opens now and closes once it has landed
  seat(event) {
    const ufo = this.ufos[event.ufo];
    if (!ufo) {
      return;
    }
    const lands = event.t + SEAT_TICKS;
    this.lands.set(event.ufo * SEATS + event.seat, { t: lands, played: false });
    ufo.lastLand = Math.max(ufo.lastLand, lands);
    sound("ufo_open");
  }

  // The saucer is out of the grid: it lifts once the last cat has landed and the dome has shut
  takeOff(event) {
    const ufo = this.ufos[event.ufo];
    if (ufo) {
      const waits = event.why === "full" ? ufo.lastLand + CLOSE_TICKS : event.t;
      ufo.launch = { t0: Math.max(event.t, waits) };
    }
  }

  // Where cup `seat` of U.F.O. `ufo` is in the world now, for a cat sitting in it, or null once the saucer is gone
  seatSpot(ufoIndex, seatIndex) {
    const ufo = this.ufos[ufoIndex];
    if (!ufo || ufo.pose.gone) {
      return null;
    }
    const { pose } = ufo;
    const [lx, lz] = cupSpot(seatIndex);
    const cos = Math.cos(pose.yaw);
    const sin = Math.sin(pose.yaw);
    const k = pose.k;
    return {
      x: pose.x + (lx * cos + lz * sin) * k,
      y: pose.y + (FLOOR_Y + CAT_RISE) * k,
      z: pose.z + (-lx * sin + lz * cos) * k,
      yaw: pose.yaw,
      scale: ((CAT_FIT * 0.558 * 1.3 * SEAT_SCALE) / 0.86) * k,
      fade: 1,
    };
  }

  begin(state) {
    this.seated.clear();
    const mine = state.features[NUMBER];
    if (!mine) {
      return;
    }
    mine.ufos.forEach((ufo, index) => {
      ufo.seats.forEach((seat, seatIndex) => {
        if (seat.pig >= 0) {
          this.seated.set(seat.pig, [index, seatIndex]);
        }
      });
    });
  }

  // A cat sitting in a cup is drawn here, riding with the saucer; one still flying in is the effects' (fx.js)
  shape(id, pig, pose) {
    const found = this.seated.get(id);
    if (!found) {
      return;
    }
    const lands = this.lands.get(found[0] * SEATS + found[1]);
    if (lands && this.now < lands.t) {
      return;
    }
    const spot = this.seatSpot(found[0], found[1]);
    if (!spot) {
      pose.shown = false;
      return;
    }
    Object.assign(pose, spot, { shown: true, air: 0, sx: 1, sy: 1, face: -1, digits: false });
  }

  // The dome's openness, 0 shut to 1 open: open while a cat is flying in to this saucer, easing at both ends
  domeOpen(index) {
    let open = 0;
    for (let seat = 0; seat < SEATS; seat++) {
      const land = this.lands.get(index * SEATS + seat);
      if (land) {
        const rise = clamp01((this.now - (land.t - SEAT_TICKS)) / OPEN_TICKS);
        const fall = clamp01((land.t - this.now) / OPEN_TICKS);
        open = Math.max(open, Math.min(rise, fall));
      }
    }
    return open;
  }

  // The saucer's place this frame: standing, or on its way off the screen
  place(ufo) {
    const { pose } = ufo;
    Object.assign(pose, { x: ufo.x, y: 0, z: ufo.z, yaw: 0, k: ufo.k, gone: false });
    if (!ufo.launch) {
      return 0;
    }
    const age = this.now - ufo.launch.t0;
    if (age < 0) {
      return 0;
    }
    pose.y = LIFT_HIGH * easeOutCubic(clamp01(age / LIFT_TICKS));
    const fly = clamp01((age - LIFT_TICKS - LAUNCH_DELAY) / FLY_TICKS);
    const run = easeInCubic(fly);
    pose.z -= FLY_FAR * run;
    pose.y += FLY_RISE * run;
    pose.yaw = FLY_SPIN * run;
    pose.k = ufo.k * (1 - easeInCubic(clamp01((fly - SHRINK_FROM) / (1 - SHRINK_FROM))));
    pose.gone = fly >= 1;
    return age;
  }

  // The lights blink while the saucer launches; the launch sound rings as it starts to fly
  launchEffects(ufo, age) {
    const { slot } = ufo;
    const on = age >= 0 && !ufo.pose.gone && Math.floor(age / LIGHT_BLINK) % 2 === 0;
    slot.lightMaterial.color.set(on ? LIGHT_ON : LIGHT_OFF);
    slot.lightMaterial.emissive.set(on ? LIGHT_ON : 0x000000);
    if (!ufo.flew && age >= LIFT_TICKS + LAUNCH_DELAY) {
      ufo.flew = true;
      sound("ufo_launch");
    }
  }

  draw(ufo, index) {
    const { slot, pose } = ufo;
    const age = this.place(ufo);
    slot.group.visible = !pose.gone;
    const fade = ufo.launch ? 1 - clamp01(age / SHADOW_FADE) : 1;
    slot.shadow.visible = !pose.gone && fade > 0;
    if (pose.gone) {
      return;
    }
    slot.group.position.set(pose.x, pose.y, pose.z);
    slot.group.rotation.set(0, pose.yaw, 0);
    slot.group.scale.setScalar(pose.k);
    const open = this.domeOpen(index);
    slot.glass.position.y = OPEN_LIFT * open;
    slot.glassMaterial.opacity = GLASS_SHUT + (GLASS_OPEN - GLASS_SHUT) * open;
    this.launchEffects(ufo, ufo.launch ? age : -1);
    const wide = ufo.across * SHADOW_WIDE;
    const long = ufo.length * SHADOW_WIDE;
    slot.shadow.position.set(ufo.x + wide * SHADOW_SHIFT, SHADOW_LIFT, ufo.z + long * SHADOW_SHIFT);
    slot.shadow.scale.set(wide, 1, long);
    slot.shadow.material.opacity = SHADOW_OPACITY * fade;
  }

  // The click of each cat settling into its cup
  settle() {
    for (const land of this.lands.values()) {
      if (!land.played && this.now >= land.t) {
        land.played = true;
        sound("ufo_seat");
        sound("ufo_close");
      }
    }
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
    this.ufos.forEach((ufo, index) => this.draw(ufo, index));
    this.settle();
  }
}

// Load the saucer and the cup, and add the pool of saucers to the scene
export async function create(scene) {
  const loader = new GLTFLoader();
  const [saucer, seat, shadow] = await Promise.all([
    loader.loadAsync(MODEL),
    loader.loadAsync(SEAT_MODEL),
    new THREE.TextureLoader().loadAsync(SHADOW),
  ]);
  shadow.colorSpace = THREE.SRGBColorSpace;
  return new UfoLook(piecesOf(saucer), piecesOf(seat), shadow, scene);
}
