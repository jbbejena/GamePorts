// Feature 24, Jelly Beans: a pale candy box lies over the box's cells, filled with jelly beans painted the colors of its
// groups (`models/features/bean_box_model_square.glb` for the box and `bean_model.glb` for each bean; neither prefab has
// materials, so the paint is the look's own). BeanCount beans of the size BeanScale says are shared among the groups by
// their health, the largest remainders taking the leftovers (BeanBoxModel$$DistributeBeansToGroups, RVA 0x5599A64), and
// sit in the box in a jittered grid, two or three layers when the count is high. A group's beans pop one by one as its
// health falls, the last as the group dies (BeanBoxModel$$Kill, RVA 0x559EB34): a popping bean jumps, spins and shrinks
// away, and when the box has no beans it shrinks away too. A hit rings `bean_hit_thock` (the box model's hit sound) and
// each popped bean `beans6` (the bean model's). Where the beans sit, the order they pop in and the pop's shape are the
// look's own. Everything comes from the simulation's boxes (sim/features/jelly_beans.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { mergeGeometries } from "../vendor/BufferGeometryUtils.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { COLORS } from "../picture.js";
import { NUMBER } from "../sim/features/jelly_beans.js";
import { L_PER_UNIT } from "../sim/numbers.js";
import { play as sound } from "../sound.js";

export { NUMBER };

const BOX_MODEL = "models/features/bean_box_model_square.glb";
const BEAN_MODEL = "models/features/bean_model.glb";
// The most boxes one level holds is 14 (level 1251) and the most beans 213; the pools hold a little more
const BOXES = 16;
const BEANS = 256;
// The box's width against the cells it covers, and its height against that width
const BOX_FIT = 0.98;
const BOX_FLAT = 0.3;
// A bean's length against the box's side (the feature's picture shows them big, heaped over the rim; the models alone say
// 0.16), the share of the box's side the beans fill, and how much flatter than the model they lie
const BEAN_LONG = 0.27;
const FILL = 0.7;
const BEAN_FLAT = 0.85;
// Beans in a layer at the normal bean size (bigger beans take more room), and the height one layer takes as a share of a
// bean's length
const LAYER_BEANS = 9;
const LAYER_TALL = 0.5;
// How far a bean may sit off its grid spot, as a share of the spacing
const JITTER = 0.3;
// Painting (the look's choice)
const BOX_COLOR = 0xc7b8f8;
const BRIGHT_JITTER = 0.12;
// The pop (ticks): a bean jumps this high (as a multiple of its length), spins this many turns, swells then shrinks
const POP_TICKS = 14;
const POP_RISE = 1.4;
const POP_TURNS = 1;
const POP_SWELL = 0.3;
// A hit squashes the box and makes every bean hop a little (ticks, share of the box's height, share of a bean's length)
const PUNCH_TICKS = 9;
const PUNCH_SQUASH = 0.08;
const PUNCH_HOP = 0.18;
// The box shrinks away this many ticks after its last bean pops, over this many ticks
const GONE_DELAY = 6;
const GONE_TICKS = 12;
const LONG_AGO = -1e9;

const matrix = new THREE.Matrix4();
const place = new THREE.Vector3();
const size = new THREE.Vector3();
const turn = new THREE.Quaternion();
const spin = new THREE.Euler();
const tint = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);
const STRAIGHT = new THREE.Quaternion();

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

