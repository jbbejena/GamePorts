// Feature 33, the Conveyor Wall: a block across the belt with a top of the wall's color and a white pill counting the
// pigs of that color still to pass (the prefab `models/features/conveyor_door_feature.glb`: a steel base on the belt
// and a block in two parts that slides down into it; it has no materials, so the paint is the look's own). The walls
// rise out of the belt one after another as the level starts (ConveyorDoorFeature revealStartDelay and
// revealStaggerDelay, ConveyorDoorModel revealRiseDuration). The block slides down while a pig the wall lets through
// rides toward it, from 2 units before the wall until 0.8 past it (approachOpenWorldDistance, passClearWorldDistance,
// passageToggleDuration). A pig of its color passing punches the pill and flashes the glow ring under the wall
// (`art/ui/Conveyor_Door_Ring_Glow.png`); a pig thrown off makes the wall flinch and tilt (rejectFlinch*, rejectTilt*)
// while the pig flies to its slot (fx.js). When the wall opens its block slams down, holds and the whole wall shrinks
// away (breakSlamDuration, breakHoldDuration, openDuration). The sounds are ConveyorDoorFxModel's players. Everything
// comes from the simulation's wall records (sim/features/conveyor_wall.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { COLORS } from "../picture.js";
import { play as sound } from "../sound.js";
import { point } from "../sim/belt.js";
import { NUMBER } from "../sim/features/conveyor_wall.js";
import { L_PER_UNIT } from "../sim/numbers.js";
import { batchOf } from "../sim/places.js";
import { worldFromPicture } from "../space.js";

export { NUMBER };

const MODEL = "models/features/conveyor_door_feature.glb";
const GLOW = "art/ui/Conveyor_Door_Ring_Glow.png";
// The most walls one level holds is 20
const CAPACITY = 20;
// The block slides this far down into the base when it lowers, in model units, taking PASSAGE_TICKS for the whole way
const LOWER_BY = 0.86;
const PASSAGE_TICKS = 9;
// A pig the wall lets through lowers it from this far before the wall until this far past it (L)
const APPROACH = 2 * L_PER_UNIT;
const CLEAR = 0.8 * L_PER_UNIT;
// The reveal: the first wall starts rising REVEAL_DELAY ticks into the level, each next one REVEAL_STAGGER later,
// each taking REVEAL_TICKS
const REVEAL_DELAY = 12;
const REVEAL_STAGGER = 12;
const REVEAL_TICKS = 15;
// A pig thrown off: the wall flinches back and forth along the belt and tilts, both shaking out
const FLINCH_TICKS = 10;
const FLINCH_DISTANCE = 0.08;
const FLINCH_SHAKES = 4;
const TILT_TICKS = 12;
const TILT_ANGLE = (4 * Math.PI) / 180;
const TILT_SHAKES = 3;
// A pig passing punches the pill this much bigger over PUNCH_TICKS
const PUNCH_TICKS = 15;
const PUNCH_SCALE = 0.6;
// The glow ring under the wall: how big it is, how bright it rests and how long a pass or a throw flashes it
const GLOW_SIZE = 1.6;
const GLOW_REST = 0.35;
const FLASH_TICKS = 13;
// Opening: the block slams down, the wall holds, then shrinks away
const SLAM_TICKS = 9;
const HOLD_TICKS = 21;
const SHRINK_TICKS = 18;
// The count's pill above the block
const LABEL_W = 128;
const LABEL_H = 80;
const LABEL_FONT = '"Inter Black", "Segoe UI", sans-serif';
const LABEL_INK = "#2b3a6b";
const LABEL_SHARE = 0.8;
const LABEL_WIDE = 0.55;
const LABEL_LIFT = 0.05;
// Painting: the steel of the base and the gray of the block under its colored top
const STEEL = 0x6f78ad;
const BLOCK = 0xb9c2e4;
// The tangent is measured over this stretch of the lap either side of the wall (L)
const TANGENT_SPAN = 60;

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

function easeOutCubic(u) {
  return 1 - (1 - u) ** 3;
}

function easeInCubic(u) {
  return u ** 3;
}

// The prefab's pieces with their node transforms baked in
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

