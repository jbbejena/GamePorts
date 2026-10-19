// Feature 25, the Bull Totem: a red-brown bull block with horns, a ringed snout and an angry brow stands in its queue
// place instead of a cat, turned to face the camera, with the count it still has to lose on a pill lying on its top
// (faded like a cat's number while it stands behind the queue's front). A totem that becomes active (first in its
// queue) pops up a little with its sound; every pig that leaves a queue meanwhile knocks it with a small squash and
// shake; at 0 it leaves like any entry (fx.js spins and shrinks it) with the break sound. The block is
// `models/bull_totem.glb` (ASSETS.md). The sounds are the ones the totem's prefab names (`totem_appears_trimmed`,
// `totem_destroy_trimmed`). Everything comes from the simulation's totem records (sim/features/bull_totem.js) and
// never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { NUMBER } from "../sim/features/bull_totem.js";
import { play as sound } from "../sound.js";

export { NUMBER };

const MODEL = "models/bull_totem.glb";
// The most totems one level holds is 20
const CAPACITY = 24;
// The block next to a cat (a cat's body is 0.86 wide at scale 1; the block is 0.84)
const TOTEM_SIZE = 1.0;
// A knock: the block squashes and shakes for this many ticks, by this much (squash) and this many radians (shake)
const KNOCK_TICKS = 12;
const KNOCK_SQUASH = 0.12;
const KNOCK_SHAKE = 0.1;
// An activation: the block pops up this much and settles over this many ticks
const POP_TICKS = 14;
const POP_GROWTH = 0.16;
// The pill on the block's top (block units): the top's height, how far toward the camera it sits, and its width
const BLOCK_TOP = 0.86;
const LABEL_LIFT = 0.02;
const LABEL_FORWARD = 0.06;
const LABEL_WIDE = 0.66;
// The pill: cream with dark red digits
const LABEL_W = 128;
const LABEL_H = 80;
const LABEL_FONT = '"Inter Black", "Segoe UI", sans-serif';
const LABEL_FILL = "#fff0cf";
const LABEL_INK = "#7a2e1d";
const LABEL_SHARE = 0.78;
const FACE_CAMERA = Math.PI;

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

class BullTotemLook {
  constructor(parts) {
    this.parts = parts;
    this.now = 0;
    this.byPig = new Map();
    // Per pig id: its drawn pose this frame ({x, y, z, yaw, sx, sy, fade})
    this.poses = new Map();
    // Per pig id: when it was last knocked, and when it last became active
    this.knocked = new Map();
    this.popped = new Map();
    // The count each pool part's pill shows now (null: not drawn)
    this.shown = parts.map(() => null);
  }

  build(state) {
    this.clear();
    this.begin(state);
    this.now = state.tick;
  }

  clear() {
    this.byPig.clear();
    this.poses.clear();
    this.knocked.clear();
    this.popped.clear();
    this.shown.fill(null);
    for (const part of this.parts) {
      part.group.visible = false;
    }
  }

  onEvents(events) {
    for (const event of events) {
      if (event.k === "totem_activated") {
        this.popped.set(event.pig, event.t);
        sound("totem_appears");
      } else if (event.k === "totem_hit") {
        this.knocked.set(event.pig, event.t);
      } else if (event.k === "totem_broken") {
        sound("totem_destroy");
      }
    }
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
  }

  begin(state) {
    this.byPig.clear();
    const mine = state.features[NUMBER];
    if (mine) {
      for (const totem of mine.totems) {
        this.byPig.set(totem.pig, totem);
      }
    }
    this.poses.clear();
  }

  // A totem's entry is drawn as the block: remember where its cat would stand and hide the cat. The count is read when
  // the block is written, so a totem that has just broken still shows the 0 it fell to while it leaves
  shape(id, pig, pose) {
    if (!this.byPig.has(id)) {
      return;
    }
    if (pose.shown) {
      this.poses.set(id, {
        x: pose.x,
        y: pose.y + pose.air,
        z: pose.z,
        yaw: pose.yaw,
        sx: pose.scale * pose.sx,
        sy: pose.scale * pose.sy,
        fade: pose.fade,
      });
    }
    pose.shown = false;
  }

  end() {
    let used = 0;
    for (const [id, at] of this.poses) {
      if (used >= this.parts.length) {
        break;
      }
      this.write(used, id, at);
      used += 1;
    }
    for (let i = used; i < this.parts.length; i++) {
      this.parts[i].group.visible = false;
      this.shown[i] = null;
    }
  }

  // One block where its cat would stand: squashed and shaken by a knock, popped by an activation, with its count
  write(index, id, at) {
    const part = this.parts[index];
    const totem = this.byPig.get(id);
    const knock = clamp01((this.now - (this.knocked.get(id) ?? -Infinity)) / KNOCK_TICKS);
    const pop = clamp01((this.now - (this.popped.get(id) ?? -Infinity)) / POP_TICKS);
    const hit = knock < 1 ? Math.sin(Math.PI * knock) : 0;
    const swell = pop < 1 ? 1 + POP_GROWTH * Math.sin(Math.PI * pop) : 1;
    const shake = knock < 1 ? KNOCK_SHAKE * Math.sin(3 * Math.PI * knock) * (1 - knock) : 0;
    part.group.visible = true;
    part.group.position.set(at.x, at.y, at.z);
    part.group.rotation.set(0, at.yaw + shake, 0);
    part.group.scale.set(
      at.sx * TOTEM_SIZE * swell * (1 + KNOCK_SQUASH * hit),
      at.sy * TOTEM_SIZE * swell * (1 - KNOCK_SQUASH * hit),
      at.sx * TOTEM_SIZE * swell * (1 + KNOCK_SQUASH * hit),
    );
    part.label.material.opacity = at.fade;
    if (this.shown[index] !== totem.count) {
      this.shown[index] = totem.count;
      this.paint(part, totem.count);
    }
  }

  // The pill's number, redrawn only when it changed
  paint(part, count) {
    const g = part.canvas.getContext("2d");
    g.clearRect(0, 0, LABEL_W, LABEL_H);
    g.fillStyle = LABEL_FILL;
    g.beginPath();
    g.roundRect(2, 2, LABEL_W - 4, LABEL_H - 4, LABEL_H / 2 - 2);
    g.fill();
    g.font = `900 ${Math.round(LABEL_H * LABEL_SHARE)}px ${LABEL_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = LABEL_INK;
    g.fillText(String(count), LABEL_W / 2, LABEL_H * 0.54, LABEL_W * 0.8);
    part.map.needsUpdate = true;
  }
}

// Load the block and add a pool of blocks with their pills to the scene
export async function create(scene) {
  const gltf = await new GLTFLoader().loadAsync(MODEL);
  const parts = [];
  for (let i = 0; i < CAPACITY; i++) {
    const group = new THREE.Group();
    // The model's face looks along +z, like a cat's; a cat's back is to the camera, so the block turns round
    const body = gltf.scene.clone();
    body.rotation.y = FACE_CAMERA;
    group.add(body);
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
    label.position.set(0, BLOCK_TOP + LABEL_LIFT, LABEL_FORWARD);
    label.scale.setScalar(LABEL_WIDE);
    label.renderOrder = 4;
    // The cat faces up the screen, which would put the digits upside down
    const upright = new THREE.Group();
    upright.rotation.y = Math.PI;
    upright.add(label);
    group.add(upright);
    group.visible = false;
    scene.add(group);
    parts.push({ group, canvas, map, label });
  }
  return new BullTotemLook(parts);
}
