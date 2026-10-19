// Feature 26, the Music Toy: a xylophone lies over a patch of the picture, a pale base with a row of glossy notes on it,
// each painted its color (`models/features/music_toy_feature.glb` for the base, `music_toy_segment_model_1x2.glb` and
// `_1x3.glb` for the notes by how long they are against how wide; the prefabs have no materials, so the paint is the
// look's own, the nails a darker shade of the note). A mallet (`music_toy_mallet_feature.glb`: a stick with a ball head,
// the head painted the mallet's color) stands in its queue place instead of a cat. A strike lifts it 1 unit while it
// swells to 1.3, flips it head down as it jumps to its note, winds it back and smashes it down so the damage lands on
// the tick the simulation says; the note then punches, a wave of bumps runs along the toy, the note pops away with its
// own pitch and the mallet shrinks off (MusicToyMalletFeature$$Hit, RVA 0x56B58DC; MusicToyModel$$PlayHitWave). When
// the last note breaks the base squashes and shrinks away with the collapse sound. The notes' pitches are the original's
// note mapping (MusicToyNoteMappingSo: eight notes, each shared by several colors). Everything comes from the
// simulation's records (sim/features/music_toy.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { mergeGeometries } from "../vendor/BufferGeometryUtils.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { PICTURE_HEIGHT } from "../camera.js";
import { COLORS } from "../picture.js";
import { play as sound } from "../sound.js";
import { NUMBER } from "../sim/features/music_toy.js";
import { HAMMER_DONE, HAMMER_LIFT, L_PER_UNIT, STRIKE_LANDS } from "../sim/numbers.js";

export { NUMBER };

const BASE_MODEL = "models/features/music_toy_feature.glb";
const NOTE_MODELS = {
  2: "models/features/music_toy_segment_model_1x2.glb",
  3: "models/features/music_toy_segment_model_1x3.glb",
};
const MALLET_MODEL = "models/features/music_toy_mallet_feature.glb";
// The most notes one level holds is 33, toys 9 and mallets 33
const NOTES = 40;
const TOYS = 12;
const MALLETS = 36;
// Each color's note, 0 to 7, from the original's note mapping by color id
const NOTE_OF_COLOR = [
  2, 2, 7, 0, 1, 3, 5, 4, 2, 1, 7, 6, 0, 0, 3, 0, 1, 5, 4, 1, 4, 7, 7, 5, 3, 3, 6, 4, 0, 2, 6, 6, 5, 7,
];

// Painting (the look's choice): the base's pale lilac, and the nails' share of the note's brightness
const BASE_COLOR = 0xb9a8e8;
const NAIL_SHADE = 0.45;
const FLOOR_SHADE = 0.85;
const FLOOR_TALL = 1.05;
const FLOOR_FIT = 0.97;
// The base model is this wide and deep, and the notes' model this wide, long and tall (model units)
const BASE_WIDE = 5.0;
const BASE_DEEP = 2.96;
const BASE_TALL = 0.5;
const NOTE_WIDE = 0.984;
const NOTE_TALL = 0.506;
// The base spans its notes plus this margin on every side (cells) and stands this many cube heights tall
const BASE_MARGIN = 0.35;
const BASE_HEIGHT = 1.15;
// A note fills this share of its cells, and stands at most this many cube heights above the base
const NOTE_FIT = 0.94;
const NOTE_MAX_TALL = 1.5;
// A hit punches every note: a bump this big (share of its height), starting at the struck note and reaching a neighbor
// this many ticks later, each bump lasting PUNCH_TICKS
const PUNCH = 0.18;
const PUNCH_TICKS = 12;
const WAVE_STEP = 3;
// A broken note rises, spins and shrinks away over this many ticks
const POP_TICKS = 14;
const POP_RISE = 1.2;
// The collapse: the base squashes to this share of its height, then shrinks away, over these many ticks
const COLLAPSE_SQUASH_TICKS = 8;
const COLLAPSE_AWAY_TICKS = 14;
const COLLAPSE_SQUASH = 0.45;

