// Feature 27, the Crossbow: the original's `models/features/crossbow_feature.glb` (a pale block base and the bow on
// it) stands over the crossbow's box, turned to face its Direction, the bow painted the crossbow's color and the base
// and string a pale lavender as in the feature's picture (the prefab has no materials). Its arrows
// (`crossbow_arrow.glb`, one for an odd side and two side by side for an even one) rest on the bow and draw back as the
// crossbow loses health (CrossbowModel$$SetTension takes 1 - health / max), and a white tag shows the health left. Each
// hit swells the crossbow a little. When it fires, the resting arrows leave and one arrow per line flies from the cell
// outside the box to where its path ends, at the simulation's ARROW_SPEED, then shrinks away over ARROW_VANISH ticks;
// the bow kicks back as it fires (`arrow_whoosh_*`) and shrinks away when the simulation says the crossbow is gone. An
// arrow keeps the crossbow's scale in flight, as the original's arrows take their parent's. When play starts the
// crossbows rise into place (`crossbow_appear_*`, the appear timings of CrossbowModel #12119). The swell, the kick and
// the shrink's shape are the look's own. Everything comes from the simulation's crossbow records
// (sim/features/crossbow.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { mergeGeometries } from "../vendor/BufferGeometryUtils.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { PICTURE_HEIGHT } from "../camera.js";
import { COLORS } from "../picture.js";
import { play as sound } from "../sound.js";
import { NUMBER } from "../sim/features/crossbow.js";
import { ARROW_SPEED, ARROW_VANISH, L_PER_UNIT } from "../sim/numbers.js";

export { NUMBER };

const BOW_MODEL = "models/features/crossbow_feature.glb";
const ARROW_MODEL = "models/features/crossbow_arrow.glb";
// The most crossbows one level holds is 14 (level 1690); each holds or fires at most 2 arrows
const BOWS = 16;
const ARROWS = BOWS * 2;
// The base's footprint against the box, and how much flatter than the model the whole crossbow stands
const FIT = 0.96;
const FLAT = 0.7;
// The prefab's base is its first mesh, its stock the second and the string its last; the rest are the limbs
const BASE_PART = 0;
const STOCK_PART = 1;
const STRING_PART = 4;
// The model's bow points along +Z in the file; the turn about the up axis that faces each Direction (Left, Up, Right,
// Down: picture up is the scene's -Z)
const FACING = [-Math.PI / 2, Math.PI, Math.PI / 2, 0];
// Painting: the base and the string pale lavender (the feature's picture), the limbs the color lifted toward white
const PALE = 0xc6c8f2;
const LIMB_LIFT = 0.35;
const ARROW_COLOR = 0x48506a;
// The resting arrows in model units: the arrow prefab's length, how high they lie, and where the tip lies at full
// health and fully drawn; a resting arrow is half its length at rest and whole when fully drawn (arrowRestLocalScale
// and arrowPulledLocalScale), and two lie this far apart (arrowSpacing). How far the tip moves is the look's own
const ARROW_LONG = 2.2;
const REST_UP = 1.3;
const TIP_REST = 0.95;
const TIP_PULLED = 0.25;
const ARROW_SPACING = 0.4;
// A flying arrow's height above the picture, in cube heights
const ARROW_HIGH = 1.4;
// A hit swells the crossbow this much over this many ticks; firing kicks the bow back (a share of the box) over this
// many ticks
const SWELL = 0.06;
const SWELL_TICKS = 8;
const KICK = 0.08;
const KICK_TICKS = 10;
// Gone: the crossbow shrinks away over this many ticks
const GONE_TICKS = 14;
// The appear when play starts (CrossbowModel #12119: scale 0.4 s, move after 0.2 s for 0.4 s from 2.7 below), each
// crossbow a little after the one before
const APPEAR_SCALE = 24;
const APPEAR_MOVE_DELAY = 12;
const APPEAR_MOVE = 24;
const APPEAR_DROP = 2.7;
const APPEAR_STAGGER = 2;
// The tag: a white pill with dark digits, as wide as this share of the box, on the stock behind the middle
const LABEL_W = 192;
const LABEL_H = 112;
const LABEL_FONT = '"Inter Black", "Segoe UI", sans-serif';
const LABEL_INK = "#4a2810";
const LABEL_SHARE = 0.8;
const LABEL_WIDE = 0.32;
const LABEL_BACK = 0.22;
const LONG_AGO = -1e9;

const matrix = new THREE.Matrix4();
const place = new THREE.Vector3();
const size = new THREE.Vector3();
const turn = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const paint = new THREE.Color();

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

function easeOut(u) {
  return 1 - (1 - u) * (1 - u);
}

// Every mesh of a model with its node transform baked in, each painted one color (chosen by its index) on every vertex
function baked(gltf, colorOf) {
  gltf.scene.updateMatrixWorld(true);
  const geometries = [];
  gltf.scene.traverse((node) => {
    if (node.isMesh) {
      const geometry = node.geometry.clone().toNonIndexed().applyMatrix4(node.matrixWorld);
      geometry.deleteAttribute("uv");
      const color = colorOf(geometries.length);
      const count = geometry.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors.set([color.r, color.g, color.b], i * 3);
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometries.push(geometry);
    }
  });
  return geometries;
}

