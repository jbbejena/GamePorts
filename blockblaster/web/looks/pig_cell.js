// Feature 22, the Cat Cell: a cat sits facing the camera inside a steel cage on the patch of the picture the cage covers
// (reference frame level1000-vault-pig-in-picture.png), as big as the patch is wide. When the picture around it is
// cleared to the outside the cage lifts off, spinning, swelling and fading with the opening sound, and the cat jumps
// for half a second to its place at the back of the rescue row (fx.js draws the jump from the spot this look gives and
// pigs.js stands it on the row's next spot). The cage is `models/overlay_cage.glb` (ASSETS.md), placed on the cat like
// every overlay, drawn without its top so the cat shows from above. The original's prefab holds no sound the unpacked
// files name, so the opening is the sliding-metal sound of the keys' locks. Everything comes from the simulation's cage
// records (sim/features/pig_cell.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { NUMBER } from "../sim/features/pig_cell.js";
import { L_PER_UNIT } from "../sim/numbers.js";
import { play as sound } from "../sound.js";

export { NUMBER };

const MODEL = "models/overlay_cage.glb";
// The most cages one level holds is 12 (level 1100)
const CAPACITY = 14;
// The overlay is this wide at cat scale 1 (the rails), and the cage fills this share of the patch it covers
const CAGE_WIDE = 1.08;
const CAGE_FILL = 0.94;
// The overlay's top rail, roof and handle stand above this height; they are left out so the cat shows from above
const LID_HEIGHT = 1;
// The opening: the cage rises this many cat heights, swells, spins and fades over this many ticks
const OPEN_TICKS = 24;
const OPEN_RISE = 1.4;
const OPEN_SWELL = 0.25;
const OPEN_SPIN = 2.2;

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

function easeOutCubic(u) {
  return 1 - (1 - u) ** 3;
}

class PigCellLook {
  constructor(parts) {
    this.parts = parts;
    this.now = 0;
    this.mine = null;
    // Per cage index: where it stands ({x, z, scale}) and when it was opened (-Infinity when it was open already)
    this.spots = [];
    this.opened = [];
    // Pig id to cage index
    this.byPig = new Map();
  }

  build(state) {
    this.clear();
    this.mine = state.features[NUMBER] || null;
    this.now = state.tick;
    if (!this.mine) {
      return;
    }
    const { grid } = state;
    const cell = grid.size / L_PER_UNIT;
    this.mine.cages.slice(0, CAPACITY).forEach((cage, index) => {
      const xs = cage.cells.map((c) => c % grid.width);
      const ys = cage.cells.map((c) => Math.floor(c / grid.width));
      const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
      const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
      const side = Math.min(maxX - minX + 1, maxY - minY + 1) * cell;
      this.spots.push({
        x: ((minX + maxX) / 2 - (grid.width - 1) / 2) * cell,
        z: -((minY + maxY) / 2 - (grid.height - 1) / 2) * cell,
        scale: (side * CAGE_FILL) / CAGE_WIDE,
      });
      this.opened.push(cage.freed ? -Infinity : null);
      this.byPig.set(cage.pig, index);
    });
  }

  begin(state) {
    this.mine = state.features[NUMBER] || null;
  }

  clear() {
    this.mine = null;
    this.spots = [];
    this.opened = [];
    this.byPig.clear();
    for (const part of this.parts) {
      part.group.visible = false;
      part.material.opacity = 1;
    }
  }

  onEvents(events) {
    for (const event of events) {
      if (event.k === "cage_free" && event.cage < this.opened.length) {
        this.opened[event.cage] = event.t;
        sound("cage_open");
      }
    }
  }

  // The cat's spot in the cage as a look for fx.js to start its jump from, or null for a pig that is in no cage
  cageSpot(pigId) {
    const index = this.byPig.get(pigId);
    if (index === undefined) {
      return null;
    }
    const { x, z, scale } = this.spots[index];
    return { x, y: 0, z, yaw: 0, scale, fade: 1 };
  }

  // Where a jumping cat will stand in the rescue row, as how many cats join the row before it
  rescueIndex(pigId) {
    if (!this.mine) {
      return null;
    }
    const at = this.mine.flights.findIndex((flight) => flight[0] === pigId);
    return at < 0 ? null : { index: at };
  }

  // A cat still shut in its cage stands in it facing the camera; one that is jumping out is placed by pigs.js
  shape(id, pig, pose) {
    const index = this.byPig.get(id);
    if (index === undefined || pig.place !== "held" || this.mine.cages[index].freed) {
      return;
    }
    const { x, z, scale } = this.spots[index];
    Object.assign(pose, {
      x,
      y: 0,
      z,
      yaw: 0,
      scale,
      fade: 1,
      shown: true,
      air: 0,
      sx: 1,
      sy: 1,
      face: -1,
      digits: true,
    });
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
    this.parts.forEach((part, index) => this.draw(part, index));
  }

  // One cage: standing round its cat, opening, or gone
  draw(part, index) {
    const spot = this.spots[index];
    const openedAt = this.opened[index];
    if (!spot || openedAt === undefined || (openedAt !== null && this.now - openedAt >= OPEN_TICKS)) {
      part.group.visible = false;
      return;
    }
    const u = openedAt === null ? 0 : clamp01((this.now - openedAt) / OPEN_TICKS);
    const e = easeOutCubic(u);
    part.group.visible = true;
    part.group.position.set(spot.x, OPEN_RISE * spot.scale * e, spot.z);
    part.group.rotation.set(0, OPEN_SPIN * e, 0);
    part.group.scale.setScalar(spot.scale * (1 + OPEN_SWELL * e));
    part.material.opacity = 1 - u;
  }
}

// Load the cage and add a pool of them to the scene
export async function create(scene) {
  const gltf = await new GLTFLoader().loadAsync(MODEL);
  const parts = [];
  for (let i = 0; i < CAPACITY; i++) {
    const group = new THREE.Group();
    const cage = gltf.scene.clone();
    const material = gltf.scene.getObjectByProperty("isMesh", true).material.clone();
    material.transparent = true;
    cage.traverse((node) => {
      if (node.isMesh) {
        node.material = material;
        node.visible = node.position.y < LID_HEIGHT;
      }
    });
    group.add(cage);
    group.visible = false;
    scene.add(group);
    parts.push({ group, material });
  }
  return new PigCellLook(parts);
}