// The mallet next to a cat (a cat's body is 0.86 wide at scale 1): its size, and the share of its length the head's
// middle stands above its foot. Its strike: the lift's rise (world units) and swell, the jump's ticks and arc, the wind
// back and the smash (ticks), how high above the note it hovers and winds back (mallet lengths), the lean at the
// wind-back (radians), the pause after the landing and the shrink away
const MALLET_SIZE = 0.9;
const HEAD_UP = 0.79;
const LIFT_RISE = 1;
const LIFT_SWELL = 0.3;
const JUMP_TICKS = 21;
const JUMP_ARC = 5;
const WIND_TICKS = 6;
const SMASH_TICKS = STRIKE_LANDS - HAMMER_LIFT - JUMP_TICKS - WIND_TICKS;
const HOVER = 0.9;
const WIND_UP = 0.45;
const WIND_LEAN = 0.5;
const SHRINK_TICKS = HAMMER_DONE - STRIKE_LANDS;
// The stick's top and the head's start on the model's own height axis; heights above this are the head
const HEAD_FROM = 0.58;
const STICK_COLOR = new THREE.Color("#c98a4b");

const matrix = new THREE.Matrix4();
const local = new THREE.Matrix4();
const place = new THREE.Vector3();
const size = new THREE.Vector3();
const turn = new THREE.Quaternion();
const spin = new THREE.Euler();
const tint = new THREE.Color();
const STRAIGHT = new THREE.Quaternion();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const QUARTER = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
const popTurn = new THREE.Quaternion();

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

function easeOutQuad(u) {
  return 1 - (1 - u) * (1 - u);
}

function easeInQuad(u) {
  return u * u;
}

function easeInOutQuad(u) {
  return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
}

function easeOutBack(u, overshoot = 3) {
  const v = u - 1;
  return 1 + v * v * ((overshoot + 1) * v + overshoot);
}

// A mesh's geometry in the model's space (its node's place, turn and scale baked in), painted one shade of grey
function painted(node, shade) {
  const geometry = node.geometry.clone();
  geometry.deleteAttribute("uv");
  geometry.applyMatrix4(local.compose(node.position, node.quaternion, node.scale));
  const colors = new Float32Array(geometry.attributes.position.count * 3).fill(shade);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function meshesOf(gltf) {
  const nodes = [];
  gltf.scene.traverse((node) => {
    if (node.isMesh) {
      nodes.push(node);
    }
  });
  return nodes;
}

// One note's geometry: the body white and its two nails darker, so the instance's color tints all and darkens the nails
function noteGeometry(gltf) {
  const [body, ...nails] = meshesOf(gltf);
  return mergeGeometries([painted(body, 1), ...nails.map((nail) => painted(nail, NAIL_SHADE))]);
}

// The base's slab with its foot on the origin
function baseGeometry(gltf) {
  const [node] = meshesOf(gltf);
  const geometry = node.geometry.clone();
  geometry.deleteAttribute("uv");
  geometry.applyMatrix4(local.compose(node.position, node.quaternion, node.scale));
  return geometry;
}

// The mallet turned head-up on a 1-unit-long stick, centered on the head, its head vertices painted white and the
// stick's the stick color (a mallet's own copy is repainted with its head color)
function malletGeometry(gltf) {
  const [node] = meshesOf(gltf);
  const geometry = node.geometry.clone();
  geometry.deleteAttribute("uv");
  const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
  const length = box.max.y - box.min.y;
  const positions = geometry.attributes.position;
  const heads = [];
  for (let i = 0; i < positions.count; i++) {
    heads.push(positions.getY(i) >= HEAD_FROM);
  }
  geometry.translate(0, -box.min.y, 0);
  geometry.scale(1 / length, 1 / length, 1 / length);
  geometry.translate(0, -HEAD_UP, 0);
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3));
  return { geometry, heads };
}

