// Feature 29, the Dungeon: a cat sits facing the camera inside a steel cage on a glassy pad of the cage's color that
// fills the patch of the picture the cage covers (the feature's picture, FeatureImage_ColoredShooterCage.png). The
// pad is the original prefab's base slab (`models/features/colored_shooter_cage_feature.glb`, which has no materials,
// so the paint is the look's own) and the cage `models/overlay_cage.glb` (ASSETS.md), drawn without its top so the
// cat shows from above. The pad's shade goes down in three stages as its health falls and it jumps a little at every
// hit; a pill straddling its front edge counts the hits left. When the health reaches 0 the cage lifts off, spinning,
// swelling and fading, and the pad bursts apart over the same 0.4 s the simulation waits, then the cat jumps for half
// a second to its place at the back of the rescue row (fx.js draws the jump from the spot this look gives and pigs.js
// stands it on the row's next spot). Everything comes from the simulation's cage records (sim/features/dungeon.js)
// and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { PICTURE_HEIGHT } from "../camera.js";
import { COLORS } from "../picture.js";
import { play as sound } from "../sound.js";
import { NUMBER } from "../sim/features/dungeon.js";
import { DUNGEON_WAIT, L_PER_UNIT } from "../sim/numbers.js";

export { NUMBER };

const CAGE_MODEL = "models/overlay_cage.glb";
const PAD_MODEL = "models/features/colored_shooter_cage_feature.glb";
// The most dungeons one level holds is 6
const CAPACITY = 8;
// The overlay is this wide at cat scale 1 (the rails); the cage fills this share of the patch it covers, and the
// pad this share of the patch's width
const CAGE_WIDE = 1.08;
const CAGE_FILL = 0.74;
const PAD_FIT = 0.98;
// The overlay's top rail, roof and handle stand above this height; they are left out so the cat shows from above
const LID_HEIGHT = 1;
// The pad stands this many cube heights tall
const PAD_TALL = 0.45;
// The opening: the cage rises this many cat heights, swells, spins and fades over the wait's ticks
const OPEN_RISE = 1.4;
const OPEN_SWELL = 0.25;
const OPEN_SPIN = 2.2;
// A hit jumps the pad up this share of its height and settles over this many ticks
const HIT_JUMP = 0.5;
const HIT_TICKS = 8;
// The burst: the pad swells, tips and shrinks away over these many ticks after the cage's death
const BURST_TICKS = 18;
const BURST_SWELL = 0.12;
// The pad's brightness by stage (full health, two thirds, one third)
const STAGE_SHADE = [1, 0.82, 0.64];
// The hits-left pill on the pad
const LABEL_W = 128;
const LABEL_H = 80;
const LABEL_FONT = '"Inter Black", "Segoe UI", sans-serif';
const LABEL_INK = "#2b3a6b";
const LABEL_SHARE = 0.8;
const LABEL_WIDE = 0.26;
const LABEL_LIFT = 0.01;

const paint = new THREE.Color();

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

function easeOutCubic(u) {
  return 1 - (1 - u) ** 3;
}

// The pad's slab with its node's place, turn and scale baked in, laid on the origin with its foot at 0 and one unit wide
// and deep
function padGeometry(gltf) {
  let node = null;
  gltf.scene.traverse((child) => {
    node = node || (child.isMesh && child.name === "Model_Cage_0" ? child : null);
  });
  const geometry = node.geometry.clone();
  geometry.deleteAttribute("uv");
  geometry.applyMatrix4(new THREE.Matrix4().compose(node.position, node.quaternion, node.scale));
  const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.scale(1 / (box.max.x - box.min.x), 1 / (box.max.y - box.min.y), 1 / (box.max.z - box.min.z));
  return geometry;
}

