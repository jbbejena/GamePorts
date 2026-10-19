// Feature 32, the Astro Pig and its Spaceship: an astro cat wears a glass helmet with a ring, a backpack, an antenna and
// side lights (`models/overlay_astro.glb`, placed on the cat like every overlay). A rocket leans on a steel platform over
// the cubes of its color (`models/features/spaceship_model_base.glb`: platform, body with fins and nose cone; the prefab
// has no materials, so the paint is the look's own: steel platform, a body in the ship's color, a lighter nose). When an
// astro cat runs dry it jumps for a second (SpaceshipModel placeDuration, placeJumpHeight 6) to the cockpit while the nose
// lifts open (SpaceshipAnimations headOpenAngle 60, headOpenDuration 0.25 s); once it has landed the nose closes, the
// rocket shakes and flies up the screen with the cat inside, shrinking as it goes (scaleDownStartProgress 0.6), while its
// cells are already free for the rules. The sounds are the prefabs': the helmet closing, the cat settling in, the nose
// opening, the wind-up and the lift-off. The closing, the wind-up and the climb are shorter than the original's (a 0.2 s
// wait, 0.3 s closing, 0.7 s of shaking, a 0.5 s delay and a 2 s climb) because the cells are free at the landing; the
// nose's hinge and the flight path are the look's own. Everything comes from the simulation's ship records
// (sim/features/astro_pig.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { COLORS } from "../picture.js";
import { play as sound } from "../sound.js";
import { NUMBER } from "../sim/features/astro_pig.js";
import { ASTRO_PLACE_JUMP, L_PER_UNIT } from "../sim/numbers.js";

export { NUMBER };

const HELMET_MODEL = "models/overlay_astro.glb";
const SHIP_MODEL = "models/features/spaceship_model_base.glb";
// The most ships one level holds is 6, and the most astro cats too
const SHIPS = 6;
const HELMETS = 12;
// The platform is this wide in the model, and the rocket fills this share of its cells' width
const MODEL_WIDE = 1.32;
const FIT = 0.9;
// The rocket stands this much squatter than the model against its width, so it hides little of the picture behind it
const SQUAT = 0.62;
// Where the cat sits in the cockpit (model units) and how big it is against the model
const SEAT = [0, 1.32, -0.12];
const CAT_FIT = 0.62;
// The nose's hinge (model units) and how far it swings open
const HINGE = [0, 1.1, -0.35];
const OPEN_ANGLE = (60 * Math.PI) / 180;
// Ticks: the nose opens as the cat leaves, closes this long after it lands over CLOSE_TICKS, then the rocket shakes for
// WIND_TICKS and climbs for CLIMB_TICKS
const OPEN_TICKS = 15;
const CLOSE_DELAY = 6;
const CLOSE_TICKS = 10;
const WIND_TICKS = 18;
const CLIMB_TICKS = 54;
// The climb: this high and this far up the screen (world units), tipping this far, shrinking from this share of it
const CLIMB_HIGH = 26;
const CLIMB_FAR = 10;
const CLIMB_TIP = 0.5;
const SHRINK_FROM = 0.6;
const SHAKE = 0.05;
// Painting
const STEEL = 0x8892b8;
const NOSE_LIFT = 0.4;
const white = new THREE.Color(0xffffff);
const paint = new THREE.Color();

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

function easeOutCubic(u) {
  return 1 - (1 - u) ** 3;
}

function easeInCubic(u) {
  return u ** 3;
}

// The prefab's three pieces with their node transforms baked in: the platform, the body and the nose
function piecesOf(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const found = {};
  gltf.scene.traverse((node) => {
    if (node.isMesh) {
      const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
      geometry.deleteAttribute("uv");
      found[node.name] = geometry;
    }
  });
  return found;
}

class AstroLook {
  constructor(ships, helmets) {
    this.ships = ships;
    this.helmets = helmets;
    this.now = 0;
    this.mine = null;
    this.cell = 0;
    // Per ship: where it stands ({x, z, wide}), when its cat set off and lands, when it lifts off and which sounds rang
    this.records = [];
    // Pig id to ship index for every cat seated this tick
    this.seated = new Map();
    // Pig id to its drawn pose this frame, for the helmets
    this.poses = new Map();
  }

