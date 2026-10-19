// Feature 30, the Slot Cage: a hatch of the cage's color lies over a slot (the prefab `models/features/
// slot_cage_feature.glb`: a steel base, a hatch with its inset plate and two hinges; it has no materials, so the paint
// is the look's own) with a white pill on it counting the cubes still needed. A cube of the cage's color that breaks
// anywhere counts down the pill when its copy lands, the same CUBE_FLY_IN ticks the simulation waits. When the cage opens
// the hatch swings up on its hinges and tumbles away spinning and shrinking, the base shrinks after it, and the cages
// still shut jump to their new place in the row as the pigs slide left (a 0.25 s jump, spec 2.7). The sounds are the
// prefabs' own (SlotCageModel's reveal, hit and destroy players). Everything comes from the simulation's cage records
// (sim/features/slot_cage.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { HOP_HEIGHT } from "../fx.js";
import { COLORS } from "../picture.js";
import { play as sound } from "../sound.js";
import { NUMBER } from "../sim/features/slot_cage.js";

export { NUMBER };

const MODEL = "models/features/slot_cage_feature.glb";
// The most cages one level holds is 5
const CAPACITY = 5;
// The base is this wide in the model; the cage fills this share of its slot
const MODEL_WIDE = 1.2;
const SLOT_FIT = 0.92;
// A cage's jump to its new place after another opened: 0.25 s, the pigs' own height
const MOVE_TICKS = 15;
// The opening: the hatch swings this far on its hinges in OPEN_SWING ticks, then tumbles away for TUMBLE_TICKS (the
// prefab's doorBlownEuler, doorBurstDuration, doorTumbleSpin, doorDestroyDuration), and the base shrinks over
// BASE_TICKS after BASE_DELAY
const OPEN_SWING = 7;
const OPEN_ANGLE = (100 * Math.PI) / 180;
const TUMBLE_TICKS = 18;
const TUMBLE_SPIN = (220 * Math.PI) / 180;
const TUMBLE_MOVE = [-0.2, 0.6, 0.6];
const BASE_DELAY = 10;
const BASE_TICKS = 10;
const GONE_TICKS = 32;
// A cube copy landing punches the cage: it squashes this much over HIT_TICKS
const HIT_TICKS = 10;
const HIT_SQUASH = 0.08;
// The count's pill on the hatch
const LABEL_W = 128;
const LABEL_H = 80;
const LABEL_FONT = '"Inter Black", "Segoe UI", sans-serif';
const LABEL_INK = "#2b3a6b";
const LABEL_SHARE = 0.8;
const LABEL_WIDE = 0.55;
const LABEL_LIFT = 0.02;
// Painting: the steel of the base and hinges, and how much darker the hatch's slab is than its inset plate
const STEEL = 0x8892b8;
const HINGE = 0x5d6aa3;
const SLAB_SHADE = 0.78;
const SLOT_LIFT = 0.01;

const paint = new THREE.Color();

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

function easeOutCubic(u) {
  return 1 - (1 - u) ** 3;
}

function easeInCubic(u) {
  return u ** 3;
}

// The prefab's pieces with their node transforms baked in: the base, the hinges, the slab and the plate of the hatch
function piecesOf(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const found = {};
  gltf.scene.traverse((node) => {
    if (node.isMesh) {
      found[node.name] = node.geometry.clone().applyMatrix4(node.matrixWorld);
    }
  });
  return found;
}

class SlotCageLook {
  constructor(parts, pieces, pivot) {
    this.parts = parts;
    this.pieces = pieces;
    // Where the hatch's hinges are: [x, y] of the axis it swings on, in model units
    this.pivot = pivot;
    this.now = 0;
    this.mine = null;
    this.spots = [];
    // Per cage: where it is drawn now ({x, z, size}), the slot place it belongs in, the slide it is in, when it opened,
    // when it was last hit and the count shown on its pill
    this.cages = [];
  }

