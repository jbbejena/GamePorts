// Feature 23, the Dragon: a head, body pieces and a tail laid end to end along its path, each piece painted the color
// of the segment it belongs to. The tail rests in the nest (a dark patch under the nest square), where the body rises
// out of the board, and the head sits at the far end of the last living segment, facing away from the nest. After
// every hit the simulation lays the segments out again; each segment's drawn stretch slides to its new place over
// 0.3 s (the original tweens every segment's clip range with OutBack, MultiSnakeFeature clipPercentDuration 0.3 and
// clipPercentEase 27), so the dragon shrinks toward the nest. A hit segment swells for 0.08 s (MultiSnakeSegmentInstance
// hitPunchScale 0.16), the head for 0.15 s when its own segment is hit (headPunchScale 0.16), and a dead segment is
// gone at once while the rest close up. The pieces are `models/dragon_head.glb`, `dragon_body.glb` and
// `dragon_tail.glb` (ASSETS.md), placed about 0.6 apart. The drawing reads the simulation's dragons
// (sim/features/dragon.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { mergeGeometries } from "../vendor/BufferGeometryUtils.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { COLORS } from "../picture.js";
import * as dragonSim from "../sim/features/dragon.js";
import { L_PER_UNIT } from "../sim/numbers.js";
import * as spline from "../sim/spline.js";
import { play as sound } from "../sound.js";

export const NUMBER = dragonSim.NUMBER;

const MODELS = ["models/dragon_head.glb", "models/dragon_body.glb", "models/dragon_tail.glb"];
const NEST = "art/effects/Shadow_2x2_Circle.png";
const DRAGONS = 4;
const BODIES = 768;

// The stretches' tween after a hit (0.3 s, OutBack)
const SHIFT_TICKS = 18;
const BACK = 1.70158;
// Hit swells: a segment's (0.08 s) and the head's (0.15 s), both 0.16 bigger at the peak
const PUNCH = 0.16;
const SEGMENT_PUNCH_TICKS = 5;
const HEAD_PUNCH_TICKS = 9;
// The pieces' spacing in model units, the body's width as a share of the nest's side, and how much flatter than round
// it stands
const SPACING = 0.6;
const WIDTH = 0.75;
const FLAT = 0.8;
// The nest patch's size against the nest square, and how dark it is
const NEST_SIZE = 1.25;
const NEST_OPACITY = 0.45;
// The share of the path a heading is measured over
const STEP = 0.002;

const matrix = new THREE.Matrix4();
const place = new THREE.Vector3();
const size = new THREE.Vector3();
const turn = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

function outBack(u) {
  const v = u - 1;
  return 1 + (BACK + 1) * v * v * v + BACK * v * v;
}

// Up and back down over a punch's ticks
function swell(now, t0, ticks) {
  const u = (now - t0) / ticks;
  return u >= 0 && u < 1 ? 1 + PUNCH * Math.sin(Math.PI * u) : 1;
}