class ConveyorWallLook {
  constructor(parts, top) {
    this.parts = parts;
    this.surface = 0;
    this.top = top;
    this.now = 0;
    this.mine = null;
    // Per wall: how far its block is lowered (0 to 1), toward where and when it last moved, when it was last passed,
    // thrown and opened, and the count its pill shows
    this.walls = [];
  }

  build(state) {
    this.clear();
    this.mine = state.features[NUMBER] || null;
    this.now = state.tick;
    if (!this.mine) {
      return;
    }
    this.surface = state.beltPath.height / L_PER_UNIT;
    this.mine.walls.slice(0, CAPACITY).forEach((wall, index) => {
      this.place(this.parts[index], state, wall.pos);
      this.walls.push({
        lowered: 0,
        down: false,
        slidAt: this.now,
        passAt: -Infinity,
        rejectAt: -Infinity,
        opened: wall.open ? -Infinity : null,
        shown: null,
      });
    });
  }

  clear() {
    this.mine = null;
    this.walls = [];
    for (const part of this.parts) {
      part.group.visible = false;
      part.label.visible = false;
      part.glow.visible = false;
    }
  }

  // Stand a wall on the belt at lap position `pos`, facing along the belt
  place(part, state, pos) {
    const [x, y] = point(state, pos);
    const [ax, ay] = point(state, Math.max(0, pos - TANGENT_SPAN));
    const [bx, by] = point(state, Math.min(state.beltPath.end, pos + TANGENT_SPAN));
    const at = worldFromPicture(x, y, this.surface);
    part.base.copy(at);
    // The model faces +z; along the belt in the scene is (dx, -dy)
    part.yaw = Math.atan2(bx - ax, -(by - ay));
    part.forward.set(Math.sin(part.yaw), 0, Math.cos(part.yaw));
    part.glow.position.set(at.x, this.surface + 0.01, at.z);
  }

  onEvents(events) {
    for (const event of events) {
      const wall = this.mine ? this.walls[event.wall] : null;
      if (!wall) {
        continue;
      }
      if (event.k === "wall_pass") {
        wall.passAt = event.t;
        sound("wall_pass");
      } else if (event.k === "wall_reject") {
        wall.rejectAt = event.t;
        sound("wall_reject");
      } else if (event.k === "wall_open") {
        wall.opened = event.t;
        sound("wall_open");
      }
    }
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
    if (!this.mine) {
      return;
    }
    this.parts.forEach((part, index) => this.draw(part, index, state));
  }

  // A pig the wall would let through rides within reach of it
  approaching(state, record) {
    for (const tray of state.belt) {
      if (!tray.started || tray.pos < record.pos - APPROACH || tray.pos > record.pos + CLEAR) {
        continue;
      }
      const pig = state.pigs[tray.pig];
      if (batchOf(state, pig).some((id) => state.pigs[id].place !== "gone" && state.pigs[id].color === record.color)) {
        return true;
      }
    }
    return false;
  }

  // Slide the block toward lowered or raised, with the sound of the move when it turns
  slide(state, record, wall) {
    const down = !record.open && this.approaching(state, record);
    if (down !== wall.down) {
      wall.down = down;
      sound(down ? "wall_down" : "wall_up");
    }
    const step = clamp01((this.now - wall.slidAt) / PASSAGE_TICKS);
    wall.slidAt = this.now;
    wall.lowered = down ? Math.min(1, wall.lowered + step) : Math.max(0, wall.lowered - step);
  }