  build(state) {
    this.clear();
    this.mine = state.features[NUMBER] || null;
    this.now = state.tick;
    if (!this.mine) {
      return;
    }
    this.mine.cages.slice(0, CAPACITY).forEach((cage) => {
      this.cages.push({ drawn: null, slide: null, opened: cage.open ? -Infinity : null, hitAt: -Infinity, shown: null, place: -1 });
    });
  }

  clear() {
    this.mine = null;
    this.cages = [];
    for (const part of this.parts) {
      part.group.visible = false;
      part.label.visible = false;
    }
  }

  begin(state, spots) {
    this.mine = state.features[NUMBER] || null;
    this.spots = spots ? spots.slots : [];
  }

  onEvents(events) {
    for (const event of events) {
      if (!this.mine) {
        return;
      }
      if (event.k === "cage_hit" && this.cages[event.cage]) {
        this.cages[event.cage].hitAt = event.t;
        sound("cage_hit");
      } else if (event.k === "cage_open" && this.cages[event.cage]) {
        this.cages[event.cage].opened = event.t;
        sound("cage_destroy");
      }
    }
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
    if (!this.mine) {
      return;
    }
    this.parts.forEach((part, index) => this.draw(part, index));
  }

  // Which slot place cage `index` belongs in now: how many cages before it are still shut
  placeOf(index) {
    let place = 0;
    for (let i = 0; i < index; i++) {
      if (!this.mine.cages[i].open) {
        place += 1;
      }
    }
    return place;
  }

  // Where the cage stands this frame ({x, z, size, lift}), jumping to its new slot when its place changed
  position(cage, place, spot) {
    const to = { x: spot.x, z: spot.z, size: spot.size };
    if (!cage.drawn) {
      cage.drawn = { ...to };
      cage.place = place;
    } else if (place !== cage.place) {
      cage.slide = { from: { ...cage.drawn }, t0: this.now };
      cage.place = place;
    }
    if (!cage.slide) {
      cage.drawn = to;
      return { ...to, lift: 0 };
    }
    const u = clamp01((this.now - cage.slide.t0) / MOVE_TICKS);
    const { from } = cage.slide;
    const at = {
      x: from.x + (to.x - from.x) * u,
      z: from.z + (to.z - from.z) * u,
      size: from.size + (to.size - from.size) * u,
    };
    cage.drawn = at;
    if (u >= 1) {
      cage.slide = null;
    }
    return { ...at, lift: HOP_HEIGHT * 4 * u * (1 - u) * at.size * 0.4 };
  }

  draw(part, index) {
    const record = this.mine.cages[index];
    const cage = this.cages[index];
    if (!record || !cage || !this.spots.length) {
      part.group.visible = false;
      part.label.visible = false;
      return;
    }
    const age = cage.opened === null ? -1 : this.now - cage.opened;
    if (age > GONE_TICKS) {
      part.group.visible = false;
      part.label.visible = false;
      return;
    }
    // An open cage stays where it was while it breaks up
    const place = record.open && cage.place >= 0 ? cage.place : this.placeOf(index);
    const at = this.position(cage, place, this.spots[Math.min(place, this.spots.length - 1)]);
    const k = (at.size * SLOT_FIT) / MODEL_WIDE;
    const punch = clamp01((this.now - cage.hitAt) / HIT_TICKS);
    const squash = punch < 1 ? HIT_SQUASH * Math.sin(Math.PI * punch) : 0;
    const baseShrink = age < 0 ? 1 : 1 - easeInCubic(clamp01((age - BASE_DELAY) / BASE_TICKS));
    part.group.visible = true;
    part.group.position.set(at.x, SLOT_LIFT + at.lift, at.z);
    part.group.scale.set(k * (1 + squash), k * (1 - squash * 2), k * (1 + squash));
    part.base.visible = baseShrink > 0.001;
    part.base.scale.setScalar(Math.max(0.001, baseShrink));
    part.paint.copy(COLORS[record.color]);
    part.slab.color.copy(part.paint).multiplyScalar(SLAB_SHADE);
    part.plate.color.copy(part.paint);
    this.drawHatch(part, age);
    this.drawLabel(part, record, cage, age, k);
  }