  build(state) {
    this.clear();
    this.mine = state.features[NUMBER] || null;
    this.now = state.tick;
    if (!this.mine) {
      return;
    }
    const { grid } = state;
    this.cell = grid.size / L_PER_UNIT;
    this.mine.ships.slice(0, SHIPS).forEach((ship, index) => {
      const xs = ship.cells.map((c) => c % grid.width);
      const ys = ship.cells.map((c) => Math.floor(c / grid.width));
      const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
      const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
      const gone = state.grid.targets[ship.target].dead;
      this.records.push({
        x: ((minX + maxX) / 2 - (grid.width - 1) / 2) * this.cell,
        z: -((minY + maxY) / 2 - (grid.height - 1) / 2) * this.cell,
        wide: (maxX - minX + 1) * this.cell * FIT,
        seatAt: ship.pig >= 0 ? state.tick - ASTRO_PLACE_JUMP : null,
        lift0: gone ? -Infinity : null,
        played: new Set(),
      });
      paint.copy(COLORS[ship.color]);
      this.ships[index].body.color.copy(paint);
      this.ships[index].nose.color.copy(paint).lerp(white, NOSE_LIFT);
    });
  }

  clear() {
    this.mine = null;
    this.records = [];
    this.seated.clear();
    this.poses.clear();
    for (const ship of this.ships) {
      ship.group.visible = false;
    }
    for (const helmet of this.helmets) {
      helmet.visible = false;
    }
  }

  onEvents(events) {
    for (const event of events) {
      const record = this.records[event.ship];
      if (!record) {
        continue;
      }
      if (event.k === "ship_seat") {
        record.seatAt = event.t;
        sound("helmet_close");
        sound("ship_open");
      } else if (event.k === "ship_launch") {
        // A launch for the cat settled in waits for the nose to close and the wind-up; a revive's goes at once
        const closed = record.seatAt === null ? event.t : event.t + CLOSE_DELAY + CLOSE_TICKS;
        record.lift0 = closed + WIND_TICKS;
        record.windAt = closed;
      }
    }
  }

  // The nose's openness, 0 shut to 1 open: opening as the cat sets off, closing once it has landed
  noseOpen(record) {
    if (record.seatAt === null) {
      return 0;
    }
    const land = record.seatAt + ASTRO_PLACE_JUMP;
    const rise = clamp01((this.now - record.seatAt) / OPEN_TICKS);
    const fall = clamp01((this.now - land - CLOSE_DELAY) / CLOSE_TICKS);
    return rise * (1 - fall);
  }

  // Where the rocket is this frame ({x, y, z, tip, k, gone}): standing, shaking while it winds up, or climbing away
  place(record) {
    const k = record.wide / MODEL_WIDE;
    const pose = { x: record.x, y: 0, z: record.z, tip: 0, k, gone: false };
    if (record.lift0 === null) {
      return pose;
    }
    const wind = record.windAt === undefined ? record.lift0 - WIND_TICKS : record.windAt;
    if (this.now >= wind && this.now < record.lift0) {
      const shake = SHAKE * k * Math.sin((this.now - wind) * 2.1) * clamp01((this.now - wind) / 6);
      pose.x += shake;
      pose.z += shake * 0.4;
    }
    const u = clamp01((this.now - record.lift0) / CLIMB_TICKS);
    const run = easeInCubic(u);
    pose.y = CLIMB_HIGH * run;
    pose.z -= CLIMB_FAR * run;
    pose.tip = CLIMB_TIP * run;
    pose.k = k * (1 - easeInCubic(clamp01((u - SHRINK_FROM) / (1 - SHRINK_FROM))));
    pose.gone = u >= 1;
    return pose;
  }

  // Where the cockpit is in the world now, for a cat flying to it or sitting in it, or null once the rocket is gone
  shipSpot(index) {
    const record = this.records[index];
    if (!record) {
      return null;
    }
    const pose = this.place(record);
    if (pose.gone) {
      return null;
    }
    const cos = Math.cos(pose.tip);
    const sin = Math.sin(pose.tip);
    return {
      x: pose.x + SEAT[0] * pose.k,
      y: pose.y + (SEAT[1] * cos - SEAT[2] * sin) * pose.k * SQUAT,
      z: pose.z + (SEAT[2] * cos + SEAT[1] * sin) * pose.k,
      yaw: 0,
      scale: CAT_FIT * pose.k * 0.8,
      fade: 1,
    };
  }

  begin(state) {
    this.seated.clear();
    this.poses.clear();
    this.mine = state.features[NUMBER] || null;
    if (!this.mine) {
      return;
    }
    this.mine.ships.forEach((ship, index) => {
      if (ship.pig >= 0) {
        this.seated.set(ship.pig, index);
      }
    });
  }

