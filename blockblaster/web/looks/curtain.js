// Feature 21, Curtains: a curtain is a stack of colored blocks standing over its cubes, each block painted the color of
// the cubes that wear it down, and the bottom block (the active one) carries a white tag with how many more it wants.
// When a single-cell cube of the active color dies, a copy of the cube leaps from where it stood into the block over
// 0.3 s (CUBE_FLY_IN) and the block swells with a knock as it lands. When the block's cells are free for the rules it
// is pulled up: it rolls toward its top edge with a back-ease (CurtainSegmentModel closeEase 26, closeOvershoot 2) while
// the next block takes the tag. Each block is the original's `models/features/curtain_segment_model_7x4.glb` (two end
// posts, a body and a base) stretched over the block's cells. The prefab holds no materials, so the colors, the tag and
// the swell are the look's choice; the health stack and chain of the original's Curtain Health Model are shown as the
// tag's number. Everything comes from the simulation's curtain records (sim/features/curtain.js) and never changes a
// rule.
import * as THREE from "../vendor/three.module.min.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { PICTURE_HEIGHT } from "../camera.js";
import { COLORS } from "../picture.js";
import { play as sound } from "../sound.js";
import { NUMBER } from "../sim/features/curtain.js";
import { CUBE_FLY_IN, L_PER_UNIT } from "../sim/numbers.js";

export { NUMBER };

const MODEL = "models/features/curtain_segment_model_7x4.glb";
// The prefab's body is its third mesh (after the two end posts)
const BODY = 2;
// The most curtains one level holds is 8, and the most blocks one curtain holds is 7
const CURTAINS = 8;
const BLOCKS = 7;
// How thick a block is above the cubes, in cube heights
const BLOCK_TALL = 1.2;
// Painting: the end posts are the block's color lifted toward white, the body is the color, the base is darker
const POST_LIFT = 0.3;
const BASE_DARK = 0.6;
// Blocks that are not the active one are a little dimmer
const WAITING_DIM = 0.72;
// A knock as a cube lands: the active block swells this much and settles over this many ticks
const KNOCK = 0.04;
const KNOCK_TICKS = 8;
// The pull-up: a block rolls toward its top edge and lifts over this many ticks, with a back-ease
const PULL_TICKS = 30;
const PULL_LIFT = 0.6;
const BACK_OVERSHOOT = 1.7;
// The flying copies: most alive at once, their size against a cell, how high they arc in cube heights, and the share
// of their size they have left when they land
const COPIES = 256;
const COPY_SIZE = 0.9;
const COPY_ARC = 6;
const COPY_END = 0.4;
// The tag: a white pill with dark digits, as wide as this share of the block's shorter side
const LABEL_W = 192;
const LABEL_H = 112;
const LABEL_FONT = '"Inter Black", "Segoe UI", sans-serif';
const LABEL_INK = "#4a2810";
const LABEL_SHARE = 0.8;
const LABEL_WIDE = 0.5;
const LABEL_LIFT = 0.02;

const matrix = new THREE.Matrix4();
const place = new THREE.Vector3();
const size = new THREE.Vector3();
const STRAIGHT = new THREE.Quaternion();
const paint = new THREE.Color();

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

// The back-ease in: it pulls back a little before it goes
function backIn(u) {
  return (BACK_OVERSHOOT + 1) * u * u * u - BACK_OVERSHOOT * u * u;
}

// The prefab's four meshes (two end posts, the body, the base) with their node transforms baked in, the whole centered
// over the origin and its body's underside at height 0 (the prefab hangs it above the cubes), and the size of the whole
function piecesOf(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const geometries = [];
  gltf.scene.traverse((node) => {
    if (node.isMesh) {
      geometries.push(node.geometry.clone().applyMatrix4(node.matrixWorld));
    }
  });
  const box = new THREE.Box3();
  for (const geometry of geometries) {
    box.union(new THREE.Box3().setFromBufferAttribute(geometry.attributes.position));
  }
  const middle = box.getCenter(new THREE.Vector3());
  const underside = new THREE.Box3().setFromBufferAttribute(geometries[BODY].attributes.position).min.y;
  for (const geometry of geometries) {
    geometry.translate(-middle.x, -underside, -middle.z);
  }
  return { geometries, width: box.max.x - box.min.x, depth: box.max.z - box.min.z, top: box.max.y - underside };
}

