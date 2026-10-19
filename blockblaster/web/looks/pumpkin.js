// Feature 19, Pumpkins: a pale tray lies over the patch's cells and a big pumpkin of the first living color stands on it,
// carved with a glowing face (`models/pumpkin.glb`, tinted by the pumpkin's color; the original's `pumpkin_item_model.glb`
// holds no materials, so the model and the paint are the look's own, as in the feature's picture). The pumpkins still
// waiting stand on the tray's front edge as little ones, the next one furthest left, so the colors to come can be read.
// Each hit squashes the standing pumpkin a little and `pumpkin_hit` rings; as its health falls it darkens and cracks
// sound at a third and two thirds. When it dies it swells and shrinks away (PumpkinModel deathScaleDuration and
// deathScaleOvershoot) with `pumpkin_death`, and the next one pops in at once over 0.05 s with `pumpkin_emerge`, the little
// ones sliding up. When the last one goes the tray shrinks away too. The tray is the original's
// `models/features/pumpkin_feature.glb`. Everything comes from the simulation's pumpkin records
// (sim/features/pumpkin.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { mergeGeometries } from "../vendor/BufferGeometryUtils.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { COLORS } from "../picture.js";
import { play as sound } from "../sound.js";
import { NUMBER } from "../sim/features/pumpkin.js";
import { L_PER_UNIT } from "../sim/numbers.js";

export { NUMBER };

const PUMPKIN_MODEL = "models/pumpkin.glb";
const TRAY_MODEL = "models/features/pumpkin_feature.glb";
// The most patches one level holds is 14 (level 908) and the most pumpkins in all 42; each patch has at most 6
const PATCHES = 16;
const BODIES = 160;
// The standing pumpkin's width against the patch's side, how far back it stands (a share of the side), and how tall it
// is against its width (cubes lie flat, so a full-height pumpkin would hide the picture behind it)
const STAND_WIDE = 0.72;
const STAND_BACK = 0.06;
const STAND_TALL = 0.62;
// Every pumpkin leans back this far (the original's model stands tilted 43 degrees, 0.75 rad), so the camera looking
// down at the picture sees its face
const LEAN = 0.75;
// A little waiting pumpkin: its width against the patch's side, the gap between two, and how far in front of the middle
// the row stands (a share of the side)
const LITTLE_WIDE = 0.16;
const LITTLE_GAP = 1.08;
const LITTLE_FRONT = 0.4;
const LITTLE_INSET = 0.07;
// The tray: its width against the patch's side, how much flatter it stands than its model, where its floor lies as a
// share of its height
const TRAY_FIT = 1.0;
const TRAY_FLAT = 0.3;
const TRAY_FLOOR = 0.7;
// Painting (the look's choice, taken from the feature's picture)
const TRAY_COLOR = 0xcfe3ff;
const STEM_COLOR = 0x4a8f2a;
const FACE_COLOR = 0x2a1636;
const FACE_GLOW = 0xffa80f;
// A pumpkin worn down to nothing is this much darker than a whole one
const WORN_DARK = 0.38;
// The pop-in of the next pumpkin (0.05 s) and the settle after it, the hit squash, the death, and how fast the little
// ones slide up a place (all in ticks)
const POP_TICKS = 3;
const SETTLE_TICKS = 9;
const SETTLE_SWELL = 0.1;
const PUNCH_TICKS = 9;
const PUNCH_SQUASH = 0.1;
const DEATH_TICKS = 12;
const DEATH_OVERSHOOT = 0.15;
const DEATH_SWELL_SHARE = 0.25;
const SLIDE_TICKS = 4;
const LONG_AGO = -1e9;

const matrix = new THREE.Matrix4();
const place = new THREE.Vector3();
const size = new THREE.Vector3();
const LEANED = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -LEAN);
const STRAIGHT = new THREE.Quaternion();
const tint = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

// The pop-in's overshoot: 0 to 1 and a little past
function outBack(u) {
  const v = u - 1;
  return 1 + 2.2 * v * v * v + 1.2 * v * v;
}

// The model's meshes in the file's own space, the `Tint_*` parts in one geometry, the stem in another, the face (eyes,
// teeth, mouth) in a third; all set on the ground with their middle at the origin and the body one unit wide
function pumpkinParts(gltf) {
  const parts = { tint: [], stem: [], face: [] };
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((node) => {
    if (!node.isMesh) {
      return;
    }
    const geometry = node.geometry.clone().toNonIndexed();
    geometry.applyMatrix4(node.matrixWorld);
    geometry.deleteAttribute("uv");
    const kind = node.name.startsWith("Tint_") ? "tint" : node.name.startsWith("Stem") ? "stem" : "face";
    parts[kind].push(geometry);
  });
  const merged = {};
  for (const kind of Object.keys(parts)) {
    merged[kind] = mergeGeometries(parts[kind]);
  }
  const box = new THREE.Box3().setFromBufferAttribute(merged.tint.attributes.position);
  const wide = box.max.x - box.min.x;
  const cx = (box.max.x + box.min.x) / 2;
  const cz = (box.max.z + box.min.z) / 2;
  for (const geometry of Object.values(merged)) {
    geometry.translate(-cx, -box.min.y, -cz);
    geometry.scale(1 / wide, 1 / wide, 1 / wide);
  }
  return merged;
}

