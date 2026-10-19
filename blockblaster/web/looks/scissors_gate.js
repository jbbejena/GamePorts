// Feature 28, the Scissors Gate: a plate of the gate's color lies over its strip of cubes with a lid at each end,
// scissor lattices along both long edges and a gear in the middle that turns as cubes of its color are destroyed (the
// prefab's centre base and spinning gear, `models/features/accordion_feature.glb`, which has no materials, so the
// paint is the look's own). A destroyed cube of the gate's color sends a copy of itself leaping to the gear (the same
// CUBE_FLY_IN ticks the simulation waits). Each shrink folds the gate 2 cells shorter over a few ticks, both lids
// sliding in and the scissors closing up as their arms steepen, with the accordion's closing sound
// (AccordionFeature$$ShrinkOnce, RVA 0x555E1E4); a gate that is doomed or gone folds away to nothing. The count on
// the gear is how many more cubes the next fold needs. The lattice and the fold are the look's own. Everything comes
// from the simulation's gate records (sim/features/scissors_gate.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { PICTURE_HEIGHT } from "../camera.js";
import { COLORS } from "../picture.js";
import { play as sound } from "../sound.js";
import { NUMBER } from "../sim/features/scissors_gate.js";
import { CUBE_FLY_IN, L_PER_UNIT } from "../sim/numbers.js";

export { NUMBER };

const MODEL = "models/features/accordion_feature.glb";
// The most gates one level holds is 6
const GATES = 8;
// The lattice's bars (two per scissor, two rails per gate, the most scissors in a rail being about 24) and the copies
const BARS = 800;
const COPIES = 160;
// The plate hides the cubes under it, so it stands this many cube heights; a lid is this much taller and this many
// cells deep
const PLATE_TALL = 1.2;
const LID_TALL = 1.5;
const LID_DEEP = 0.7;
// The plate fills this share of its cells' width, and the rails run this far in from its long edges (cells)
const PLATE_FIT = 0.98;
const RAIL_INSET = 0.25;
const RAIL_BAND = 1.1;
// A scissor is about this many cells long along a rail at full length, and its bars are this thick (cells) and this many
// cube heights tall
const SCISSOR_LENGTH = 1.9;
const BAR_THICK = 0.14;
const BAR_TALL = 0.35;
// The fold: how long a step takes in ticks
const FOLD_TICKS = 15;
// The gear: its diameter against the gate's thickness, and how far it turns for a full step
const GEAR_FIT = 0.74;
const GEAR_TURNS = 1;
// The count's pill on the gear
const LABEL_W = 128;
const LABEL_H = 80;
const LABEL_FONT = '"Inter Black", "Segoe UI", sans-serif';
const LABEL_INK = "#3a2a60";
const LABEL_SHARE = 0.8;
const LABEL_WIDE = 0.6;
const LABEL_LIFT = 0.015;
// The copies: their size against a cell, how high they arc in cube heights, and the share of their size left on landing
const COPY_SIZE = 0.9;
const COPY_ARC = 6;
const COPY_END = 0.4;
// Painting
const LID_SHADE = 0.62;
const BAR_LIFT = 0.55;
const GEAR_BASE = 0x5d6aa3;
const GEAR_TOP = 0xf4efe2;

const matrix = new THREE.Matrix4();
const gateFrame = new THREE.Matrix4();
const up = new THREE.Vector3(0, 1, 0);
const local = new THREE.Matrix4();
const place = new THREE.Vector3();
const size = new THREE.Vector3();
const turn = new THREE.Quaternion();
const tilt = new THREE.Euler();
const color = new THREE.Color();
const white = new THREE.Color(0xffffff);
const STRAIGHT = new THREE.Quaternion();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

function easeInOutQuad(u) {
  return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
}