// One mallet's rig: the root stands where it is, `flip` turns the mallet about its head
function malletRig(parts, scene) {
  const geometry = parts.geometry.clone();
  const root = new THREE.Group();
  const flip = new THREE.Group();
  root.add(flip);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
  flip.add(new THREE.Mesh(geometry, material));
  root.visible = false;
  scene.add(root);
  return { root, flip, geometry };
}

// Paint the head of a mallet's rig one color and its stick the stick color
function paintMallet(rig, parts, head) {
  const colors = rig.geometry.attributes.color;
  parts.heads.forEach((isHead, i) => {
    const color = isHead ? head : STICK_COLOR;
    colors.setXYZ(i, color.r, color.g, color.b);
  });
  colors.needsUpdate = true;
}

function instanced(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

class MusicToyLook {
  constructor(parts, scene) {
    this.parts = parts;
    this.toys = [];
    this.notes = [];
    this.mine = null;
    this.now = 0;
    this.cell = 0;
    // Per mallet id: its queue pose this frame (null when it isn't in a queue) and the last one it had there
    this.poses = new Map();
    this.last = new Map();
    this.swung = new Set();
    this.bases = instanced(
      parts.base,
      new THREE.MeshStandardMaterial({ color: BASE_COLOR, roughness: 0.45, metalness: 0 }),
      TOYS,
    );
    // The tray's own floor is lower than the cubes it lies over, so a plate as high as the cubes fills the tray
    this.floors = instanced(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(BASE_COLOR).multiplyScalar(FLOOR_SHADE),
        roughness: 0.5,
      }),
      TOYS,
    );
    const noteMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.05 });
    this.noteMeshes = {
      2: instanced(parts.notes[2], noteMaterial, NOTES),
      3: instanced(parts.notes[3], noteMaterial, NOTES),
    };
    this.meshes = [this.bases, this.floors, this.noteMeshes[2], this.noteMeshes[3]];
    for (const mesh of this.meshes) {
      scene.add(mesh);
    }
    this.mallets = Array.from({ length: MALLETS }, () => malletRig(parts.mallet, scene));
  }

  // A new level: every toy's base and notes laid out in world units, the mallets painted
  build(state) {
    this.clear();
    const mine = state.features[NUMBER];
    if (!mine) {
      return;
    }
    const { grid } = state;
    this.mine = mine;
    this.cell = grid.size / L_PER_UNIT;
    this.now = state.tick;
    const listed = state.level.features.musicToys ? state.level.features.musicToys.MusicToys : [];
    const counts = { 2: 0, 3: 0 };
    mine.toys.slice(0, TOYS).forEach((sim, index) => {
      const toy = this.layout(listed[index], sim, grid, counts);
      toy.base = index;
      toy.sim = sim;
      toy.collapsedAt = state.grid.targets[sim.target].dead ? -Infinity : null;
      this.toys.push(toy);
    });
    this.noteMeshes[2].count = counts[2];
    this.noteMeshes[3].count = counts[3];
    this.bases.count = this.toys.length;
    this.floors.count = this.toys.length;
    mine.colors.slice(0, MALLETS).forEach((color, i) => paintMallet(this.mallets[i], this.parts.mallet, COLORS[color]));
  }

  // One toy: its footprint and each note's place, size and slot in its model's pool
  layout(data, sim, grid, counts) {
    const { cell } = this;
    const area = data.SegmentArea;
    const along = data.Direction === 1;
    const xs = data.GridPoints.map((p) => p.X);
    const ys = data.GridPoints.map((p) => p.Y);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const world = (cx, cy) => [(cx - (grid.width - 1) / 2) * cell, -(cy - (grid.height - 1) / 2) * cell];
    const [mx, mz] = world((minX + maxX) / 2, (minY + maxY) / 2);
    const toy = {
      x: mx,
      z: mz,
      wide: (maxX - minX + 1 + 2 * BASE_MARGIN) * cell,
      deep: (maxY - minY + 1 + 2 * BASE_MARGIN) * cell,
      notes: [],
      waveAt: -Infinity,
      waveFrom: 0,
    };
    const long = Math.max(area.X, area.Y);
    const short = Math.min(area.X, area.Y);
    const kind = Math.round(long / short) >= 3 ? 3 : 2;
    sim.notes.forEach((note, k) => {
      const cx = along ? minX + (area.Y - 1) / 2 : minX + k * area.X + (area.X - 1) / 2;
      const cy = along ? minY + k * area.X + (area.X - 1) / 2 : minY + (area.Y - 1) / 2;
      const [wx, wz] = world(cx, cy);
      const model = this.parts.noteSize[kind];
      const sx = (short * cell * NOTE_FIT) / NOTE_WIDE;
      const sz = (long * cell * NOTE_FIT) / model.long;
      const entry = {
        note,
        kind,
        slot: counts[kind],
        x: wx,
        z: wz,
        sx,
        sz,
        sy: Math.min(sx, (PICTURE_HEIGHT * NOTE_MAX_TALL) / NOTE_TALL),
        along,
        color: COLORS[note.color],
        index: k,
        poppedAt: note.dead ? -Infinity : null,
      };
      if (counts[kind] < NOTES) {
        counts[kind] += 1;
        toy.notes.push(entry);
      }
    });
    return toy;
  }

  clear() {
    this.toys = [];
    this.mine = null;
    this.poses.clear();
    this.last.clear();
    this.swung.clear();
    for (const mesh of this.meshes) {
      mesh.count = 0;
    }
    for (const rig of this.mallets) {
      rig.root.visible = false;
    }
  }

  onEvents(events) {
    for (const event of events) {
      if (event.k === "note_hit") {
        const toy = this.toys[event.toy];
        if (toy) {
          toy.waveAt = event.t;
          toy.waveFrom = event.note;
        }
        sound("hammer_hit");
      } else if (event.k === "note_break") {
        const toy = this.toys[event.toy];
        const entry = toy ? toy.notes[event.note] : null;
        if (entry) {
          sound(`note_${NOTE_OF_COLOR[entry.note.color] + 1}`);
        }
      } else if (event.k === "toy_collapse") {
        sound("toy_collapse");
        const toy = this.toys[event.toy];
        if (toy && toy.collapsedAt === null) {
          toy.collapsedAt = event.t;
        }
      }
    }
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
    if (!this.toys.length) {
      return;
    }
    for (const toy of this.toys) {
      this.drawToy(toy, state);
    }
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  // The base's squash and shrink once the toy has collapsed, as a share of its normal size in height and width
  collapseOf(toy) {
    if (toy.collapsedAt === null) {
      return { tall: 1, wide: 1 };
    }
    const squash = clamp01((this.now - toy.collapsedAt) / COLLAPSE_SQUASH_TICKS);
    const away = clamp01((this.now - toy.collapsedAt - COLLAPSE_SQUASH_TICKS) / COLLAPSE_AWAY_TICKS);
    return { tall: 1 - (1 - COLLAPSE_SQUASH) * easeOutQuad(squash), wide: 1 - easeInQuad(away) };
  }

  drawToy(toy, state) {
    const collapse = this.collapseOf(toy);
    const baseTall = PICTURE_HEIGHT * BASE_HEIGHT;
    const gone = collapse.wide <= 0;
    this.bases.setMatrixAt(
      toy.base,
      gone
        ? HIDDEN
        : matrix.compose(
            place.set(toy.x, 0, toy.z),
            STRAIGHT,
            size.set(
              (toy.wide / BASE_WIDE) * collapse.wide,
              (baseTall / BASE_TALL) * collapse.tall * collapse.wide,
              (toy.deep / BASE_DEEP) * collapse.wide,
            ),
          ),
    );
    this.floors.setMatrixAt(
      toy.base,
      gone
        ? HIDDEN
        : matrix.compose(
            place.set(toy.x, (PICTURE_HEIGHT * FLOOR_TALL * collapse.tall * collapse.wide) / 2, toy.z),
            STRAIGHT,
            size.set(
              toy.wide * FLOOR_FIT * collapse.wide,
              PICTURE_HEIGHT * FLOOR_TALL * collapse.tall * collapse.wide,
              toy.deep * FLOOR_FIT * collapse.wide,
            ),
          ),
    );
    for (const entry of toy.notes) {
      if (entry.note.dead && entry.poppedAt === null) {
        entry.poppedAt = this.now;
      }
      this.drawNote(toy, entry, baseTall, collapse);
    }
  }

  // One note: standing on the base with a bump from the hit wave, or popping away
  drawNote(toy, entry, baseTall, collapse) {
    const pop = entry.poppedAt === null ? 0 : clamp01((this.now - entry.poppedAt) / POP_TICKS);
    const mesh = this.noteMeshes[entry.kind];
    if (pop >= 1 || collapse.wide <= 0) {
      mesh.setMatrixAt(entry.slot, HIDDEN);
      return;
    }
    const wave = clamp01((this.now - toy.waveAt - Math.abs(entry.index - toy.waveFrom) * WAVE_STEP) / PUNCH_TICKS);
    const bump = wave > 0 && wave < 1 ? PUNCH * Math.sin(Math.PI * wave) : 0;
    const shrink = (1 - easeInQuad(pop)) * collapse.wide;
    const rise = POP_RISE * PICTURE_HEIGHT * easeOutQuad(pop);
    turn.copy(entry.along ? QUARTER : STRAIGHT);
    if (pop > 0) {
      turn.multiply(popTurn.setFromEuler(spin.set(0, pop * 5 * (entry.index % 2 ? 1 : -1), 0)));
    }
    place.set(entry.x, baseTall * collapse.tall * collapse.wide + rise, entry.z);
    size.set(entry.sx * shrink, entry.sy * (1 + bump) * shrink * collapse.tall, entry.sz * shrink);
    mesh.setMatrixAt(entry.slot, matrix.compose(place, turn, size));
    mesh.setColorAt(entry.slot, tint.copy(entry.color));
  }

  begin(state) {
    this.mine = state.features[NUMBER] || null;
    this.poses.clear();
  }

  // A mallet's entry is drawn as the mallet: remember where its cat would stand and hide the cat. A used mallet's later
  // poses (an old snapshot while it vanishes) are not its own, so only queue poses are kept for it
  shape(id, pig, pose) {
    if (!this.mine || !this.mine.mallets.includes(id)) {
      return;
    }
    const used = this.mine.used.includes(id);
    if (pose.shown && (!used || pig.place === "queue")) {
      const at = { x: pose.x, y: pose.y + pose.air, z: pose.z, yaw: pose.yaw, scale: pose.scale * pose.sx };
      this.poses.set(id, at);
      if (pig.place === "queue") {
        this.last.set(id, at);
      }
    }
    pose.shown = false;
  }

  end() {
    if (!this.mine) {
      return;
    }
    this.mine.mallets.forEach((id, index) => {
      if (index < MALLETS) {
        this.drawMallet(this.mallets[index], id);
      }
    });
  }

  // One mallet: standing in its place, or on its strike. Returns false when it isn't drawn
  drawMallet(rig, id) {
    const strike = this.mine.strikes.find((entry) => entry[0] === id);
    const pose = this.poses.get(id);
    if (!strike) {
      if (!pose || this.mine.used.includes(id)) {
        rig.root.visible = false;
        return false;
      }
      this.stand(rig, pose);
      return true;
    }
    const from = pose || this.last.get(id);
    const age = this.now - strike[3];
    if (!from || age >= HAMMER_DONE) {
      rig.root.visible = false;
      return false;
    }
    if (age < 0) {
      this.stand(rig, from);
      return true;
    }
    this.strikeMallet(rig, id, from, this.restOf(strike[1], strike[2], from), age);
    return true;
  }

  // Where the head's middle rests on its note: on top of the note, its own radius above
  restOf(toyIndex, noteIndex, from) {
    const toy = this.toys[toyIndex];
    const entry = toy ? toy.notes[noteIndex] : null;
    if (!entry) {
      return { x: from.x, y: from.y, z: from.z };
    }
    const top = PICTURE_HEIGHT * BASE_HEIGHT + NOTE_TALL * entry.sy;
    return { x: entry.x, y: top + 0.25 * MALLET_SIZE * from.scale, z: entry.z };
  }

  // The strike at this age: lift, flipping jump, wind-back, smash, then it rests a moment and shrinks away
  strikeMallet(rig, id, from, rest, age) {
    const unit = MALLET_SIZE * from.scale;
    const lift = easeOutBack(clamp01(age / HAMMER_LIFT));
    const swell = 1 + LIFT_SWELL * lift;
    const startY = from.y + HEAD_UP * unit + LIFT_RISE * lift;
    const jump = clamp01((age - HAMMER_LIFT) / JUMP_TICKS);
    const glide = easeOutQuad(jump);
    const hoverY = rest.y + HOVER * unit * swell;
    const at = {
      x: from.x + (rest.x - from.x) * glide,
      y: startY + (hoverY - startY) * glide + JUMP_ARC * 4 * jump * (1 - jump),
      z: from.z + (rest.z - from.z) * glide,
      yaw: from.yaw,
    };
    const windAge = age - HAMMER_LIFT - JUMP_TICKS;
    const wind = easeInOutQuad(clamp01(windAge / WIND_TICKS));
    const smash = easeInQuad(clamp01((windAge - WIND_TICKS) / SMASH_TICKS));
    let flip = Math.PI * easeInOutQuad(jump);
    if (windAge >= 0) {
      at.y = hoverY + WIND_UP * unit * wind * (1 - smash) - (hoverY - rest.y) * smash;
      flip = Math.PI + WIND_LEAN * wind * (1 - smash);
    }
    if (windAge >= WIND_TICKS && !this.swung.has(id)) {
      this.swung.add(id);
      sound("hammer_swing");
    }
    const after = clamp01((age - STRIKE_LANDS) / SHRINK_TICKS);
    at.y += unit * 0.8 * easeOutQuad(after);
    this.put(rig, at, flip, unit * swell * (1 - easeInQuad(after)));
  }

  // A mallet standing in a queue place: its head's middle HEAD_UP lengths above its foot
  stand(rig, pose) {
    const unit = MALLET_SIZE * pose.scale;
    this.put(rig, { x: pose.x, y: pose.y + HEAD_UP * unit, z: pose.z, yaw: pose.yaw }, 0, unit);
  }

  // Put a mallet with its head's middle at `at`, flipped about it by `flip` radians, `unit` world units long
  put(rig, at, flip, unit) {
    rig.root.visible = unit > 0.001;
    rig.root.position.set(at.x, at.y, at.z);
    rig.root.rotation.set(0, at.yaw, 0);
    rig.root.scale.setScalar(unit);
    rig.flip.rotation.set(0, 0, flip);
  }
}

// Load the models, and add the pools to the scene
export async function create(scene) {
  const loader = new GLTFLoader();
  const [baseGltf, note2, note3, malletGltf] = await Promise.all([
    loader.loadAsync(BASE_MODEL),
    loader.loadAsync(NOTE_MODELS[2]),
    loader.loadAsync(NOTE_MODELS[3]),
    loader.loadAsync(MALLET_MODEL),
  ]);
  const notes = { 2: noteGeometry(note2), 3: noteGeometry(note3) };
  const noteSize = {};
  for (const kind of [2, 3]) {
    const box = new THREE.Box3().setFromBufferAttribute(notes[kind].attributes.position);
    noteSize[kind] = { long: box.max.z - box.min.z };
  }
  return new MusicToyLook({ base: baseGeometry(baseGltf), notes, noteSize, mallet: malletGeometry(malletGltf) }, scene);
}