  draw(part, index, state) {
    const record = this.mine.walls[index];
    const wall = this.walls[index];
    if (!record || !wall) {
      part.group.visible = false;
      part.label.visible = false;
      part.glow.visible = false;
      return;
    }
    const age = wall.opened === null ? -1 : this.now - wall.opened;
    if (age > SLAM_TICKS + HOLD_TICKS + SHRINK_TICKS) {
      part.group.visible = false;
      part.label.visible = false;
      part.glow.visible = false;
      return;
    }
    this.slide(state, record, wall);
    const rise = easeOutCubic(clamp01((this.now - REVEAL_DELAY - REVEAL_STAGGER * index) / REVEAL_TICKS));
    let lowered = 1 - rise * (1 - wall.lowered);
    let size = 1;
    if (age >= 0) {
      lowered = Math.max(wall.lowered, easeInCubic(clamp01(age / SLAM_TICKS)));
      size = 1 - easeInCubic(clamp01((age - SLAM_TICKS - HOLD_TICKS) / SHRINK_TICKS));
    }
    const flinch = clamp01((this.now - wall.rejectAt) / FLINCH_TICKS);
    const back = flinch < 1 ? FLINCH_DISTANCE * Math.sin(Math.PI * FLINCH_SHAKES * flinch) * (1 - flinch) : 0;
    const tiltU = clamp01((this.now - wall.rejectAt) / TILT_TICKS);
    const tilt = tiltU < 1 ? TILT_ANGLE * Math.sin(Math.PI * TILT_SHAKES * tiltU) * (1 - tiltU) : 0;
    part.group.visible = size > 0.001;
    part.group.position.copy(part.base).addScaledVector(part.forward, back);
    part.group.rotation.set(0, part.yaw, 0, "YXZ");
    part.group.rotateX(tilt);
    part.group.scale.setScalar(Math.max(0.001, size));
    part.block.position.y = -LOWER_BY * lowered;
    part.top.color.copy(COLORS[record.color]);
    this.drawGlow(part, record, wall, size);
    this.drawLabel(part, record, wall, size, lowered, age);
  }

  // The glow ring in the wall's color, flaring as a pig passes or is thrown off
  drawGlow(part, record, wall, size) {
    const flash = Math.max(0, 1 - (this.now - Math.max(wall.passAt, wall.rejectAt)) / FLASH_TICKS);
    part.glow.visible = size > 0.001;
    part.glow.material.color.copy(COLORS[record.color]);
    part.glow.material.opacity = (GLOW_REST + (1 - GLOW_REST) * Math.min(1, flash)) * size;
    part.glow.scale.setScalar(GLOW_SIZE * size);
  }

  // The pill with the count above the block, punched as a pig passes
  drawLabel(part, record, wall, size, lowered, age) {
    part.label.visible = age < 0 && record.health > 0 && size > 0.5;
    if (!part.label.visible) {
      return;
    }
    const punch = clamp01((this.now - wall.passAt) / PUNCH_TICKS);
    const grow = punch < 1 ? 1 + PUNCH_SCALE * Math.sin(Math.PI * punch) * (1 - punch) : 1;
    const wide = LABEL_WIDE * size * grow;
    part.label.scale.set(wide, wide, 1);
    part.label.position.copy(part.group.position);
    part.label.position.y += (this.top - LOWER_BY * lowered) * size + LABEL_LIFT;
    if (wall.shown !== record.health) {
      wall.shown = record.health;
      this.paintLabel(part, record.health);
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

function makeLabel(scene) {
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
  return { canvas, map, label };
}

function makeGlow(scene, texture) {
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.renderOrder = 2;
  glow.visible = false;
  scene.add(glow);
  return glow;
}

// Load the wall prefab and the glow, and add a pool of walls to the scene
export async function create(scene) {
  const [gltf, texture] = await Promise.all([
    new GLTFLoader().loadAsync(MODEL),
    new THREE.TextureLoader().loadAsync(GLOW),
  ]);
  texture.colorSpace = THREE.SRGBColorSpace;
  const pieces = piecesOf(gltf);
  const topBox = new THREE.Box3().setFromBufferAttribute(pieces.Model_Move_Color_2.attributes.position);
  const parts = [];
  for (let i = 0; i < CAPACITY; i++) {
    const group = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.45, metalness: 0.25 });
    const gray = new THREE.MeshStandardMaterial({ color: BLOCK, roughness: 0.4, metalness: 0.1 });
    const top = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1 });
    const block = new THREE.Group();
    block.add(new THREE.Mesh(pieces.Model_Move_Gray_1, gray), new THREE.Mesh(pieces.Model_Move_Color_2, top));
    group.add(new THREE.Mesh(pieces.Model_Base_0, steel), block);
    group.visible = false;
    scene.add(group);
    const glow = makeGlow(scene, texture);
    parts.push({
      group,
      block,
      top,
      glow,
      base: new THREE.Vector3(),
      forward: new THREE.Vector3(0, 0, 1),
      yaw: 0,
      ...makeLabel(scene),
    });
  }
  return new ConveyorWallLook(parts, topBox.max.y);
}
