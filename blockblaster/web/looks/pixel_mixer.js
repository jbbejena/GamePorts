// Feature 34, the Pixel Mixer: a machine stands over a patch of cubes, with a hose of blocks running away from it, all in
// the color of the cubes that feed it. The machine is the original's `pixel_mixer_feature.glb` (a box with a funnel and a
// joystick on top, painted here: the prefab holds no materials), turned so the side its hose leaves from faces the first
// hose block, and stretched over the body's cells. Each hose block is a slab over its cells; a white tag on the machine
// counts what the standing stage still takes. When a single-cell cube of the mixer's color dies, a copy of the cube leaps
// from where it stood into the funnel over 0.3 s (CUBE_FLY_IN) and the machine swells with a knock. A stage that runs out
// sends the next hose blocks from the tip hopping away, shrinking (their cells are already free for the rules), and the
// last stage lets the machine sink away. Everything comes from the simulation's mixer records
// (sim/features/pixel_mixer.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { PICTURE_HEIGHT } from "../camera.js";
import { COLORS } from "../picture.js";
import { play as sound } from "../sound.js";
import { NUMBER } from "../sim/features/pixel_mixer.js";
import { CUBE_FLY_IN, L_PER_UNIT } from "../sim/numbers.js";

export { NUMBER };

const MODEL = "models/features/pixel_mixer_feature.glb";
// The most mixers one level holds is 7 and the most hose blocks 170
const MIXERS = 8;
const BLOCKS = 256;
// The prefab's box is 1.5 wide and deep and 1.5 tall with its bottom at -0.65; its top decorations stand on it
const BOX_WIDE = 1.5;
const BOX_BOTTOM = -0.65;
const BOX_TOP = 0.85;
// The funnel's mouth in the prefab's own units, where the cube copies leap to
const INTAKE = new THREE.Vector3(-0.3, 1.1, 0.35);
// How tall the machine stands and how tall a hose block does, in cube heights; the decorations never grow past this
// many cube heights
const BODY_TALL = 1.8;
const HOSE_TALL = 1.25;
const DECO_TALL = 5;
// A block's slab is this much of its cells; its lighter top plate is this much of the slab and this much thinner
const BLOCK_FIT = 0.96;
const PLATE_FIT = 0.78;
const PLATE_THICK = 0.06;
// How far toward white a block's plate is lighter than its slab
const PLATE_LIGHT = 0.3;
// Painting: the machine's top is the mixer's color, its sides this much darker; the hose's sides and the plates
const SIDE_SHADE = 0.68;
const STEEL = new THREE.Color(0x4a505c);
const STEEL_LIGHT = new THREE.Color(0xaeb4bf);
// A knock as a cube lands in the funnel: the machine swells this much and settles over this many ticks
const KNOCK = 0.04;
const KNOCK_TICKS = 8;
// A block sent away: it hops this high (in cube heights) while shrinking over this many ticks; blocks of one batch
// start this many ticks after each other
const HOP_TICKS = 16;
const HOP_HIGH = 1.6;
const HOP_STAGGER = 3;
// The machine going away after the last stage: it waits this many ticks, then sinks and shrinks over the next
const DONE_WAIT = 6;
const DONE_TICKS = 22;
// The flying copies: most alive at once, their size against a cell, how high they arc in cube heights, and the share of
// their size they have left when they land
const COPIES = 256;
const COPY_SIZE = 0.9;
const COPY_ARC = 6;
const COPY_END = 0.4;
// The tag: a white pill with dark digits
const LABEL_W = 192;
const LABEL_H = 112;
const LABEL_FONT = '"Inter Black", "Segoe UI", sans-serif';
const LABEL_INK = "#2a2f3a";
const LABEL_SHARE = 0.8;
const LABEL_WIDE = 0.5;
const LABEL_LIFT = 0.02;
// How far the tag sits from the machine's middle toward the hose side, as a share of the machine's width
const LABEL_SHIFT = 0.28;

const matrix = new THREE.Matrix4();
const place = new THREE.Vector3();
const size = new THREE.Vector3();
const STRAIGHT = new THREE.Quaternion();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const scratch = new THREE.Color();

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

// A prefab mesh with its node transform baked in
function bake(gltf, name) {
  gltf.scene.updateMatrixWorld(true);
  const node = gltf.scene.getObjectByName(name);
  return node.geometry.clone().applyMatrix4(node.matrixWorld);
}

