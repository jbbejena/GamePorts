// Feature 20, Shackles: every chained cat wears two steel chain straps with a golden clasp, and a steel chain of links
// runs from each member's clasp to the next member's, across the queues, sagging a little between them (reference
// frame level1000-chained-pigs.png). When a member moves up its queue the chain's length changes with the original's
// chain sound. Once every member is first the chain trembles and its clasps glow for the 0.3 s wait, then it bursts:
// the links fly apart, fall and shrink, the straps swell and spin away, with the break sound. A tap or a vanish bursts
// it at once. The straps are `models/overlay_chains.glb` and the links `models/features/
// chained_shooter_rope_chain_model.glb` (ASSETS.md). Everything comes from the simulation's chains and phases
// (sim/features/shackles.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { BREAKING, BROKEN, NUMBER } from "../sim/features/shackles.js";
import { SHACKLE_BREAK } from "../sim/numbers.js";
import { play as sound } from "../sound.js";

export { NUMBER };

const STRAPS_MODEL = "models/overlay_chains.glb";
const LINK_MODEL = "models/features/chained_shooter_rope_chain_model.glb";
// The most chained pigs one level holds is 42 (level 828)
const CAPACITY = 48;
// Links drawn standing and flying at once
const LINK_CAPACITY = 1200;
const FLYING_CAPACITY = 600;
// A link's size next to a cat at scale 1 (the mesh is 0.48 long), and the step between two links along the chain
const LINK_SCALE = 0.55;
const LINK_STEP = 0.2;
// Where the chain leaves a cat: its clasp, in the straps' own axes at cat scale 1
const CLASP_UP = 0.45;
const CLASP_FORWARD = 0.46;
// How far the chain sags between two cats: a share of the span, at most SAG_MOST
const SAG = 0.08;
const SAG_MOST = 0.3;
// The wait before a burst: the chain trembles this much (cat units) and the clasps glow
const TREMBLE = 0.035;
const GLOW = new THREE.Color("#ffb347");
// A burst: links fly out and fall for this many ticks; the straps swell and spin away over BURST_TICKS
const BURST_TICKS = 30;
const LINK_SPREAD = 0.05;
const LINK_UP = 0.06;
const LINK_GRAVITY = 0.004;
const STRAP_SWELL = 0.3;
const STRAP_SPIN = 2.4;
// Links fly out at golden-angle steps
const GOLDEN = 2.399963;
const STEEL = "#a3abb6";

const matrix = new THREE.Matrix4();
const place = new THREE.Vector3();
const size = new THREE.Vector3();
const turn = new THREE.Quaternion();
const roll = new THREE.Quaternion();
const euler = new THREE.Euler();
const from = new THREE.Vector3();
const to = new THREE.Vector3();
const mid = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const step = new THREE.Vector3();
const ALONG = new THREE.Vector3(0, 0, 1);

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

class ShacklesLook {
  constructor(parts, links, flying) {
    this.parts = parts;
    this.links = links;
    this.flying = flying;
    this.mine = null;
    this.now = 0;
    // Per pig id: where its cat stands this frame ({x, y, z, yaw, sx, sy}), and the last place it was drawn
    this.poses = new Map();
    this.lastSeen = new Map();
    // Per chain index: when its wait began; and the bursts still flying ({t0, ids, spans: [[from, to], ...], cats})
    this.waits = new Map();
    this.bursts = [];
    // Per pig id of a whole chain: its queue place last drawn, to hear the chain's length change
    this.places = new Map();
  }

  build(state) {
    this.clear();
    this.mine = state.features[NUMBER] || null;
    this.now = state.tick;
    this.notePlaces(state);
  }

  clear() {
    this.mine = null;
    this.poses.clear();
    this.lastSeen.clear();
    this.waits.clear();
    this.bursts = [];
    this.places.clear();
    for (const part of this.parts) {
      part.group.visible = false;
    }
    this.links.count = 0;
    this.flying.count = 0;
  }

  onEvents(events, state) {
    if (!this.mine) {
      return;
    }
    for (const event of events) {
      if (event.k === "shackles_breaking") {
        this.waits.set(event.chain, event.t);
      } else if (event.k === "shackles_broken") {
        this.waits.delete(event.chain);
        this.burst(event);
      }
    }
    this.notePlaces(state);
  }

  // A chain whose members moved up their queues plays the chain sound once
  notePlaces(state) {
    if (!this.mine) {
      return;
    }
    let moved = false;
    this.mine.chains.forEach((members, index) => {
      if (this.mine.phase[index] === BROKEN) {
        return;
      }
      for (const id of members) {
        const queue = state.queues.find((ids) => ids.includes(id));
        const at = queue ? queue.indexOf(id) : -1;
        if (this.places.has(id) && this.places.get(id) !== at) {
          moved = true;
        }
        this.places.set(id, at);
      }
    });
    if (moved) {
      sound("shackles_stretch");
    }
  }