// The tray set on the ground with its middle at the origin and one unit wide; its height as a share of its width is
// returned with it
function trayPart(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const geometries = [];
  gltf.scene.traverse((node) => {
    if (node.isMesh) {
      geometries.push(node.geometry.clone().applyMatrix4(node.matrixWorld));
    }
  });
  const geometry = mergeGeometries(geometries);
  const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
  const wide = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  geometry.translate(-(box.max.x + box.min.x) / 2, -box.min.y, -(box.max.z + box.min.z) / 2);
  geometry.scale(1 / wide, 1 / wide, 1 / wide);
  return { geometry, tall: (box.max.y - box.min.y) / wide };
}

function instanced(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

// The swell and shrink of a dying pumpkin: up to 1 + overshoot, then down to nothing
function deathScale(u) {
  if (u < DEATH_SWELL_SHARE) {
    return 1 + DEATH_OVERSHOOT * (u / DEATH_SWELL_SHARE);
  }
  const rest = (u - DEATH_SWELL_SHARE) / (1 - DEATH_SWELL_SHARE);
  return (1 + DEATH_OVERSHOOT) * (1 - rest * rest);
}

class PumpkinLook {
  constructor(parts, tray, scene) {
    this.records = [];
    this.byTarget = new Map();
    this.now = 0;
    this.last = 0;
    this.cell = 0;
    this.trayTall = tray.tall;
    this.tint = instanced(parts.tint, new THREE.MeshStandardMaterial({ roughness: 0.45 }), BODIES);
    this.tint.setColorAt(0, WHITE);
    this.stem = instanced(parts.stem, new THREE.MeshStandardMaterial({ color: STEM_COLOR, roughness: 0.5 }), BODIES);
    this.face = instanced(
      parts.face,
      new THREE.MeshStandardMaterial({
        color: FACE_COLOR,
        roughness: 0.5,
        emissive: FACE_GLOW,
        emissiveIntensity: 1.2,
      }),
      BODIES,
    );
    this.trays = instanced(tray.geometry, new THREE.MeshStandardMaterial({ color: TRAY_COLOR, roughness: 0.35 }), PATCHES);
    this.bodies = [this.tint, this.stem, this.face];
    this.meshes = [...this.bodies, this.trays];
    for (const mesh of this.meshes) {
      scene.add(mesh);
    }
  }

  // A new level: every patch's tray laid over its cells with its pumpkins in order
  build(state) {
    this.clear();
    const mine = state.features[NUMBER];
    if (!mine) {
      return;
    }
    const { grid } = state;
    this.cell = grid.size / L_PER_UNIT;
    this.now = state.tick;
    this.last = this.now;
    const listed = state.level.features.pumpkins.Pumpkins;
    mine.patches.slice(0, PATCHES).forEach((patch, p) => {
      const xs = patch.cells.map((c) => c % grid.width);
      const ys = patch.cells.map((c) => Math.floor(c / grid.width));
      const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
      const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
      const wide = Math.max(maxX - minX + 1, maxY - minY + 1) * this.cell;
      const record = {
        patch,
        wide,
        x: ((minX + maxX) / 2 - (grid.width - 1) / 2) * this.cell,
        z: -((minY + maxY) / 2 - (grid.height - 1) / 2) * this.cell,
        items: [],
        goneAt: patch.current >= patch.items.length ? LONG_AGO : null,
      };
      patch.items.forEach((targetId, j) => {
        const target = grid.targets[targetId];
        const item = {
          target: targetId,
          color: COLORS[target.color],
          start: Math.max(1, listed[p].Pumpkins[j].Health),
          died: target.dead ? LONG_AGO : null,
          pop: LONG_AGO,
          punch: LONG_AGO,
          slot: 0,
          stage: 0,
        };
        item.stage = this.stageOf(item, target.health);
        record.items.push(item);
        this.byTarget.set(targetId, { record, item });
      });
      record.items.forEach((item, j) => {
        item.slot = this.rankOf(record, j);
      });
      this.records.push(record);
    });
  }

  clear() {
    this.records = [];
    this.byTarget = new Map();
    for (const mesh of this.meshes) {
      mesh.count = 0;
    }
  }

  // How worn a pumpkin is: 0 whole, 1 under two thirds, 2 under a third
  stageOf(item, health) {
    return Math.min(2, Math.floor((3 * (item.start - health)) / item.start));
  }

  // The place a waiting pumpkin has in the row: how many living ones wait before it
  rankOf(record, j) {
    let rank = 0;
    for (let k = record.patch.current + 1; k < j; k++) {
      if (record.items[k].died === null) {
        rank += 1;
      }
    }
    return rank;
  }

  onEvents(events) {
    for (const event of events) {
      const entry = this.byTarget.get(event.target);
      if (!entry) {
        continue;
      }
      const { record, item } = entry;
      if (event.k === "hit" && event.health > 0) {
        item.punch = event.t;
        sound("pumpkin_hit");
        const stage = this.stageOf(item, event.health);
        if (stage > item.stage) {
          sound("pumpkin_crack");
        }
        item.stage = stage;
      } else if (event.k === "target_died") {
        item.died = event.t;
        sound("pumpkin_death");
      } else if (event.k === "pumpkin_next") {
        item.pop = event.t;
        sound("pumpkin_emerge");
      } else if (event.k === "pumpkin_patch_gone") {
        record.goneAt = event.t;
      }
    }
  }

  // One pumpkin's three parts at a place, width and height scale and a squash of its own
  put(at, x, y, z, wide, tall, color) {
    place.set(x, y, z);
    size.set(wide, tall, wide);
    matrix.compose(place, LEANED, size);
    for (const mesh of this.bodies) {
      mesh.setMatrixAt(at.bodies, matrix);
    }
    this.tint.setColorAt(at.bodies, color);
    at.bodies += 1;
  }

  // The color of a pumpkin this worn down
  wornColor(item, health) {
    const worn = clamp01(1 - health / item.start);
    return tint.copy(item.color).multiplyScalar(1 - WORN_DARK * worn);
  }

  // The standing pumpkin: popping in, settling, squashed by a hit, or swelling and shrinking away when it died
  drawStanding(record, item, health, at, top) {
    const width = record.wide * STAND_WIDE;
    let scale = 1;
    let squash = 0;
    if (item.died !== null) {
      scale = deathScale(clamp01((this.now - item.died) / DEATH_TICKS));
    } else {
      const age = this.now - item.pop;
      scale = age < POP_TICKS ? outBack(clamp01(age / POP_TICKS)) : 1;
      scale *= 1 + SETTLE_SWELL * Math.sin(Math.PI * clamp01((age - POP_TICKS) / SETTLE_TICKS));
      squash = PUNCH_SQUASH * Math.sin(Math.PI * clamp01((this.now - item.punch) / PUNCH_TICKS));
    }
    if (scale <= 0) {
      return;
    }
    const color = this.wornColor(item, health);
    this.put(
      at,
      record.x,
      top,
      record.z - record.wide * STAND_BACK,
      width * scale * (1 + squash / 2),
      width * STAND_TALL * scale * (1 - squash),
      color,
    );
  }

  // A waiting pumpkin in its place in the row along the tray's front edge
  drawWaiting(record, item, health, at, top) {
    const rank = this.rankOf(record, record.items.indexOf(item));
    const dt = Math.max(0, this.now - this.last);
    item.slot += (rank - item.slot) * clamp01(dt / SLIDE_TICKS);
    const width = record.wide * LITTLE_WIDE;
    const left = record.x - record.wide / 2 + record.wide * LITTLE_INSET + width / 2;
    const scale = item.died === null ? 1 : deathScale(clamp01((this.now - item.died) / DEATH_TICKS));
    if (scale <= 0) {
      return;
    }
    const color = this.wornColor(item, health);
    this.put(
      at,
      left + item.slot * width * LITTLE_GAP,
      top,
      record.z + record.wide * LITTLE_FRONT,
      width * scale,
      width * STAND_TALL * scale,
      color,
    );
  }

  drawPatch(record, state, at) {
    const { patch } = record;
    const gone = record.goneAt === null ? 0 : clamp01((this.now - record.goneAt) / DEATH_TICKS);
    const trayTall = record.wide * this.trayTall * TRAY_FLAT;
    if (gone < 1) {
      place.set(record.x, 0, record.z);
      const shrink = gone === 0 ? 1 : deathScale(gone);
      size.set(record.wide * TRAY_FIT * shrink, record.wide * TRAY_FLAT * shrink, record.wide * TRAY_FIT * shrink);
      this.trays.setMatrixAt(at.trays, matrix.compose(place, STRAIGHT, size));
      at.trays += 1;
    }
    const top = trayTall * TRAY_FLOOR;
    record.items.forEach((item, j) => {
      const health = state.grid.targets[item.target].health;
      if (j === patch.current || (item.died !== null && this.now - item.died < DEATH_TICKS && j <= patch.current)) {
        this.drawStanding(record, item, health, at, top);
      } else if (j > patch.current) {
        this.drawWaiting(record, item, health, at, top);
      }
    });
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
    if (!this.records.length) {
      return;
    }
    const at = { bodies: 0, trays: 0 };
    for (const record of this.records) {
      this.drawPatch(record, state, at);
    }
    this.last = this.now;
    for (const mesh of this.bodies) {
      mesh.count = at.bodies;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.tint.instanceColor.needsUpdate = true;
    this.trays.count = at.trays;
    this.trays.instanceMatrix.needsUpdate = true;
  }
}

// Load the models and add the pools of pumpkins and trays to the scene
export async function create(scene) {
  const loader = new GLTFLoader();
  const [pumpkin, tray] = await Promise.all([loader.loadAsync(PUMPKIN_MODEL), loader.loadAsync(TRAY_MODEL)]);
  return new PumpkinLook(pumpkinParts(pumpkin), trayPart(tray), scene);
}