class DungeonLook {
  constructor(parts) {
    this.parts = parts;
    this.now = 0;
    this.mine = null;
    // Per cage index: where it stands, its colors, the last health shown and the ticks of its last hit and its death
    this.cages = [];
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
      const target = grid.targets[cage.target];
      const cells = target.cells.length ? target.cells : this.cellsOf(state, index);
      const xs = cells.map((c) => c % grid.width);
      const ys = cells.map((c) => Math.floor(c / grid.width));
      const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
      const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
      const side = Math.min(maxX - minX + 1, maxY - minY + 1) * cell;
      this.cages.push({
        x: ((minX + maxX) / 2 - (grid.width - 1) / 2) * cell,
        z: -((minY + maxY) / 2 - (grid.height - 1) / 2) * cell,
        wide: (maxX - minX + 1) * cell * PAD_FIT,
        deep: (maxY - minY + 1) * cell * PAD_FIT,
        scale: (side * CAGE_FILL) / CAGE_WIDE,
        color: COLORS[target.color],
        start: cage.start,
        hitAt: -Infinity,
        diedAt: target.dead ? -Infinity : null,
        shown: null,
      });
      this.byPig.set(cage.pig, index);
    });
  }

  // The cells a cage stood on, from the level's list (a rebuilt game may start with it already gone)
  cellsOf(state, index) {
    const { grid } = state;
    return state.level.features.coloredShooterCages.Cages[index].GridPoints.map((p) => p.Y * grid.width + p.X);
  }

  clear() {
    this.mine = null;
    this.cages = [];
    this.byPig.clear();
    for (const part of this.parts) {
      part.group.visible = false;
      part.pad.visible = false;
      part.label.visible = false;
      part.material.opacity = 1;
    }
  }

  onEvents(events) {
    for (const event of events) {
      if (event.k === "hit" && this.mine) {
        const index = this.mine.cages.findIndex((cage) => cage.target === event.target);
        if (index >= 0 && this.cages[index]) {
          this.cages[index].hitAt = event.t;
        }
      } else if (event.k === "dungeon_dead" && this.cages[event.cage]) {
        this.cages[event.cage].diedAt = event.t;
        sound("cage_open");
      }
    }
  }

  // The cat's spot in the cage as a look for fx.js to start its jump from, or null for a pig that is in no dungeon
  cageSpot(pigId) {
    const index = this.byPig.get(pigId);
    if (index === undefined) {
      return null;
    }
    const { x, z, scale } = this.cages[index];
    return { x, y: PICTURE_HEIGHT * PAD_TALL, z, yaw: 0, scale, fade: 1 };
  }

  // Where a jumping cat will stand in the rescue row, as how many cats join the row before it
  rescueIndex(pigId) {
    if (!this.mine) {
      return null;
    }
    const at = this.mine.flights.findIndex((flight) => flight[0] === pigId);
    return at < 0 ? null : { index: at };
  }

  begin(state) {
    this.mine = state.features[NUMBER] || null;
  }

  // A cat still shut in its cage stands in it facing the camera, on the pad; one that is jumping out is placed by
  // pigs.js
  shape(id, pig, pose) {
    const index = this.byPig.get(id);
    if (index === undefined || pig.place !== "held" || this.mine.cages[index].freed) {
      return;
    }
    const { x, z, scale } = this.cages[index];
    Object.assign(pose, {
      x,
      y: PICTURE_HEIGHT * PAD_TALL,
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
    this.parts.forEach((part, index) => this.draw(part, index, state));
  }

  // One dungeon: the pad with its count and the cage round the cat, in whatever stage of opening it is in
  draw(part, index, state) {
    const spot = this.cages[index];
    if (!spot) {
      return;
    }
    const target = state.grid.targets[this.mine.cages[index].target];
    const died = spot.diedAt === null ? 0 : clamp01((this.now - spot.diedAt) / DUNGEON_WAIT);
    const burst = spot.diedAt === null ? 0 : clamp01((this.now - spot.diedAt) / BURST_TICKS);
    part.group.visible = died < 1;
    part.pad.visible = burst < 1;
    part.label.visible = spot.diedAt === null;
    if (part.pad.visible) {
      this.drawPad(part, spot, target, burst);
    }
    if (part.group.visible) {
      const e = easeOutCubic(died);
      part.group.position.set(spot.x, PICTURE_HEIGHT * PAD_TALL + OPEN_RISE * spot.scale * e, spot.z);
      part.group.rotation.set(0, OPEN_SPIN * e, 0);
      part.group.scale.setScalar(spot.scale * (1 + OPEN_SWELL * e));
      part.material.opacity = 1 - died;
    }
  }

  drawPad(part, spot, target, burst) {
    const stage = target.health * 3 > spot.start * 2 ? 0 : target.health * 3 > spot.start ? 1 : 2;
    const punch = clamp01((this.now - spot.hitAt) / HIT_TICKS);
    const jump = punch < 1 ? HIT_JUMP * Math.sin(Math.PI * punch) : 0;
    const tall = PICTURE_HEIGHT * PAD_TALL;
    part.padMaterial.color.copy(spot.color).multiplyScalar(STAGE_SHADE[stage]);
    part.padMaterial.opacity = 1 - burst;
    part.pad.position.set(spot.x, tall * jump * 0.5, spot.z);
    part.pad.rotation.set(burst * 0.3, burst * 1.2, 0);
    const swell = 1 + BURST_SWELL * Math.sin(Math.PI * burst) - burst;
    part.pad.scale.set(spot.wide * Math.max(swell, 0.001), tall * (1 + jump), spot.deep * Math.max(swell, 0.001));
    part.label.visible = burst === 0;
    if (part.label.visible) {
      const wide = Math.min(spot.wide, spot.deep) * LABEL_WIDE;
      part.label.scale.set(wide, wide, 1);
      part.label.position.set(spot.x, tall * (1 + jump) + LABEL_LIFT, spot.z + spot.deep / 2);
      if (spot.shown !== target.health) {
        spot.shown = target.health;
        this.paintLabel(part, target.health);
      }
    }
  }

  // The pill's number, redrawn only when it changed
  paintLabel(part, count) {
    const g = part.canvas.getContext("2d");
    g.clearRect(0, 0, LABEL_W, LABEL_H);
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.roundRect(2, 2, LABEL_W - 4, LABEL_H - 4, LABEL_H / 2 - 2);
    g.fill();
    g.font = `900 ${Math.round(LABEL_H * LABEL_SHARE)}px ${LABEL_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = LABEL_INK;
    g.fillText(String(count), LABEL_W / 2, LABEL_H * 0.54, LABEL_W * 0.84);
    part.map.needsUpdate = true;
  }
}

// Load the cage and the pad, and add a pool of dungeons to the scene
export async function create(scene) {
  const loader = new GLTFLoader();
  const [cageGltf, padGltf] = await Promise.all([loader.loadAsync(CAGE_MODEL), loader.loadAsync(PAD_MODEL)]);
  const pad = padGeometry(padGltf);
  const parts = [];
  for (let i = 0; i < CAPACITY; i++) {
    const group = new THREE.Group();
    const cage = cageGltf.scene.clone();
    const material = cageGltf.scene.getObjectByProperty("isMesh", true).material.clone();
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
    const padMaterial = new THREE.MeshStandardMaterial({
      color: paint,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
    });
    const padMesh = new THREE.Mesh(pad, padMaterial);
    padMesh.visible = false;
    scene.add(padMesh);
    const canvas = document.createElement("canvas");
    canvas.width = LABEL_W;
    canvas.height = LABEL_H;
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(1, LABEL_H / LABEL_W),
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, depthTest: false }),
    );
    label.rotation.x = -Math.PI / 2;
    label.renderOrder = 6;
    label.visible = false;
    scene.add(label);
    parts.push({ group, material, pad: padMesh, padMaterial, canvas, map, label });
  }
  return new DungeonLook(parts);
}