  // The hatch shut, swinging open on its hinges, or tumbling away
  drawHatch(part, age) {
    const hatch = part.hatch;
    const [px, py] = this.pivot;
    hatch.position.set(px, py, 0);
    hatch.rotation.set(0, 0, 0);
    hatch.scale.setScalar(1);
    hatch.visible = true;
    if (age < 0) {
      return;
    }
    const swing = easeOutCubic(clamp01(age / OPEN_SWING));
    const tumble = clamp01((age - OPEN_SWING) / TUMBLE_TICKS);
    // Rotate about the hinge line (parallel to the slot's depth axis), then tumble away
    hatch.rotation.z = -OPEN_ANGLE * swing - TUMBLE_SPIN * easeOutCubic(tumble);
    hatch.position.x += TUMBLE_MOVE[0] * easeOutCubic(tumble);
    hatch.position.y += TUMBLE_MOVE[1] * easeOutCubic(tumble);
    hatch.position.z += TUMBLE_MOVE[2] * easeOutCubic(tumble);
    hatch.scale.setScalar(Math.max(0.001, 1 - easeInCubic(tumble)));
    hatch.visible = tumble < 1;
  }

  // The pill with the count, on the hatch while the cage is shut
  drawLabel(part, record, cage, age, k) {
    part.label.visible = age < 0 && record.left > 0;
    if (!part.label.visible) {
      return;
    }
    const wide = MODEL_WIDE * k * LABEL_WIDE;
    part.label.scale.set(wide, wide, 1);
    part.label.position.copy(part.group.position);
    part.label.position.y += this.labelHeight * k * part.group.scale.y + LABEL_LIFT;
    if (cage.shown !== record.left) {
      cage.shown = record.left;
      this.paintLabel(part, record.left);
    }
  }

  // The pill's number, redrawn only when it changed
  paintLabel(part, count) {
    const g = part.canvas.getContext("2d");
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
    part.map.needsUpdate = true;
  }
}

// Load the cage prefab and add a pool of cages to the scene
export async function create(scene) {
  const gltf = await new GLTFLoader().loadAsync(MODEL);
  const pieces = piecesOf(gltf);
  const hinges = [pieces.Hinge_1_1, pieces.Hinge_2_2].map((geometry) => new THREE.Box3().setFromBufferAttribute(geometry.attributes.position));
  const slabBox = new THREE.Box3().setFromBufferAttribute(pieces.DoorBase_4.attributes.position);
  const baseBox = new THREE.Box3().setFromBufferAttribute(pieces.Base_0.attributes.position);
  const pivot = [(hinges[0].min.x + hinges[0].max.x + hinges[1].min.x + hinges[1].max.x) / 4, baseBox.max.y];
  const parts = [];
  for (let i = 0; i < CAPACITY; i++) {
    const group = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.45, metalness: 0.25 });
    const hinge = new THREE.MeshStandardMaterial({ color: HINGE, roughness: 0.4, metalness: 0.3 });
    const slab = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.35, metalness: 0.1 });
    const plate = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.3, metalness: 0.1 });
    const base = new THREE.Group();
    base.add(new THREE.Mesh(pieces.Base_0, steel));
    base.add(new THREE.Mesh(pieces.Hinge_1_1, hinge), new THREE.Mesh(pieces.Hinge_2_2, hinge));
    const hatch = new THREE.Group();
    hatch.add(new THREE.Mesh(pieces.DoorBase_4, slab), new THREE.Mesh(pieces.Door_3, plate));
    // The hatch swings about its hinge line: its meshes are shifted so that line is the group's origin
    for (const mesh of hatch.children) {
      mesh.position.set(-pivot[0], -pivot[1], 0);
    }
    group.add(base, hatch);
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
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, depthTest: false }),
    );
    label.rotation.x = -Math.PI / 2;
    label.renderOrder = 6;
    label.visible = false;
    scene.add(label);
    parts.push({ group, base, hatch, slab, plate, paint: new THREE.Color(), canvas, map, label });
  }
  const look = new SlotCageLook(parts, pieces, pivot);
  look.labelHeight = slabBox.max.y;
  return look;
}