// The arrow pointing along +Z with its middle at the origin, one unit long
function arrowGeometry(gltf) {
  const color = new THREE.Color(ARROW_COLOR);
  const [geometry] = baked(gltf, () => color);
  const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
  const long = box.max.z - box.min.z;
  geometry.translate(-(box.max.x + box.min.x) / 2, -(box.max.y + box.min.y) / 2, -(box.max.z + box.min.z) / 2);
  geometry.scale(1 / long, 1 / long, 1 / long);
  return geometry;
}

class CrossbowLook {
  constructor(bowGltf, arrowGltf, scene) {
    this.bowGltf = bowGltf;
    this.now = 0;
    this.bows = [];
    this.appearAt = LONG_AGO;
    this.width = new THREE.Box3().setFromObject(bowGltf.scene).getSize(new THREE.Vector3()).x;
    this.slots = [];
    for (let i = 0; i < BOWS; i++) {
      this.slots.push(this.makeSlot(scene));
    }
    this.arrows = new THREE.InstancedMesh(
      arrowGeometry(arrowGltf),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2 }),
      ARROWS,
    );
    this.arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arrows.frustumCulled = false;
    this.arrows.count = 0;
    scene.add(this.arrows);
  }

  // One crossbow's pool: its model (painted when a level gives it a color) and its tag
  makeSlot(scene) {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    group.add(mesh);
    group.visible = false;
    scene.add(group);
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
    return { group, mesh, canvas, map, label, color: -1 };
  }

  // The model painted for one color: pale base and string, the stock in the color and the limbs lighter
  paintSlot(slot, color) {
    if (slot.color === color) {
      return;
    }
    slot.color = color;
    const body = COLORS[color] || new THREE.Color(0xffffff);
    const limb = body.clone().lerp(paint.set(0xffffff), LIMB_LIFT);
    const pale = new THREE.Color(PALE);
    const geometries = baked(this.bowGltf, (part) => {
      if (part === BASE_PART || part === STRING_PART) {
        return pale;
      }
      return part === STOCK_PART ? body : limb;
    });
    slot.mesh.geometry.dispose();
    slot.mesh.geometry = mergeGeometries(geometries);
  }

  // A new level: every crossbow placed over its box and faced its way; a rebuilt game's gone ones stay hidden. A level
  // at its start waits for play to start before the crossbows rise
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
    mine.bows.slice(0, BOWS).forEach((bow, index) => {
      const slot = this.slots[index];
      this.paintSlot(slot, grid.targets[bow.target].color);
      const xs = bow.points.map(([x]) => x);
      const ys = bow.points.map(([, y]) => y);
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const side = Math.min(maxX - minX + 1, maxY - minY + 1) * this.cell;
      const facing = FACING[bow.direction];
      this.bows.push({
        bow,
        slot,
        max: Math.max(1, state.level.features.crossbows.Crossbows[index].Health),
        x: ((minX + maxX) / 2 - (grid.width - 1) / 2) * this.cell,
        z: -((minY + maxY) / 2 - (grid.height - 1) / 2) * this.cell,
        side,
        facing,
        ahead: [Math.sin(facing), Math.cos(facing)],
        scale: (side * FIT) / this.width,
        hitAt: LONG_AGO,
        goneAt: bow.state === "gone" ? LONG_AGO : null,
        shown: null,
      });
    });
    this.appearAt = state.tick === 0 ? null : LONG_AGO;
  }

  clear() {
    this.bows = [];
    this.arrows.count = 0;
    for (const slot of this.slots) {
      slot.group.visible = false;
      slot.label.visible = false;
    }
  }

  onEvents(events) {
    for (const event of events) {
      if (event.k === "hit") {
        const entry = this.bows.find((b) => b.bow.target === event.target);
        if (entry) {
          entry.hitAt = event.t;
        }
      } else if (event.k === "crossbow_fire") {
        for (let n = 0; n < event.arrows.length; n++) {
          sound("crossbow_fire");
        }
      } else if (event.k === "crossbow_gone" && this.bows[event.bow]) {
        this.bows[event.bow].goneAt = event.t;
      }
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

  // How far a crossbow has risen into place since play started: [scale share, rise share]
  appear(index) {
    if (this.appearAt === null) {
      return [0, 0];
    }
    const t = this.now - this.appearAt - index * APPEAR_STAGGER;
    return [easeOut(clamp01(t / APPEAR_SCALE)), easeOut(clamp01((t - APPEAR_MOVE_DELAY) / APPEAR_MOVE))];
  }

  // One crossbow this frame: standing (swelling after a hit), kicking as it fires, or shrinking away
  drawBow(entry, index, state, at) {
    const { slot, bow } = entry;
    const gone = entry.goneAt === null ? 0 : clamp01((this.now - entry.goneAt) / GONE_TICKS);
    slot.group.visible = gone < 1;
    if (gone >= 1) {
      slot.label.visible = false;
      return;
    }
    const [grow, rise] = this.appear(index);
    const swell = 1 + SWELL * Math.sin(Math.PI * clamp01((this.now - entry.hitAt) / SWELL_TICKS));
    const standing = bow.state === "standing" || bow.state === "armed";
    const kicked = standing ? 0 : (this.now - bow.fired) / KICK_TICKS;
    const back = kicked > 0 && kicked < 1 ? KICK * Math.sin(Math.PI * kicked) * entry.side : 0;
    const scale = entry.scale * swell * (1 - gone * gone) * grow;
    slot.group.position.set(
      entry.x - entry.ahead[0] * back,
      this.height - (1 - rise) * APPEAR_DROP * entry.scale,
      entry.z - entry.ahead[1] * back,
    );
    slot.group.rotation.set(0, entry.facing, 0);
    slot.group.scale.set(scale, scale * FLAT, scale);
    const target = state.grid.targets[bow.target];
    this.drawTag(entry, target, rise);
    if (standing && grow > 0) {
      this.restingArrows(entry, target, scale, at);
    }
  }

  // The tag on the stock while the crossbow stands
  drawTag(entry, target, rise) {
    const { slot } = entry;
    slot.label.visible = !target.dead && rise > 0.99;
    if (!slot.label.visible) {
      return;
    }
    const wide = entry.side * LABEL_WIDE;
    slot.label.scale.set(wide, wide, 1);
    slot.label.position.set(
      entry.x - entry.ahead[0] * entry.side * LABEL_BACK,
      this.height + entry.scale * FLAT * (REST_UP + 0.3),
      entry.z - entry.ahead[1] * entry.side * LABEL_BACK,
    );
    if (entry.shown !== target.health) {
      entry.shown = target.health;
      this.paintLabel(slot, target.health);
    }
  }

  // The arrows lying on the bow, drawn back and stretched as the crossbow loses health
  restingArrows(entry, target, scale, at) {
    const tension = 1 - target.health / entry.max;
    const long = ARROW_LONG * (0.5 + 0.5 * tension);
    const forward = (TIP_REST + (TIP_PULLED - TIP_REST) * tension - long / 2) * scale;
    const offsets = entry.bow.side % 2 === 1 ? [0] : [-ARROW_SPACING / 2, ARROW_SPACING / 2];
    const { position } = entry.slot.group;
    const [ax, az] = entry.ahead;
    turn.setFromAxisAngle(UP, entry.facing);
    for (const offset of offsets) {
      const across = offset * scale;
      place.set(
        position.x + ax * forward + az * across,
        position.y + REST_UP * scale * FLAT,
        position.z + az * forward - ax * across,
      );
      const wide = ARROW_LONG * 0.5 * scale;
      this.arrows.setMatrixAt(at.arrows, matrix.compose(place, turn, size.set(wide, wide, long * scale)));
      at.arrows += 1;
    }
  }

  // The arrows in flight: from the cell outside the box to where the path ends at ARROW_SPEED, then shrinking away
  drawFlying(entry, state, at) {
    const { bow } = entry;
    if (bow.state !== "firing" && bow.state !== "gone") {
      return;
    }
    const { grid } = state;
    const long = ARROW_LONG * entry.scale;
    turn.setFromAxisAngle(UP, entry.facing);
    for (const arrow of bow.arrows) {
      const shrink = clamp01((this.now - arrow.end) / ARROW_VANISH);
      if (shrink >= 1 || at.arrows >= ARROWS) {
        continue;
      }
      const sx = (arrow.start[0] - (grid.width - 1) / 2) * this.cell;
      const sz = -(arrow.start[1] - (grid.height - 1) / 2) * this.cell;
      const ex = (arrow.stop[0] - (grid.width - 1) / 2) * this.cell;
      const ez = -(arrow.stop[1] - (grid.height - 1) / 2) * this.cell;
      const distance = Math.hypot(ex - sx, ez - sz);
      const flown = Math.max(0, (this.now - bow.fired + 1) * ARROW_SPEED) / L_PER_UNIT;
      const u = distance > 0 ? Math.min(1, flown / distance) : 1;
      place.set(sx + (ex - sx) * u, this.height * (1 + ARROW_HIGH), sz + (ez - sz) * u);
      const s = long * (1 - shrink);
      this.arrows.setMatrixAt(at.arrows, matrix.compose(place, turn, size.set(s, s, s)));
      at.arrows += 1;
    }
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
    if (!this.bows.length) {
      return;
    }
    if (this.appearAt === null && state.tick > 0) {
      this.appearAt = state.tick - 1;
      sound("crossbow_appear");
    }
    const at = { arrows: 0 };
    this.bows.forEach((entry, index) => {
      this.drawBow(entry, index, state, at);
      this.drawFlying(entry, state, at);
    });
    this.arrows.count = at.arrows;
    this.arrows.instanceMatrix.needsUpdate = true;
  }
}

// Load the crossbow and arrow prefabs and add the pools to the scene
export async function create(scene) {
  const loader = new GLTFLoader();
  const [bow, arrow] = await Promise.all([loader.loadAsync(BOW_MODEL), loader.loadAsync(ARROW_MODEL)]);
  return new CrossbowLook(bow, arrow, scene);
}