// Colors on a geometry: top faces the first color, the rest the second
function paint(geometry, top, side) {
  const normal = geometry.attributes.normal;
  const colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i++) {
    const color = normal.getY(i) > 0.5 ? top : side;
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// One color on a whole geometry
function fill(geometry, color) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

class MixerLook {
  constructor(parts, scene) {
    this.parts = parts;
    this.slots = [];
    this.mixers = [];
    this.now = 0;
    this.copies = [];
    this.copyMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 }),
      COPIES,
    );
    this.copyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.copyMesh.frustumCulled = false;
    this.copyMesh.count = 0;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
    this.slabs = this.instanced(new THREE.BoxGeometry(1, 1, 1), material);
    this.plates = this.instanced(new THREE.BoxGeometry(1, 1, 1), material);
    paint(this.slabs.geometry, new THREE.Color(1, 1, 1), new THREE.Color(SIDE_SHADE, SIDE_SHADE, SIDE_SHADE));
    fill(this.plates.geometry, new THREE.Color(1, 1, 1));
    scene.add(this.copyMesh, this.slabs, this.plates);
    for (let i = 0; i < MIXERS; i++) {
      this.slots.push(this.makeSlot(scene));
    }
  }

  instanced(geometry, material) {
    const mesh = new THREE.InstancedMesh(geometry, material, BLOCKS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  }

  makeSlot(scene) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
    const group = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BufferGeometry(), material);
    const deco = new THREE.Group();
    const decoParts = [0, 1, 2, 3, 4, 5].map(() => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      deco.add(mesh);
      return mesh;
    });
    group.add(box, deco);
    const canvas = document.createElement("canvas");
    canvas.width = LABEL_W;
    canvas.height = LABEL_H;
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(1, LABEL_H / LABEL_W).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }),
    );
    label.renderOrder = 4;
    group.visible = false;
    label.visible = false;
    scene.add(group, label);
    return { group, box, deco, decoParts, canvas, map, label };
  }

  // A new level: every mixer's machine painted and turned toward its hose, every hose block placed
  build(state) {
    this.clear();
    const mine = state.features[NUMBER];
    if (!mine) {
      return;
    }
    const { grid } = state;
    this.cell = grid.size / L_PER_UNIT;
    this.height = Math.min(this.cell, PICTURE_HEIGHT);
    this.grid = grid;
    this.now = state.tick;
    let used = 0;
    mine.mixers.slice(0, MIXERS).forEach((record, index) => {
      used = this.setup(index, record, grid, used);
    });
    this.slabs.count = used;
    this.plates.count = used;
  }

  // World x and z of a cell
  cellX(cell) {
    return ((cell % this.grid.width) - (this.grid.width - 1) / 2) * this.cell;
  }

  cellZ(cell) {
    return -(Math.floor(cell / this.grid.width) - (this.grid.height - 1) / 2) * this.cell;
  }

  // A set of cells as a box: its middle, its width and depth in world units
  footprint(cells) {
    const xs = cells.map((c) => c % this.grid.width);
    const ys = cells.map((c) => Math.floor(c / this.grid.width));
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    return {
      x: ((minX + maxX) / 2 - (this.grid.width - 1) / 2) * this.cell,
      z: -((minY + maxY) / 2 - (this.grid.height - 1) / 2) * this.cell,
      w: (maxX - minX + 1) * this.cell,
      d: (maxY - minY + 1) * this.cell,
    };
  }

  // One mixer: its machine, and its blocks in the shared instance arrays from `first` on. Returns the next free instance
  setup(index, record, grid, first) {
    const color = COLORS[record.color];
    const side = color.clone().multiplyScalar(SIDE_SHADE);
    const slot = this.slots[index];
    const parts = this.parts;
    slot.box.geometry.dispose();
    slot.box.geometry = paint(parts.box.clone(), color, side);
    const paints = [STEEL, color, STEEL, STEEL, STEEL_LIGHT, color];
    parts.deco.forEach((source, i) => {
      slot.decoParts[i].geometry.dispose();
      slot.decoParts[i].geometry = fill(source.clone(), paints[i]);
    });
    const body = this.footprint(record.body);
    const blocks = record.blocks.map((cells) => ({ ...this.footprint(cells), cells }));
    // The hose leaves toward its first block: the machine's -z side turns to it
    const toward = blocks.length
      ? { x: blocks[0].x - body.x, z: blocks[0].z - body.z }
      : { x: 0, z: 1 };
    const length = Math.hypot(toward.x, toward.z) || 1;
    const dir = { x: toward.x / length, z: toward.z / length };
    const wide = Math.max(body.w, body.d);
    const boxTall = this.height * BODY_TALL;
    const decoScale = Math.min((wide / BOX_WIDE) * 0.9, (this.height * DECO_TALL) / 1);
    slot.group.position.set(body.x, 0, body.z);
    slot.group.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
    slot.box.scale.set(body.w / BOX_WIDE, boxTall / (BOX_TOP - BOX_BOTTOM), body.d / BOX_WIDE);
    slot.box.position.set(0, (-BOX_BOTTOM * boxTall) / (BOX_TOP - BOX_BOTTOM), 0);
    slot.deco.scale.setScalar(decoScale);
    slot.deco.position.set(0, boxTall - BOX_TOP * decoScale, 0);
    this.mixers[index] = {
      record,
      slot,
      color,
      body,
      blocks,
      dir,
      wide,
      boxTall,
      first,
      knockAt: -1e9,
      doneAt: null,
      releasedAt: new Map(),
      batchAt: -1,
      batchCount: 0,
      shown: null,
    };
    const plate = color.clone().lerp(new THREE.Color(1, 1, 1), PLATE_LIGHT);
    for (let i = 0; i < blocks.length; i++) {
      this.slabs.setColorAt(first + i, color);
      this.plates.setColorAt(first + i, plate);
    }
    if (blocks.length) {
      this.slabs.instanceColor.needsUpdate = true;
      this.plates.instanceColor.needsUpdate = true;
    }
    return first + blocks.length;
  }

  clear() {
    this.mixers = [];
    this.copies = [];
    this.copyMesh.count = 0;
    this.slabs.count = 0;
    this.plates.count = 0;
    for (const slot of this.slots) {
      slot.group.visible = false;
      slot.label.visible = false;
    }
  }

  onEvents(events) {
    for (const event of events) {
      if (event.k === "mixer_hit") {
        this.hit(event);
      } else if (event.k === "mixer_release") {
        this.release(event);
      } else if (event.k === "mixer_done") {
        this.done(event);
      }
    }
  }

  // A cube of the mixer's color died: its copy leaps from the cell it stood on into the funnel, and the machine knocks
  hit(event) {
    const mixer = this.mixers[event.mixer];
    if (!mixer) {
      return;
    }
    mixer.knockAt = event.t;
    this.copies.push({
      t0: event.t,
      fx: this.cellX(event.cell),
      fz: this.cellZ(event.cell),
      mixer,
      color: mixer.color,
    });
    if (this.copies.length > COPIES) {
      this.copies.shift();
    }
    sound("mixer_hit");
  }

  // A hose block leaves: blocks of one batch start a few ticks apart
  release(event) {
    const mixer = this.mixers[event.mixer];
    if (!mixer) {
      return;
    }
    if (mixer.batchAt !== event.t) {
      mixer.batchAt = event.t;
      mixer.batchCount = 0;
    }
    mixer.releasedAt.set(event.block, event.t + mixer.batchCount * HOP_STAGGER);
    mixer.batchCount += 1;
    sound("mixer_release");
  }

  // The last stage ran out: the machine goes once its blocks are on their way
  done(event) {
    const mixer = this.mixers[event.mixer];
    if (mixer) {
      mixer.doneAt = event.t + mixer.batchCount * HOP_STAGGER + DONE_WAIT;
      sound("mixer_done");
    }
  }

  // The tag's number, redrawn only when it changed
  paintLabel(mixer, count) {
    const { canvas, map } = mixer.slot;
    const g = canvas.getContext("2d");
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
    map.needsUpdate = true;
  }

  // One machine at its place this frame: standing (with a knock), sinking away, or gone
  drawMachine(mixer) {
    const { slot, record } = mixer;
    const age = mixer.doneAt === null ? -1 : this.now - mixer.doneAt;
    const gone = record.spent && (mixer.doneAt === null || age >= DONE_TICKS);
    slot.group.visible = !gone;
    slot.label.visible = !gone && !record.spent;
    if (gone) {
      return;
    }
    let swell = 1;
    let out = 1;
    let sink = 0;
    if (record.spent) {
      const u = clamp01(age / DONE_TICKS);
      sink = u ** 2;
      out = 1 - sink;
    } else {
      const u = clamp01((this.now - mixer.knockAt) / KNOCK_TICKS);
      swell = 1 + KNOCK * Math.sin(Math.PI * u) * (u < 1 ? 1 : 0);
    }
    slot.group.position.y = -sink * mixer.boxTall;
    slot.group.scale.set(swell * out, swell * out, swell * out);
    if (!record.spent) {
      slot.label.position.set(
        mixer.body.x + mixer.dir.x * mixer.wide * LABEL_SHIFT,
        mixer.boxTall + LABEL_LIFT,
        mixer.body.z + mixer.dir.z * mixer.wide * LABEL_SHIFT,
      );
      const wide = Math.min(mixer.wide * LABEL_WIDE, this.cell * 4);
      slot.label.scale.set(wide, 1, wide);
      if (mixer.shown !== record.left) {
        mixer.shown = record.left;
        this.paintLabel(mixer, record.left);
      }
    }
  }

  // Every block of the mixer: standing, hopping away, or gone
  drawBlocks(mixer) {
    const { record } = mixer;
    const tall = this.height * HOSE_TALL;
    mixer.blocks.forEach((block, i) => {
      const at = mixer.first + i;
      const released = i >= record.blocks.length - record.released;
      let scale = 1;
      let lift = 0;
      if (released) {
        const started = mixer.releasedAt.get(i);
        const u = started === undefined ? 1 : clamp01((this.now - started) / HOP_TICKS);
        if (u >= 1) {
          this.slabs.setMatrixAt(at, HIDDEN);
          this.plates.setMatrixAt(at, HIDDEN);
          return;
        }
        scale = 1 - u * u;
        lift = Math.sin(Math.PI * u) * this.height * HOP_HIGH;
      }
      this.slabs.setMatrixAt(
        at,
        matrix.compose(
          place.set(block.x, (tall / 2) * scale + lift, block.z),
          STRAIGHT,
          size.set(block.w * BLOCK_FIT * scale, tall * scale, block.d * BLOCK_FIT * scale),
        ),
      );
      this.plates.setMatrixAt(
        at,
        matrix.compose(
          place.set(block.x, tall * scale + lift + (PLATE_THICK * this.height * scale) / 2, block.z),
          STRAIGHT,
          size.set(block.w * PLATE_FIT * scale, PLATE_THICK * this.height * scale, block.d * PLATE_FIT * scale),
        ),
      );
    });
  }

  // The cube copies in flight: an arc from where the cube stood to the funnel, shrinking as they go
  drawCopies() {
    this.copies = this.copies.filter((copy) => this.now - copy.t0 < CUBE_FLY_IN);
    let count = 0;
    for (const copy of this.copies) {
      const { slot } = copy.mixer;
      slot.deco.updateWorldMatrix(true, false);
      const mouth = INTAKE.clone();
      slot.deco.localToWorld(mouth);
      const u = clamp01((this.now - copy.t0) / CUBE_FLY_IN);
      const lift = this.height * 0.5 + (mouth.y - this.height * 0.5) * u;
      const arc = Math.sin(Math.PI * u) * this.height * COPY_ARC;
      place.set(copy.fx + (mouth.x - copy.fx) * u, lift + arc, copy.fz + (mouth.z - copy.fz) * u);
      const edge = this.cell * COPY_SIZE * (1 - (1 - COPY_END) * u);
      this.copyMesh.setMatrixAt(count, matrix.compose(place, STRAIGHT, size.set(edge, edge * 0.8, edge)));
      scratch.copy(copy.color);
      this.copyMesh.setColorAt(count, scratch);
      count += 1;
    }
    this.copyMesh.count = count;
    this.copyMesh.instanceMatrix.needsUpdate = true;
    if (this.copyMesh.instanceColor) {
      this.copyMesh.instanceColor.needsUpdate = true;
    }
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
    if (!this.mixers.length) {
      return;
    }
    for (const mixer of this.mixers) {
      this.drawMachine(mixer);
      this.drawBlocks(mixer);
    }
    this.slabs.instanceMatrix.needsUpdate = true;
    this.plates.instanceMatrix.needsUpdate = true;
    this.drawCopies();
  }
}

// Load the prefab and add the pools of machines, blocks and copies to the scene
export async function create(scene) {
  const gltf = await new GLTFLoader().loadAsync(MODEL);
  const parts = {
    box: bake(gltf, "Base_Box_0"),
    deco: [
      "Pixel_Target_1",
      "Pixel_Target_Bottom_2",
      "JoystickBase_3",
      "JoystickBaseBottom_4",
      "Joystick_5",
      "JoystickColor_6",
    ].map((name) => bake(gltf, name)),
  };
  return new MixerLook(parts, scene);
}