// One piece painted a single color on every vertex
function tint(geometry, color) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

// The colors of a block's four pieces by the segment's color: posts, posts, body, base
function shades(base) {
  const post = base.clone().lerp(paint.set(0xffffff), POST_LIFT);
  const foot = base.clone().multiplyScalar(BASE_DARK);
  return [post, post, base, foot];
}

class CurtainLook {
  constructor(model, scene) {
    this.model = model;
    this.now = 0;
    this.curtains = [];
    this.copies = [];
    this.slots = [];
    this.copyMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 }),
      COPIES,
    );
    this.copyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.copyMesh.frustumCulled = false;
    this.copyMesh.count = 0;
    scene.add(this.copyMesh);
    for (let i = 0; i < CURTAINS; i++) {
      this.slots.push(this.makeSlot(scene));
    }
  }

  // One curtain's pool: a group per block and the tag
  makeSlot(scene) {
    const blocks = [];
    for (let i = 0; i < BLOCKS; i++) {
      const group = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
      const parts = [0, 1, 2, 3].map(() => {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
        group.add(mesh);
        return mesh;
      });
      group.visible = false;
      scene.add(group);
      blocks.push({ group, parts, material });
    }
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
    return { blocks, canvas, map, label };
  }

  // A new level: every curtain's blocks painted and laid over their cells
  build(state) {
    this.clear();
    const mine = state.features[NUMBER];
    if (!mine) {
      return;
    }
    const { grid } = state;
    this.cell = grid.size / L_PER_UNIT;
    this.height = Math.min(this.cell, PICTURE_HEIGHT);
    this.now = state.tick;
    mine.curtains.slice(0, CURTAINS).forEach((record, index) => this.setup(index, record, grid));
  }

  // One curtain: each segment's footprint, the stretch that fits the model over it, and its colors
  setup(index, record, grid) {
    const slot = this.slots[index];
    const blocks = record.segments.slice(0, BLOCKS).map((segment, at) => {
      const block = slot.blocks[at];
      const xs = segment.cells.map((c) => c % grid.width);
      const ys = segment.cells.map((c) => Math.floor(c / grid.width));
      const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
      const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const colors = shades(COLORS[segment.color]);
      this.model.geometries.forEach((source, part) => {
        const geometry = source.clone();
        tint(geometry, colors[part]);
        block.parts[part].geometry.dispose();
        block.parts[part].geometry = geometry;
      });
      return {
        block,
        w,
        h,
        x: ((minX + maxX) / 2 - (grid.width - 1) / 2) * this.cell,
        z: -((minY + maxY) / 2 - (grid.height - 1) / 2) * this.cell,
        sx: (w * this.cell) / this.model.width,
        sz: (h * this.cell) / this.model.depth,
        sy: (this.height * BLOCK_TALL) / this.model.top,
        top: this.height * (1 + BLOCK_TALL),
        freedAt: segment.freed ? -1e9 : null,
        hitAt: -1e9,
      };
    });
    this.curtains[index] = { record, slot, blocks, shown: null, shownAt: -1 };
  }

  clear() {
    this.curtains = [];
    this.copies = [];
    this.copyMesh.count = 0;
    for (const slot of this.slots) {
      slot.label.visible = false;
      for (const block of slot.blocks) {
        block.group.visible = false;
      }
    }
  }

  onEvents(events, state) {
    for (const event of events) {
      if (event.k === "curtain_feed") {
        this.feed(event, state);
      } else if (event.k === "curtain_hit") {
        this.knock(event);
      } else if (event.k === "curtain_free") {
        this.free(event);
      } else if (event.k === "curtain_close") {
        sound("curtain_chain");
      }
    }
  }

  // A cube of the active color died: its copy leaps from the cell it stood on to the middle of the block's top
  feed(event, state) {
    const curtain = this.curtains[event.curtain];
    const target = curtain ? curtain.blocks[event.segment] : null;
    if (!target) {
      return;
    }
    const { grid } = state;
    this.copies.push({
      t0: event.t,
      fx: ((event.cell % grid.width) - (grid.width - 1) / 2) * this.cell,
      fz: -(Math.floor(event.cell / grid.width) - (grid.height - 1) / 2) * this.cell,
      target,
      color: COLORS[event.color],
    });
    if (this.copies.length > COPIES) {
      this.copies.shift();
    }
  }

  knock(event) {
    const curtain = this.curtains[event.curtain];
    if (curtain && curtain.blocks[event.segment]) {
      curtain.blocks[event.segment].hitAt = event.t;
      sound("curtain_hit");
    }
  }

  free(event) {
    const curtain = this.curtains[event.curtain];
    if (curtain && curtain.blocks[event.segment]) {
      curtain.blocks[event.segment].freedAt = event.t;
      sound("curtain_pull");
    }
  }

  // The tag's number, redrawn only when it changed
  paintLabel(slot, count) {
    const g = slot.canvas.getContext("2d");
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
    slot.map.needsUpdate = true;
  }

  // One block this frame: standing, knocked, rolling up, or gone
  drawBlock(block, active) {
    const { group, material } = block.block;
    const pull = block.freedAt === null ? 0 : clamp01((this.now - block.freedAt) / PULL_TICKS);
    group.visible = pull < 1;
    if (pull >= 1) {
      return;
    }
    const u = clamp01((this.now - block.hitAt) / KNOCK_TICKS);
    const swell = 1 + (active && u < 1 ? KNOCK * Math.sin(Math.PI * u) : 0);
    const roll = Math.max(0, 1 - backIn(pull));
    const half = (block.h * this.cell) / 2;
    // The block shrinks toward its top edge, the one the picture's top row is on, and lifts as it goes
    group.position.set(block.x, this.height + pull * block.top * PULL_LIFT, block.z - half * (1 - roll));
    group.scale.set(block.sx * swell, block.sy * swell, block.sz * roll * swell);
    material.color.setScalar(active ? 1 : WAITING_DIM);
  }

  // The tag on the active block's top, with the number it shows
  drawTag(curtain, state) {
    const { record, slot } = curtain;
    const body = state.grid.targets[record.target];
    const at = record.active;
    const target = at >= 0 ? curtain.blocks[at] : null;
    const shown = target && !body.dead && target.freedAt === null;
    slot.label.visible = Boolean(shown);
    if (!shown) {
      return;
    }
    const wide = Math.min(target.w, target.h) * this.cell * LABEL_WIDE;
    slot.label.scale.set(wide, wide, 1);
    slot.label.position.set(target.x, target.top + LABEL_LIFT, target.z);
    const left = record.segments[at].left;
    if (curtain.shown !== left || curtain.shownAt !== at) {
      curtain.shown = left;
      curtain.shownAt = at;
      this.paintLabel(slot, left);
    }
  }

  // The cube copies in flight: an arc from where the cube stood to the block's top, shrinking as they go
  drawCopies() {
    this.copies = this.copies.filter((copy) => this.now - copy.t0 < CUBE_FLY_IN);
    let count = 0;
    for (const copy of this.copies) {
      const u = clamp01((this.now - copy.t0) / CUBE_FLY_IN);
      const lift = this.height * 0.5 + (copy.target.top - this.height * 0.5) * u;
      const arc = Math.sin(Math.PI * u) * this.height * COPY_ARC;
      place.set(copy.fx + (copy.target.x - copy.fx) * u, lift + arc, copy.fz + (copy.target.z - copy.fz) * u);
      const edge = this.cell * COPY_SIZE * (1 - (1 - COPY_END) * u);
      this.copyMesh.setMatrixAt(count, matrix.compose(place, STRAIGHT, size.set(edge, edge * 0.8, edge)));
      this.copyMesh.setColorAt(count, copy.color);
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
    if (!this.curtains.length) {
      return;
    }
    for (const curtain of this.curtains) {
      curtain.blocks.forEach((block, at) => this.drawBlock(block, at === curtain.record.active));
      this.drawTag(curtain, state);
    }
    this.drawCopies();
  }
}

// Load the segment prefab and add the pool of curtains to the scene
export async function create(scene) {
  const gltf = await new GLTFLoader().loadAsync(MODEL);
  return new CurtainLook(piecesOf(gltf), scene);
}