  // A cat sitting in a cockpit rides with its rocket until the nose has closed over it; every drawn astro cat gets a helmet
  shape(id, pig, pose) {
    const index = this.seated.get(id);
    if (index !== undefined) {
      const record = this.records[index];
      const land = record && record.seatAt !== null ? record.seatAt + ASTRO_PLACE_JUMP : 0;
      const hidden = !record || this.now >= land + CLOSE_DELAY + CLOSE_TICKS;
      if (this.now < land) {
        return;
      }
      const spot = this.shipSpot(index);
      if (hidden || !spot) {
        pose.shown = false;
        return;
      }
      Object.assign(pose, spot, { shown: true, air: 0, sx: 1, sy: 1, face: -1, digits: false });
    }
    if (pose.shown && pig.tags.includes("astro")) {
      this.poses.set(id, {
        x: pose.x,
        y: pose.y + pose.air,
        z: pose.z,
        yaw: pose.yaw,
        sx: pose.scale * pose.sx,
        sy: pose.scale * pose.sy,
      });
    }
  }

  end() {
    let used = 0;
    for (const at of this.poses.values()) {
      if (used >= this.helmets.length) {
        break;
      }
      const helmet = this.helmets[used];
      helmet.visible = true;
      helmet.position.set(at.x, at.y, at.z);
      helmet.rotation.set(0, at.yaw, 0);
      helmet.scale.set(at.sx, at.sy, at.sx);
      used += 1;
    }
    for (let i = used; i < this.helmets.length; i++) {
      this.helmets[i].visible = false;
    }
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
    if (!this.mine) {
      return;
    }
    this.ships.forEach((ship, index) => this.draw(ship, index));
  }

  draw(ship, index) {
    const record = this.records[index];
    if (!record) {
      ship.group.visible = false;
      return;
    }
    const pose = this.place(record);
    ship.group.visible = !pose.gone && record.lift0 !== -Infinity;
    if (!ship.group.visible) {
      return;
    }
    ship.group.position.set(pose.x, pose.y, pose.z);
    ship.group.rotation.set(-pose.tip, 0, 0);
    ship.group.scale.set(pose.k, pose.k * SQUAT, pose.k);
    // The nose swings up and back about its hinge
    const open = this.noseOpen(record);
    ship.nose.mesh.rotation.x = -OPEN_ANGLE * easeOutCubic(open);
    this.ring(record, pose);
  }

  // The sounds that ring once as the timeline passes them
  ring(record, pose) {
    if (record.seatAt !== null && this.now >= record.seatAt + ASTRO_PLACE_JUMP && !record.played.has("land")) {
      record.played.add("land");
      sound("ship_place");
    }
    const wind = record.lift0 === null ? null : (record.windAt ?? record.lift0 - WIND_TICKS);
    if (wind !== null && this.now >= wind && !record.played.has("wind")) {
      record.played.add("wind");
      sound("ship_wind");
    }
    if (record.lift0 !== null && this.now >= record.lift0 && !record.played.has("lift") && !pose.gone) {
      record.played.add("lift");
      sound("ship_launch");
    }
  }
}

// Load the rocket and the helmet, and add pools of rockets and helmets to the scene
export async function create(scene) {
  const loader = new GLTFLoader();
  const [shipGltf, helmetGltf] = await Promise.all([loader.loadAsync(SHIP_MODEL), loader.loadAsync(HELMET_MODEL)]);
  const pieces = piecesOf(shipGltf);
  const ships = Array.from({ length: SHIPS }, () => {
    const group = new THREE.Group();
    const platform = new THREE.Mesh(
      pieces.Model_Platform_0,
      new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.5, metalness: 0.2 }),
    );
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.4 });
    const noseMaterial = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.35 });
    const body = new THREE.Mesh(pieces.Spaceship_Base_1, bodyMaterial);
    // The nose swings about its hinge: its mesh is shifted so the hinge is the group's origin
    const hinge = new THREE.Group();
    hinge.position.set(...HINGE);
    const nose = new THREE.Mesh(pieces.Spaceship_Head_2, noseMaterial);
    nose.position.set(-HINGE[0], -HINGE[1], -HINGE[2]);
    hinge.add(nose);
    group.add(platform, body, hinge);
    group.visible = false;
    scene.add(group);
    return { group, body: bodyMaterial, nose: { color: noseMaterial.color, mesh: hinge } };
  });
  const helmets = Array.from({ length: HELMETS }, () => {
    const helmet = helmetGltf.scene.clone();
    helmet.traverse((node) => {
      if (node.isMesh) {
        node.material = node.material.clone();
        node.renderOrder = 2;
        node.material.depthWrite = false;
      }
    });
    helmet.visible = false;
    scene.add(helmet);
    return helmet;
  });
  return new AstroLook(ships, helmets);
}