// A mesh of the prefab with its node's place, turn and scale baked in, set with its foot on the origin and its middle
// over it, and the size it came to
function gearPart(node) {
  const geometry = node.geometry.clone();
  geometry.deleteAttribute("uv");
  geometry.applyMatrix4(local.compose(node.position, node.quaternion, node.scale));
  const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  return { geometry, wide: box.max.x - box.min.x, tall: box.max.y - box.min.y };
}

function meshesOf(gltf) {
  const nodes = [];
  gltf.scene.traverse((node) => {
    if (node.name === "AccordionCenterBase_3" || node.name === "Model_Spin_4") {
      nodes.push(node);
    }
  });
  return nodes;
}

function instanced(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

class ScissorsGateLook {
  constructor(gear, scene) {
    this.gear = gear;
    this.gates = [];
    this.copies = [];
    this.now = 0;
    this.cell = 0;
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.plates = instanced(box, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.05 }), GATES);
    this.lids = instanced(box, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 }), GATES * 2);
    this.bars = instanced(box, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.2 }), BARS);
    this.cubes = instanced(box, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 }), COPIES);
    this.meshes = [this.plates, this.lids, this.bars, this.cubes];
    for (const mesh of this.meshes) {
      scene.add(mesh);
    }
    this.bases = instanced(
      gear.base.geometry,
      new THREE.MeshStandardMaterial({ color: GEAR_BASE, roughness: 0.4 }),
      GATES,
    );
    this.tops = instanced(
      gear.top.geometry,
      new THREE.MeshStandardMaterial({ color: GEAR_TOP, roughness: 0.35 }),
      GATES,
    );
    scene.add(this.bases);
    scene.add(this.tops);
    this.meshes.push(this.bases, this.tops);
    this.labels = Array.from({ length: GATES }, () => this.makeLabel(scene));
  }

  makeLabel(scene) {
    const canvas = document.createElement("canvas");
    canvas.width = LABEL_W;
    canvas.height = LABEL_H;
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(1, LABEL_H / LABEL_W),
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }),
    );
    label.rotation.x = -Math.PI / 2;
    label.renderOrder = 4;
    label.visible = false;
    scene.add(label);
    return { canvas, map, label, shown: null };
  }

  // A new level: every gate's frame (where it lies and which way), its size and its colors
  build(state) {
    this.clear();
    const mine = state.features[NUMBER];
    if (!mine) {
      return;
    }
    const { grid } = state;
    this.cell = grid.size / L_PER_UNIT;
    this.now = state.tick;
    const listed = state.level.features.accordions.Accordions;
    mine.gates.slice(0, GATES).forEach((sim, index) => {
      const data = listed[index];
      const xs = data.GridPoints.map((p) => p.X);
      const ys = data.GridPoints.map((p) => p.Y);
      const center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
      const along = data.Orientation === 1;
      const scissors = Math.max(2, Math.round((data.BaseDimensions.y * this.cell) / (SCISSOR_LENGTH * this.cell)));
      const vis = this.targetOf(sim, state);
      this.gates.push({
        sim,
        body: state.grid.targets[sim.target],
        index,
        x: (center[0] - (grid.width - 1) / 2) * this.cell,
        z: -(center[1] - (grid.height - 1) / 2) * this.cell,
        along,
        thick: data.BaseDimensions.x,
        scissors,
        color: COLORS[sim.color],
        from: vis,
        to: vis,
        foldAt: -Infinity,
        spin: 0,
      });
    });
  }

  // The length a gate is folding toward: its length, or nothing once it is doomed or gone
  targetOf(sim, state) {
    return sim.doomed || state.grid.targets[sim.target].dead ? 0 : sim.length;
  }

  clear() {
    this.gates = [];
    this.copies = [];
    for (const mesh of this.meshes) {
      mesh.count = 0;
    }
    for (const entry of this.labels) {
      entry.label.visible = false;
      entry.shown = null;
    }
  }

  onEvents(events, state) {
    for (const event of events) {
      if (event.k === "gate_feed") {
        this.feed(event, state);
      } else if (
        event.k === "gate_shrink" ||
        event.k === "gate_leave" ||
        (event.k === "gate_cells" && event.cells === 0)
      ) {
        sound("gate_close");
      }
    }
  }

  // A cube of the gate's color died: its copy leaps from the cell it stood on to the gear
  feed(event, state) {
    const gate = this.gates[event.gate];
    if (!gate) {
      return;
    }
    const { grid } = state;
    this.copies.push({
      t0: event.t,
      fx: ((event.cell % grid.width) - (grid.width - 1) / 2) * this.cell,
      fz: -(Math.floor(event.cell / grid.width) - (grid.height - 1) / 2) * this.cell,
      gate,
      color: COLORS[event.color],
    });
    if (this.copies.length > COPIES) {
      this.copies.shift();
    }
  }

  // The count's pill, redrawn only when the number changed
  paintLabel(entry, count) {
    const g = entry.canvas.getContext("2d");
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
    entry.map.needsUpdate = true;
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
    if (!this.gates.length) {
      return;
    }
    const counts = { lid: 0, bar: 0 };
    this.gates.forEach((gate) => this.drawGate(gate, state, counts));
    this.plates.count = this.gates.length;
    this.bases.count = this.gates.length;
    this.tops.count = this.gates.length;
    this.lids.count = counts.lid;
    this.bars.count = counts.bar;
    this.drawCopies();
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  // The gate's folded length now, in cells, easing from where the last fold started
  visibleLength(gate, state) {
    const target = this.targetOf(gate.sim, state);
    if (target !== gate.to) {
      gate.from = gate.from + (gate.to - gate.from) * easeInOutQuad(clamp01((this.now - gate.foldAt) / FOLD_TICKS));
      gate.to = target;
      gate.foldAt = this.now;
    }
    return gate.from + (gate.to - gate.from) * easeInOutQuad(clamp01((this.now - gate.foldAt) / FOLD_TICKS));
  }

  // One gate's pieces in its own frame (u along its length, v across, y up), turned into the world
  drawGate(gate, state, counts) {
    const length = this.visibleLength(gate, state);
    const gone = length <= 0.02;
    const { cell } = this;
    const wide = gate.thick * cell * PLATE_FIT;
    const long = length * cell;
    const tall = PICTURE_HEIGHT * PLATE_TALL;
    gateFrame.compose(
      place.set(gate.x, 0, gate.z),
      turn.setFromAxisAngle(up, gate.along ? Math.PI / 2 : 0),
      size.set(1, 1, 1),
    );
    const put = (mesh, slot, at, scale, rotation = STRAIGHT) => {
      local.compose(place.set(at[0], at[1], at[2]), rotation, size.set(scale[0], scale[1], scale[2]));
      mesh.setMatrixAt(slot, gone ? HIDDEN : matrix.multiplyMatrices(gateFrame, local));
    };
    put(this.plates, gate.index, [0, tall / 2, 0], [long, tall, wide]);
    this.plates.setColorAt(gate.index, gate.color);
    const deep = LID_DEEP * cell;
    for (const side of [-1, 1]) {
      put(
        this.lids,
        counts.lid,
        [side * (long / 2 + deep / 2), (tall * LID_TALL) / 2, 0],
        [deep, tall * LID_TALL, wide * 1.04],
      );
      this.lids.setColorAt(counts.lid, color.copy(gate.color).multiplyScalar(LID_SHADE));
      counts.lid += 1;
    }
    this.drawRails(gate, long, wide, tall, counts, put);
    this.drawGear(gate, wide, tall, gone);
  }

  // The scissor lattices along both long edges: each scissor is two bars crossing, whose slope follows how folded it is
  drawRails(gate, long, wide, tall, counts, put) {
    const { cell } = this;
    const span = long / gate.scissors;
    const band = cell * RAIL_BAND;
    const slope = Math.atan2(band, Math.max(span, 1e-4));
    const barLength = Math.hypot(span, band);
    const railY = tall + (PICTURE_HEIGHT * BAR_TALL) / 2;
    color.copy(gate.color).lerp(white, BAR_LIFT);
    for (const rail of [-1, 1]) {
      for (let k = 0; k < gate.scissors && counts.bar + 2 <= BARS; k++) {
        for (const sign of [-1, 1]) {
          turn.setFromEuler(tilt.set(0, sign * slope, 0));
          const at = [-long / 2 + span * (k + 0.5), railY, rail * (wide / 2 - RAIL_INSET * cell - band / 2)];
          put(this.bars, counts.bar, at, [barLength, PICTURE_HEIGHT * BAR_TALL, BAR_THICK * cell], turn);
          this.bars.setColorAt(counts.bar, color);
          counts.bar += 1;
        }
      }
    }
  }

  // The gear in the middle: its base and its spinning top, turned by how far into the step the gate is, and the count
  drawGear(gate, wide, tall, gone) {
    const { sim } = gate;
    const step = sim.hp + (sim.length === 2 ? sim.bonus : 0);
    const done = (sim.base - sim.length) / 2 + (step - sim.left) / step;
    gate.spin += (done * GEAR_TURNS * 2 * Math.PI - gate.spin) * 0.25;
    const diameter = Math.min(wide, gate.thick * this.cell) * GEAR_FIT;
    const scale = diameter / this.gear.base.wide;
    const baseTall = this.gear.base.tall * scale;
    this.bases.setMatrixAt(
      gate.index,
      gone ? HIDDEN : matrix.compose(place.set(gate.x, tall, gate.z), STRAIGHT, size.set(scale, scale, scale)),
    );
    turn.setFromAxisAngle(up, gate.spin);
    this.tops.setMatrixAt(
      gate.index,
      gone ? HIDDEN : matrix.compose(place.set(gate.x, tall + baseTall, gate.z), turn, size.set(scale, scale, scale)),
    );
    const entry = this.labels[gate.index];
    entry.label.visible = !gone && !sim.doomed;
    if (!entry.label.visible) {
      return;
    }
    const pill = diameter * LABEL_WIDE * 1.4;
    entry.label.scale.set(pill, pill, 1);
    entry.label.position.set(gate.x, tall + baseTall + this.gear.top.tall * scale + LABEL_LIFT, gate.z);
    if (entry.shown !== sim.left) {
      entry.shown = sim.left;
      this.paintLabel(entry, sim.left);
    }
  }

  // The cube copies in flight: an arc from where the cube stood to the gear, shrinking as they go
  drawCopies() {
    this.copies = this.copies.filter((copy) => this.now - copy.t0 < CUBE_FLY_IN);
    let count = 0;
    for (const copy of this.copies) {
      const u = clamp01((this.now - copy.t0) / CUBE_FLY_IN);
      const lift = PICTURE_HEIGHT * 0.5 + (PICTURE_HEIGHT * (PLATE_TALL + 1) - PICTURE_HEIGHT * 0.5) * u;
      const arc = Math.sin(Math.PI * u) * PICTURE_HEIGHT * COPY_ARC;
      place.set(copy.fx + (copy.gate.x - copy.fx) * u, lift + arc, copy.fz + (copy.gate.z - copy.fz) * u);
      const edge = this.cell * COPY_SIZE * (1 - (1 - COPY_END) * u);
      this.cubes.setMatrixAt(count, matrix.compose(place, STRAIGHT, size.set(edge, edge * 0.8, edge)));
      this.cubes.setColorAt(count, copy.color);
      count += 1;
    }
    this.cubes.count = count;
  }
}

// Load the gear and add the pools to the scene
export async function create(scene) {
  const gltf = await new GLTFLoader().loadAsync(MODEL);
  const [base, top] = meshesOf(gltf);
  return new ScissorsGateLook({ base: gearPart(base), top: gearPart(top) }, scene);
}