  // A chain breaks: its links and straps fly from where they were last drawn
  burst(event) {
    const cats = event.ids.map((id) => this.lastSeen.get(id)).filter(Boolean);
    const spans = [];
    for (let k = 0; k + 1 < event.ids.length; k++) {
      const first = this.lastSeen.get(event.ids[k]);
      const second = this.lastSeen.get(event.ids[k + 1]);
      if (first && second) {
        spans.push([first, second]);
      }
    }
    if (cats.length) {
      this.bursts.push({ t0: event.t, seed: event.chain, cats, spans });
    }
    sound("shackles_break");
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
  }

  begin(state) {
    this.mine = state.features[NUMBER] || null;
    this.poses.clear();
  }

  // Every chained cat that is drawn: remember where it stands, so the straps and the chain go on it
  shape(id, pig, pose) {
    if (!this.mine || !pose.shown || pose.scale <= 0.01) {
      return;
    }
    const index = this.mine.chains.findIndex((members, k) => this.mine.phase[k] !== BROKEN && members.includes(id));
    if (index < 0) {
      return;
    }
    const at = { x: pose.x, y: pose.y + pose.air, z: pose.z, yaw: pose.yaw, sx: pose.scale * pose.sx, sy: pose.scale * pose.sy };
    this.lastSeen.set(id, at);
    this.poses.set(id, at);
  }

  // How far into its wait a chain is (0 to 1), or -1 when it isn't waiting
  waitShare(index) {
    if (this.mine.phase[index] !== BREAKING || !this.waits.has(index)) {
      return -1;
    }
    return clamp01((this.now - this.waits.get(index)) / SHACKLE_BREAK);
  }

  end() {
    if (!this.mine) {
      return;
    }
    let used = 0;
    let count = 0;
    this.mine.chains.forEach((members, index) => {
      if (this.mine.phase[index] === BROKEN) {
        return;
      }
      const wait = this.waitShare(index);
      const shake = wait < 0 ? 0 : TREMBLE * wait * Math.sin(this.now * 2.7 + index);
      for (const id of members) {
        const at = this.poses.get(id);
        if (at && used < this.parts.length) {
          this.writeStraps(this.parts[used++], at, shake, wait);
        }
      }
      for (let k = 0; k + 1 < members.length; k++) {
        const first = this.poses.get(members[k]);
        const second = this.poses.get(members[k + 1]);
        if (first && second) {
          count = this.writeChain(count, first, second, shake);
        }
      }
    });
    this.links.count = count;
    this.links.instanceMatrix.needsUpdate = true;
    this.writeBursts(used);
  }

  // One cat's straps, trembling and glowing through the wait
  writeStraps(part, at, shake, wait) {
    part.group.visible = true;
    part.group.position.set(at.x + shake * at.sx, at.y, at.z);
    part.group.rotation.set(0, at.yaw, 0);
    part.group.scale.set(at.sx, at.sy, at.sx);
    part.clasp.emissive.copy(GLOW).multiplyScalar(wait < 0 ? 0 : 0.8 * wait);
  }

  // The clasp of a cat in world space
  claspOf(at, out) {
    const forward = CLASP_FORWARD * at.sx;
    return out.set(at.x + Math.sin(at.yaw) * forward, at.y + CLASP_UP * at.sy, at.z + Math.cos(at.yaw) * forward);
  }

  // The chain between two cats: links along a curve from one clasp to the other, every second one turned on its side
  writeChain(count, first, second, shake) {
    this.claspOf(first, from);
    this.claspOf(second, to);
    from.x += shake;
    to.x -= shake;
    const span = from.distanceTo(to);
    mid.addVectors(from, to).multiplyScalar(0.5);
    mid.y -= Math.min(SAG_MOST, SAG * span) * 2;
    const scale = LINK_SCALE * Math.min(first.sx, second.sx);
    const pieces = Math.max(2, Math.ceil(span / (LINK_STEP * Math.min(first.sx, second.sx))));
    for (let k = 0; k < pieces && count < LINK_CAPACITY; k++) {
      curvePoint(k / pieces, a);
      curvePoint((k + 1) / pieces, b);
      step.subVectors(b, a);
      const length = step.length();
      turn.setFromUnitVectors(ALONG, length > 1e-6 ? step.divideScalar(length) : ALONG);
      roll.setFromAxisAngle(ALONG, k % 2 ? Math.PI / 2 : 0);
      turn.multiply(roll);
      matrix.compose(a.lerp(b, 0.5), turn, size.setScalar(scale));
      this.links.setMatrixAt(count++, matrix);
    }
    return count;
  }