// Every vertex of a fixed-color part carries its material's color, so all of them share one batch
function paint(geometry, color) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    color.toArray(colors, v * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

// A model's meshes in the file's own space: the `Tint_*` parts merged into one geometry, the rest into another
function parts(gltf) {
  const tint = [];
  const marks = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((node) => {
    if (!node.isMesh) {
      return;
    }
    const geometry = node.geometry.clone().toNonIndexed();
    geometry.applyMatrix4(node.matrixWorld);
    geometry.deleteAttribute("uv");
    if (node.name.startsWith("Tint_")) {
      tint.push(geometry);
    } else {
      paint(geometry, node.material.color);
      marks.push(geometry);
    }
  });
  const merged = { tint: mergeGeometries(tint), marks: marks.length ? mergeGeometries(marks) : null };
  merged.tint.computeBoundingBox();
  return merged;
}

function instanced(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

class DragonLook {
  constructor(models, nestMap, scene) {
    this.now = 0;
    this.dragons = [];
    const capacities = [DRAGONS, BODIES, DRAGONS];
    // One batch pair per piece kind: head, body, tail
    this.kinds = models.map((model, i) => {
      const tint = instanced(model.tint, new THREE.MeshStandardMaterial({ roughness: 0.45 }), capacities[i]);
      tint.setColorAt(0, new THREE.Color(0xffffff));
      scene.add(tint);
      let marks = null;
      if (model.marks) {
        const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 });
        marks = instanced(model.marks, material, capacities[i]);
        scene.add(marks);
      }
      // The models are centered; this lifts a piece so its bottom rests on the ground
      return { tint, marks, lift: -model.tint.boundingBox.min.y, used: 0 };
    });
    const nestMaterial = new THREE.MeshBasicMaterial({
      map: nestMap,
      color: 0x000000,
      transparent: true,
      opacity: NEST_OPACITY,
      depthWrite: false,
    });
    this.nests = [];
    for (let i = 0; i < DRAGONS; i++) {
      const nest = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), nestMaterial);
      nest.rotation.x = -Math.PI / 2;
      nest.visible = false;
      scene.add(nest);
      this.nests.push(nest);
    }
  }

  // A new level: every dragon's path laid out and drawn at its simulation's healths
  build(state) {
    this.clear();
    const mine = state.features[NUMBER];
    if (!mine) {
      return;
    }
    const { grid } = state;
    const cell = grid.size / L_PER_UNIT;
    const listed = state.level.features.multiSnakes.MultiSnakes;
    mine.dragons.slice(0, DRAGONS).forEach((dragon, index) => {
      const record = this.layout(grid, cell, dragon, listed[index], index);
      this.dragons.push(record);
      this.settle(record, state);
    });
    this.now = state.tick;
    this.write();
  }

  // One dragon's fixed numbers: its path, how long it is, how big its pieces are and where its nest is
  layout(grid, cell, dragon, data, index) {
    const squares = dragonSim.squaresOf(data);
    const path = dragonSim.pathFor(dragon);
    let length = 0;
    for (let i = 1; i < path.samples.length; i++) {
      length += spline.distance(path.samples[i - 1], path.samples[i]);
    }
    const side = Math.sqrt(squares[0].length);
    const scale = (WIDTH * side * cell) / (this.kinds[1].tint.geometry.boundingBox.max.x * 2);
    const nest = spline.center(squares[0]);
    const record = {
      dragon,
      index,
      path,
      length,
      scale,
      // The piece spacing as a share of the path
      step: (SPACING * scale) / cell / length,
      worldX: (x) => (x - (grid.width - 1) / 2) * cell,
      worldZ: (y) => -(y - (grid.height - 1) / 2) * cell,
      healths: [],
      from: [],
      to: [],
      shown: [],
      t0: -Infinity,
      punches: [],
      headPunch: -Infinity,
    };
    const patch = this.nests[index];
    patch.position.set(record.worldX(nest[0]), 0.002, record.worldZ(nest[1]));
    patch.scale.set(side * cell * NEST_SIZE, side * cell * NEST_SIZE, 1);
    return record;
  }

  // The stretches the simulation's healths give, null for dead segments
  laid(record, state) {
    const healths = record.dragon.segments.map((segment) => state.grid.targets[segment.target].health);
    return { healths, stretches: dragonSim.stretches(record.path, record.dragon.segments, healths) };
  }

  // Take the simulation's healths as they are, with no tween
  settle(record, state) {
    const { healths, stretches } = this.laid(record, state);
    record.healths = healths;
    record.to = stretches;
    record.from = stretches;
    record.shown = stretches;
    record.t0 = -Infinity;
    record.punches = healths.map(() => -Infinity);
    record.colors = record.dragon.segments.map((segment) => COLORS[state.grid.targets[segment.target].color]);
  }

  clear() {
    this.dragons = [];
    for (const kind of this.kinds) {
      kind.tint.count = 0;
      if (kind.marks) {
        kind.marks.count = 0;
      }
    }
    for (const nest of this.nests) {
      nest.visible = false;
    }
  }

  onEvents(events) {
    for (const event of events) {
      if (event.k === "dragon_move") {
        sound("dragon_pull");
      } else if (event.k === "target_died" && event.owner === NUMBER) {
        sound("dragon_gone");
      } else if (event.k === "hit") {
        this.punch(event.target, event.health);
      }
    }
  }

  // A hit on a living segment swells it, and the head with it when the head's segment is hit
  punch(target, health) {
    for (const record of this.dragons) {
      const index = record.dragon.segments.findIndex((segment) => segment.target === target);
      if (index < 0 || health <= 0) {
        continue;
      }
      record.punches[index] = this.now;
      if (index === this.lastAlive(record)) {
        record.headPunch = this.now;
      }
    }
  }

  lastAlive(record) {
    for (let i = record.to.length - 1; i >= 0; i--) {
      if (record.to[i]) {
        return i;
      }
    }
    return -1;
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
    if (!this.dragons.length) {
      return;
    }
    let moving = false;
    for (const record of this.dragons) {
      const healths = record.dragon.segments.map((segment) => state.grid.targets[segment.target].health);
      if (healths.some((health, i) => health !== record.healths[i])) {
        // A hit (or a rebuilt simulation): slide every living stretch from where it is drawn to its new place
        const { stretches } = this.laid(record, state);
        record.healths = healths;
        record.from = record.shown;
        record.to = stretches;
        record.t0 = this.now;
      }
      const u = outBack(clamp01((this.now - record.t0) / SHIFT_TICKS));
      record.shown = record.to.map((to, i) => {
        const from = record.from[i];
        if (!to || !from) {
          return to;
        }
        return [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u];
      });
      // One more drawing after a slide or swell ends puts every piece exactly in place
      const punching = record.punches.some((t0) => this.now - t0 <= HEAD_PUNCH_TICKS + 1);
      moving = moving || punching || this.now - record.t0 <= SHIFT_TICKS + 1;
    }
    if (moving) {
      this.write();
    }
  }

  // A point and the outward heading (away from the nest) t of the way along the path, in world units
  pose(record, t) {
    const [x, y] = dragonSim.position(record.path, clamp01(t));
    const [ax, ay] = dragonSim.position(record.path, clamp01(t - STEP));
    const [bx, by] = dragonSim.position(record.path, clamp01(t + STEP));
    place.set(record.worldX(x), 0, record.worldZ(y));
    // Picture y runs up the screen, world z down it
    return Math.atan2(bx - ax, -(by - ay));
  }

  write() {
    for (const kind of this.kinds) {
      kind.used = 0;
    }
    for (const record of this.dragons) {
      this.writeDragon(record);
    }
    for (const kind of this.kinds) {
      kind.tint.count = kind.used;
      kind.tint.instanceMatrix.needsUpdate = true;
      if (kind.tint.instanceColor) {
        kind.tint.instanceColor.needsUpdate = true;
      }
      if (kind.marks) {
        kind.marks.count = kind.used;
        kind.marks.instanceMatrix.needsUpdate = true;
      }
    }
  }

  // The segment drawn at t: the living one whose stretch holds it, else the last living one before it
  segmentAt(record, t) {
    let found = -1;
    record.shown.forEach((stretch, i) => {
      if (stretch && (found < 0 || stretch[0] <= t)) {
        found = i;
      }
    });
    return found;
  }

  // Head at the last living segment's end, body pieces at fixed steps behind it while they are above the board, tail
  // where the body comes out of the nest
  writeDragon(record) {
    const head = this.lastAlive(record);
    this.nests[record.index].visible = head >= 0;
    if (head < 0) {
      return;
    }
    const pad = record.path.pad;
    const end = record.shown[head][1];
    this.piece(0, record, end, head, swell(this.now, record.headPunch, HEAD_PUNCH_TICKS));
    for (let t = end - record.step; t > pad + record.step * 0.5; t -= record.step) {
      const index = this.segmentAt(record, t);
      this.piece(1, record, t, index, swell(this.now, record.punches[index], SEGMENT_PUNCH_TICKS));
    }
    this.piece(2, record, Math.min(pad, end), this.segmentAt(record, pad), 1);
  }

  piece(kindIndex, record, t, segment, grow) {
    const kind = this.kinds[kindIndex];
    if (kind.used >= kind.tint.instanceMatrix.count) {
      return;
    }
    const yaw = this.pose(record, t);
    const scale = record.scale * grow;
    place.y = kind.lift * scale * FLAT;
    matrix.compose(place, turn.setFromAxisAngle(UP, yaw), size.set(scale, scale * FLAT, scale));
    kind.tint.setMatrixAt(kind.used, matrix);
    kind.tint.setColorAt(kind.used, record.colors[Math.max(0, segment)]);
    if (kind.marks) {
      kind.marks.setMatrixAt(kind.used, matrix);
    }
    kind.used += 1;
  }
}

async function loadModel(url) {
  return parts(await new GLTFLoader().loadAsync(url));
}

// Load the three pieces and the nest patch, and add their pools to the scene
export async function create(scene) {
  const [models, nestMap] = await Promise.all([
    Promise.all(MODELS.map(loadModel)),
    new THREE.TextureLoader().loadAsync(NEST),
  ]);
  return new DragonLook(models, nestMap, scene);
}