// A repeatable number in [0, 1) from two whole numbers, so the same box always fills the same way
function hash(a, b) {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// The model's meshes baked into one geometry in the file's own space; with `only` set, just the node of that name
function bake(gltf, only) {
  const geometries = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((node) => {
    if (node.isMesh && (!only || node.name === only)) {
      const geometry = node.geometry.clone().toNonIndexed().applyMatrix4(node.matrixWorld);
      geometry.deleteAttribute("uv");
      geometries.push(geometry);
    }
  });
  return mergeGeometries(geometries);
}

// The box set on the ground with its middle at the origin and one unit wide; its height as a share of its width is
// returned with it. The same scale (the box's width in model units) sizes the bean
function boxPart(gltf, beanGeometry) {
  const geometry = bake(gltf, "CandyBox_0");
  const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
  const wide = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  geometry.translate(-(box.max.x + box.min.x) / 2, -box.min.y, -(box.max.z + box.min.z) / 2);
  geometry.scale(1 / wide, 1 / wide, 1 / wide);
  const bean = new THREE.Box3().setFromBufferAttribute(beanGeometry.attributes.position);
  const long = bean.max.x - bean.min.x;
  beanGeometry.translate(
    -(bean.max.x + bean.min.x) / 2,
    -(bean.max.y + bean.min.y) / 2,
    -(bean.max.z + bean.min.z) / 2,
  );
  beanGeometry.scale(1 / long, 1 / long, 1 / long);
  return { geometry, tall: (box.max.y - box.min.y) / wide };
}

function instanced(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

// How many beans each group gets: in proportion to its health, the largest remainders taking what is left over
function share(total, healths) {
  const sum = healths.reduce((a, b) => a + b, 0);
  const counts = healths.map((h) => Math.floor((total * h) / sum));
  const order = healths
    .map((h, i) => ({ i, rest: total * h - counts[i] * sum }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  let left = total - counts.reduce((a, b) => a + b, 0);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) {
    counts[order[k].i] += 1;
  }
  return counts;
}

class BeanLook {
  constructor(parts, scene) {
    this.boxes = [];
    this.byTarget = new Map();
    this.now = 0;
    this.parts = parts;
    this.shells = instanced(
      parts.geometry,
      new THREE.MeshStandardMaterial({ color: BOX_COLOR, roughness: 0.4 }),
      BOXES,
    );
    this.beans = instanced(parts.bean, new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.05 }), BEANS);
    this.beans.setColorAt(0, WHITE);
    this.meshes = [this.shells, this.beans];
    for (const mesh of this.meshes) {
      scene.add(mesh);
    }
  }

  // A new level: every box laid over its cells with its beans in place; beans a rebuilt game has already popped stay gone
  build(state) {
    this.clear();
    const mine = state.features[NUMBER];
    if (!mine) {
      return;
    }
    const { grid } = state;
    const cell = grid.size / L_PER_UNIT;
    this.now = state.tick;
    const listed = state.level.features.beanBoxes.BeanBoxes;
    let used = 0;
    mine.boxes.slice(0, BOXES).forEach((sim, b) => {
      const data = listed[b];
      const groups = data.Groups.filter((g) => g.TotalHealth > 0);
      const counts = share(Math.min(data.BeanCount, BEANS - used), groups.map((g) => g.TotalHealth));
      const xs = sim.cells.map((c) => c % grid.width);
      const ys = sim.cells.map((c) => Math.floor(c / grid.width));
      const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
      const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
      const box = {
        wide: (maxX - minX + 1) * cell,
        deep: (maxY - minY + 1) * cell,
        x: ((minX + maxX) / 2 - (grid.width - 1) / 2) * cell,
        z: -((minY + maxY) / 2 - (grid.height - 1) / 2) * cell,
        scale: data.BeanScale,
        punch: LONG_AGO,
        goneAt: sim.groups.every((id) => grid.targets[id].dead) ? LONG_AGO : null,
        beans: [],
      };
      box.beans = this.layout(b, box, counts.reduce((a, n) => a + n, 0));
      let at = 0;
      sim.groups.forEach((id, g) => {
        const target = grid.targets[id];
        const start = groups[g].TotalHealth;
        const mine = box.beans.slice(at, at + counts[g]);
        at += counts[g];
        const entry = { box, start, beans: mine, color: COLORS[target.color] };
        mine.forEach((bean, k) => {
          bean.color = entry.color;
          bean.limit = Math.ceil(((k + 1) * start) / mine.length);
          bean.poppedAt = target.dead || start - target.health >= bean.limit ? LONG_AGO : null;
        });
        this.byTarget.set(id, entry);
      });
      used += box.beans.length;
      this.boxes.push(box);
    });
  }

  // The spots of a box's beans, a jittered grid in two or three layers when the box holds many, in an order that
  // mixes the groups
  layout(index, box, count) {
    const layers = Math.max(1, Math.ceil(count / Math.max(3, Math.round(LAYER_BEANS / (box.scale * box.scale)))));
    const per = Math.ceil(count / layers);
    const columns = Math.max(1, Math.ceil(Math.sqrt(per)));
    const spots = [];
    for (let n = 0; n < count; n++) {
      const layer = n % layers;
      const slot = Math.floor(n / layers);
      const jx = hash(index * 977 + n, 1) - 0.5;
      const jz = hash(index * 977 + n, 2) - 0.5;
      const u = ((slot % columns) + 0.5) / columns - 0.5 + (jx * JITTER) / columns;
      const v = (Math.floor(slot / columns) + 0.5) / Math.ceil(per / columns) - 0.5 + (jz * JITTER) / columns;
      spots.push({
        u,
        v,
        layer,
        turn: hash(index * 977 + n, 3) * Math.PI,
        tone: 1 + (hash(index * 977 + n, 4) - 0.5) * 2 * BRIGHT_JITTER,
        order: hash(index * 977 + n, 5),
      });
    }
    spots.sort((a, b) => a.order - b.order);
    return spots.map((spot) => ({ ...spot, color: null, limit: 0, poppedAt: null }));
  }

  clear() {
    this.boxes = [];
    this.byTarget = new Map();
    for (const mesh of this.meshes) {
      mesh.count = 0;
    }
  }

  // A bean pops when the damage its group has taken reaches the bean's limit; a dead group pops them all
  popTo(entry, taken, t) {
    let popped = 0;
    for (const bean of entry.beans) {
      if (bean.poppedAt === null && taken >= bean.limit) {
        bean.poppedAt = t;
        popped += 1;
      }
    }
    return popped;
  }

  onEvents(events) {
    for (const event of events) {
      const entry = this.byTarget.get(event.target);
      if (event.k === "hit" && entry) {
        entry.box.punch = event.t;
        sound("bean_thock");
        const popped = this.popTo(entry, entry.start - event.health, event.t);
        for (let n = 0; n < popped; n++) {
          sound("bean_pop");
        }
      } else if (event.k === "bean_box_gone") {
        const gone = [...this.byTarget.values()].find((e) => e.box === this.boxes[event.box]);
        if (gone) {
          gone.box.goneAt = event.t + GONE_DELAY;
        }
      }
    }
  }

  // One bean at a spot of its box, hopping a little after a hit and popping when its time comes
  drawBean(box, bean, at, base) {
    let rise = 0;
    let scale = 1;
    let spun = 0;
    if (bean.poppedAt !== null) {
      const u = clamp01((this.now - bean.poppedAt) / POP_TICKS);
      if (u >= 1) {
        return;
      }
      rise = Math.sin(Math.PI * u) * POP_RISE;
      scale = (1 + POP_SWELL * Math.sin(Math.PI * Math.min(1, u * 2))) * (1 - u * u);
      spun = u * POP_TURNS * Math.PI * 2;
    } else {
      rise = PUNCH_HOP * Math.sin(Math.PI * clamp01((this.now - box.punch) / PUNCH_TICKS)) * (0.5 + bean.order);
    }
    const long = base.long * box.scale;
    place.set(
      box.x + bean.u * box.wide * FILL,
      base.floor + (bean.layer * LAYER_TALL + 0.3 + rise) * long * BEAN_FLAT,
      box.z + bean.v * box.deep * FILL,
    );
    spin.set(0, bean.turn + spun, spun * 0.5);
    turn.setFromEuler(spin);
    size.set(long * scale, long * BEAN_FLAT * scale, long * scale);
    this.beans.setMatrixAt(at.beans, matrix.compose(place, turn, size));
    this.beans.setColorAt(at.beans, tint.copy(bean.color).multiplyScalar(bean.tone));
    at.beans += 1;
  }

  drawBox(box, at) {
    const gone = box.goneAt === null ? 0 : clamp01((this.now - box.goneAt) / GONE_TICKS);
    if (gone >= 1) {
      return;
    }
    const side = Math.min(box.wide, box.deep);
    const squash = PUNCH_SQUASH * Math.sin(Math.PI * clamp01((this.now - box.punch) / PUNCH_TICKS));
    const shrink = 1 - gone * gone;
    const high = side * this.parts.tall * BOX_FLAT * BOX_FIT;
    place.set(box.x, 0, box.z);
    size.set(
      box.wide * BOX_FIT * shrink * (1 + squash / 2),
      high * shrink * (1 - squash),
      box.deep * BOX_FIT * shrink * (1 + squash / 2),
    );
    this.shells.setMatrixAt(at.shells, matrix.compose(place, STRAIGHT, size));
    at.shells += 1;
    if (gone > 0) {
      return;
    }
    const base = { long: BEAN_LONG * side, floor: high * 0.1 };
    for (const bean of box.beans) {
      this.drawBean(box, bean, at, base);
    }
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
    if (!this.boxes.length) {
      return;
    }
    const at = { shells: 0, beans: 0 };
    for (const box of this.boxes) {
      this.drawBox(box, at);
    }
    this.shells.count = at.shells;
    this.shells.instanceMatrix.needsUpdate = true;
    this.beans.count = at.beans;
    this.beans.instanceMatrix.needsUpdate = true;
    this.beans.instanceColor.needsUpdate = true;
  }
}

// Load the models and add the pools of boxes and beans to the scene
export async function create(scene) {
  const loader = new GLTFLoader();
  const [box, bean] = await Promise.all([loader.loadAsync(BOX_MODEL), loader.loadAsync(BEAN_MODEL)]);
  const beanGeometry = bake(bean);
  const part = boxPart(box, beanGeometry);
  return new BeanLook({ ...part, bean: beanGeometry }, scene);
}