  // Every recent burst: links flying out and falling, straps swelling and spinning away
  writeBursts(used) {
    this.bursts = this.bursts.filter((burst) => this.now - burst.t0 < BURST_TICKS);
    let count = 0;
    for (const burst of this.bursts) {
      const age = Math.max(0, this.now - burst.t0);
      const u = age / BURST_TICKS;
      for (const cat of burst.cats) {
        if (used < this.parts.length) {
          this.writeFlyingStraps(this.parts[used++], cat, age, u);
        }
      }
      for (const [first, second] of burst.spans) {
        count = this.writeFlyingLinks(count, burst, first, second, age, u);
      }
    }
    for (let i = used; i < this.parts.length; i++) {
      this.parts[i].group.visible = false;
    }
    this.flying.count = count;
    this.flying.instanceMatrix.needsUpdate = true;
  }

  writeFlyingStraps(part, cat, age, u) {
    const grow = (1 + STRAP_SWELL * Math.sin(Math.PI * Math.min(1, u * 2))) * (1 - u * u);
    part.group.visible = grow > 0.01;
    part.group.position.set(cat.x, cat.y + LINK_UP * age * cat.sy, cat.z);
    part.group.rotation.set(0, cat.yaw + STRAP_SPIN * u, 0);
    part.group.scale.set(cat.sx * grow, cat.sy * grow, cat.sx * grow);
    part.clasp.emissive.setScalar(0);
  }

  // The links of one span fly out from where they hung, each its own way, falling and shrinking
  writeFlyingLinks(count, burst, first, second, age, u) {
    this.claspOf(first, from);
    this.claspOf(second, to);
    const scale = LINK_SCALE * Math.min(first.sx, second.sx) * (1 - u * u);
    const pieces = Math.max(2, Math.ceil(from.distanceTo(to) / (LINK_STEP * Math.min(first.sx, second.sx))));
    for (let k = 0; k < pieces && count < FLYING_CAPACITY; k++) {
      const angle = (burst.seed + k) * GOLDEN;
      const reach = LINK_SPREAD * (0.6 + (k % 3) * 0.3) * age;
      place.lerpVectors(from, to, (k + 0.5) / pieces);
      place.x += Math.cos(angle) * reach;
      place.z += Math.sin(angle) * reach;
      place.y = Math.max(0.02, place.y + LINK_UP * (1 + (k % 2)) * age - LINK_GRAVITY * age * age);
      euler.set(age * 0.23 + k, age * 0.19 + angle, k);
      turn.setFromEuler(euler);
      matrix.compose(place, turn, size.setScalar(Math.max(0.001, scale)));
      this.flying.setMatrixAt(count++, matrix);
    }
    return count;
  }
}

// A point of the curve from `from` to `to` through the lowered middle (a quadratic Bezier)
function curvePoint(u, out) {
  const v = 1 - u;
  return out
    .copy(from)
    .multiplyScalar(v * v)
    .addScaledVector(mid, 2 * u * v)
    .addScaledVector(to, u * u);
}

// The link mesh from the original's prefab, painted steel, as an instanced mesh
function linkMesh(gltf, capacity) {
  let geometry = null;
  gltf.scene.traverse((node) => {
    if (node.isMesh && !geometry) {
      geometry = node.geometry;
    }
  });
  const material = new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.35, metalness: 0.7 });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

// Load the straps and the link, and add a pool of straps and the two link meshes to the scene
export async function create(scene) {
  const loader = new GLTFLoader();
  const [straps, link] = await Promise.all([loader.loadAsync(STRAPS_MODEL), loader.loadAsync(LINK_MODEL)]);
  const parts = [];
  for (let i = 0; i < CAPACITY; i++) {
    const group = new THREE.Group();
    const model = straps.scene.clone();
    let clasp = null;
    model.traverse((node) => {
      if (node.isMesh) {
        node.material = node.material.clone();
        if (node.material.name === "Clasp") {
          clasp = node.material;
        }
      }
    });
    group.add(model);
    group.visible = false;
    scene.add(group);
    parts.push({ group, clasp: clasp || new THREE.MeshStandardMaterial() });
  }
  const links = linkMesh(link, LINK_CAPACITY);
  const flying = linkMesh(link, FLYING_CAPACITY);
  scene.add(links, flying);
  return new ShacklesLook(parts, links, flying);
}
