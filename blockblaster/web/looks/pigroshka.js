// Feature 31, the Pigroshka: the outermost cat doll stands on its square of the picture, a squat doll (about 0.4 as tall
// as it is wide, MatryoshkaModel `height`) painted the color of its layer, with a white pill at its front edge counting
// the hits it still takes. The dolls are the new `models/matryoshka_doll.glb` (dress and collar tinted, cat face) and its
// open bottom half `models/matryoshka_shell.glb`. A hit punches the doll (a 5 percent swell for 0.2 s, hitPunchStrength
// and hitPunchDuration). When a layer dies its doll jumps off its shell, spins and shrinks away, the shell shrinks a
// moment later (capFlyDuration, openBodyShrinkDelay), and the next doll inside, a smaller one on the shrunken square,
// hops out of the shell and lands with a squash (emergeDuration, emergeLandSquash); the last layer's doll flies off and
// leaves the square empty. The sounds are the prefabs' (Matryoshka hit, open and emerge players). Where the doll flies,
// its height and the spin are the look's own. Everything comes from the simulation's doll records
// (sim/features/pigroshka.js) and never changes a rule.
import * as THREE from "../vendor/three.module.min.js";
import { mergeGeometries } from "../vendor/BufferGeometryUtils.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { COLORS } from "../picture.js";
import { play as sound } from "../sound.js";
import { NUMBER } from "../sim/features/pigroshka.js";
import { L_PER_UNIT } from "../sim/numbers.js";

export { NUMBER };

const DOLL_MODEL = "models/matryoshka_doll.glb";
const SHELL_MODEL = "models/matryoshka_shell.glb";
// The most dolls one level holds is 8 and the most flights (a lid flying off, a shell shrinking) at once is 3 a doll
const DOLLS = 8;
const FLIGHTS = 14;
// The doll model is this wide and this tall; the shell this wide and this tall
const DOLL_WIDE = 0.92;
const DOLL_HIGH = 1.85;
const SHELL_WIDE = 1.0;
const SHELL_HIGH = 0.55;
// A doll fills this share of its square's width, and stands this tall against its width (MatryoshkaModel `height`)
const FIT = 0.96;
const SQUAT = 0.4;
// A hit swells the doll this much over this many ticks
const PUNCH = 0.05;
const PUNCH_TICKS = 12;
// The next doll shows at this share of its size until it hops out after EMERGE_DELAY ticks, hops for HOP_TICKS rising this
// share of its width, grows to full size over GROW_TICKS and lands with a squash lasting SQUASH_TICKS
const EMERGE_FROM = 0.9;
const EMERGE_DELAY = 6;
const HOP_TICKS = 18;
const HOP_RISE = 0.22;
const GROW_TICKS = 21;
const SQUASH_TICKS = 11;
const SQUASH = 0.2;
// The doll that opened: it flies for FLY_TICKS rising this share of its width, spinning TURNS times, drifting this share
// of its width, and shrinks after SHRINK_DELAY over SHRINK_TICKS; the shell stays SHELL_STAYS ticks and then shrinks over
// SHELL_SHRINK
const FLY_TICKS = 72;
const FLY_RISE = 0.9;
const TURNS = 2;
const FLY_DRIFT = 0.9;
const SHRINK_DELAY = 12;
const SHRINK_TICKS = 40;
const SHELL_STAYS = 36;
const SHELL_SHRINK = 6;
// The count's pill at the doll's front edge
const LABEL_W = 128;
const LABEL_H = 80;
const LABEL_FONT = '"Inter Black", "Segoe UI", sans-serif';
const LABEL_INK = "#4a2a52";
const LABEL_SHARE = 0.8;
const LABEL_WIDE = 0.2;
const LABEL_MIN = 0.7;
const LABEL_LIFT = 0.4;
// Painting: the collar and ears are the layer's color lifted toward white; the shell is a shade darker than the dress
const ACCENT_LIFT = 0.45;
const SHELL_SHADE = 0.8;

const paint = new THREE.Color();
const white = new THREE.Color(0xffffff);

function clamp01(u) {
  return Math.min(1, Math.max(0, u));
}

function easeOutCubic(u) {
  return 1 - (1 - u) ** 3;
}

function easeInCubic(u) {
  return u ** 3;
}

// The doll model in three merged geometries with its node transforms baked in: the fixed-color parts (their colors baked
// into vertex colors), the tinted dress and the tinted collar and ears
function dollGeometries(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const fixed = [];
  const dress = [];
  const accent = [];
  gltf.scene.traverse((node) => {
    if (!node.isMesh) {
      return;
    }
    const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
    geometry.deleteAttribute("uv");
    if (node.name.startsWith("Tint_Dress")) {
      dress.push(geometry);
    } else if (node.name.startsWith("Tint_")) {
      accent.push(geometry);
    } else {
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      const { color } = node.material;
      for (let i = 0; i < geometry.attributes.position.count; i++) {
        colors.set([color.r, color.g, color.b], i * 3);
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      fixed.push(geometry);
    }
  });
  return { fixed: mergeGeometries(fixed), dress: mergeGeometries(dress), accent: mergeGeometries(accent) };
}

// The shell as one geometry with its node transform baked in
function shellGeometry(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const found = [];
  gltf.scene.traverse((node) => {
    if (node.isMesh) {
      const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
      geometry.deleteAttribute("uv");
      found.push(geometry);
    }
  });
  return mergeGeometries(found);
}

// One doll: its three painted parts in a group
function makeDoll(scene, geometries) {
  const group = new THREE.Group();
  const materials = {
    fixed: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }),
    dress: new THREE.MeshStandardMaterial({ color: paint, roughness: 0.4 }),
    accent: new THREE.MeshStandardMaterial({ color: paint, roughness: 0.4 }),
  };
  for (const name of Object.keys(materials)) {
    group.add(new THREE.Mesh(geometries[name], materials[name]));
  }
  group.visible = false;
  scene.add(group);
  return { group, materials };
}

function makeShell(scene, geometry) {
  const material = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.4, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, material };
}

// Paint a doll's tinted parts for a layer color
function dye(doll, color) {
  doll.materials.dress.color.copy(color);
  doll.materials.accent.color.copy(color).lerp(white, ACCENT_LIFT);
}

class PigroshkaLook {
  constructor(dolls, flights, shells, labels) {
    this.dolls = dolls;
    this.flights = flights;
    this.shells = shells;
    this.labels = labels;
    this.now = 0;
    this.mine = null;
    this.cell = 0;
    // Per doll: the standing layer's place the last time it was drawn, when it was last hit, when its next layer started to
    // emerge and the count its pill shows
    this.records = [];
    // The lids and shells in the air: {t0, doll, x, z, wide, color, drift}
    this.air = [];
    // Target id to doll index
    this.owner = new Map();
    this.seq = 0;
  }

  build(state) {
    this.clear();
    this.mine = state.features[NUMBER] || null;
    this.now = state.tick;
    if (!this.mine) {
      return;
    }
    this.cell = state.grid.size / L_PER_UNIT;
    this.mine.dolls.slice(0, DOLLS).forEach((doll, index) => {
      this.records.push({ last: null, hitAt: -Infinity, emergeAt: -Infinity, shown: null });
      for (const id of doll.layers) {
        this.owner.set(id, index);
      }
    });
  }

  clear() {
    this.mine = null;
    this.records = [];
    this.air = [];
    this.owner.clear();
    for (const doll of this.dolls) {
      doll.group.visible = false;
    }
    for (const flight of this.flights) {
      flight.group.visible = false;
    }
    for (const shell of this.shells) {
      shell.mesh.visible = false;
    }
    for (const label of this.labels) {
      label.mesh.visible = false;
    }
  }

  onEvents(events, state) {
    for (const event of events) {
      if (!this.mine) {
        return;
      }
      if (event.k === "hit" && event.cell >= 0 && event.health > 0 && this.owner.has(event.target)) {
        this.records[this.owner.get(event.target)].hitAt = event.t;
        sound("doll_hit");
      } else if (event.k === "doll_open") {
        this.release(event.doll, event.from, event.t, state);
        this.records[event.doll].emergeAt = event.t;
        sound("doll_open");
        sound("doll_emerge");
      } else if (event.k === "doll_gone") {
        this.release(event.doll, event.target, event.t, state);
        sound("doll_open");
      }
    }
  }

  // The layer that died lifts off as it stood: its lid flies and its shell shrinks
  release(index, targetId, t, state) {
    const record = this.records[index];
    if (!record || !record.last) {
      return;
    }
    this.seq += 1;
    this.air.push({
      t0: t,
      ...record.last,
      color: COLORS[state.grid.targets[targetId].color].clone(),
      drift: this.seq % 2 === 0 ? -1 : 1,
    });
  }

  frame(alpha, state) {
    this.now = state.tick - 1 + alpha;
    if (!this.mine) {
      return;
    }
    this.mine.dolls.slice(0, DOLLS).forEach((doll, index) => this.drawStanding(index, doll, state));
    this.drawAir();
  }

  // The square the standing layer covers: its center in the world and its side in cells
  placeOf(state, doll) {
    const target = state.grid.targets[doll.layers[doll.current]];
    const { grid } = state;
    const xs = target.cells.map((c) => c % grid.width);
    const ys = target.cells.map((c) => Math.floor(c / grid.width));
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const wide = (maxX - minX + 1) * this.cell;
    return {
      x: ((minX + maxX) / 2 - (grid.width - 1) / 2) * this.cell,
      z: -((minY + maxY) / 2 - (grid.height - 1) / 2) * this.cell,
      wide,
    };
  }

  drawStanding(index, doll, state) {
    const part = this.dolls[index];
    const record = this.records[index];
    const label = this.labels[index];
    const target = doll.current >= 0 ? state.grid.targets[doll.layers[doll.current]] : null;
    if (!target || !target.cells.length) {
      part.group.visible = false;
      label.mesh.visible = false;
      return;
    }
    const at = this.placeOf(state, doll);
    const color = COLORS[target.color];
    record.last = { x: at.x, z: at.z, wide: at.wide, color: color.clone() };
    const punch = clamp01((this.now - record.hitAt) / PUNCH_TICKS);
    let swell = 1 + (punch < 1 ? PUNCH * Math.sin(Math.PI * punch) : 0);
    let rise = 0;
    let squash = 0;
    const e = this.now - record.emergeAt - EMERGE_DELAY;
    if (e < GROW_TICKS + SQUASH_TICKS && this.now >= record.emergeAt) {
      const grow = easeOutCubic(clamp01(e / GROW_TICKS));
      swell *= EMERGE_FROM + (1 - EMERGE_FROM) * grow;
      const hop = clamp01(e / HOP_TICKS);
      rise = e > 0 ? HOP_RISE * 4 * hop * (1 - hop) * at.wide : 0;
      const land = (e - HOP_TICKS) / SQUASH_TICKS;
      squash = land > 0 && land < 1 ? SQUASH * Math.sin(Math.PI * land) : 0;
    }
    const wide = (at.wide * FIT * swell * (1 + squash * 0.5)) / DOLL_WIDE;
    const high = ((at.wide * FIT * SQUAT * swell * (1 - squash)) / DOLL_HIGH) * 1;
    part.group.visible = true;
    part.group.position.set(at.x, rise, at.z);
    part.group.scale.set(wide, high, wide);
    dye(part, color);
    this.drawLabel(label, record, target, at);
  }

  // The count at the doll's front edge
  drawLabel(label, record, target, at) {
    label.mesh.visible = true;
    const wide = Math.max(this.cell * LABEL_MIN * 2.2, at.wide * LABEL_WIDE);
    label.mesh.scale.set(wide, wide, 1);
    label.mesh.position.set(at.x, LABEL_LIFT * this.cell * 2, at.z + at.wide / 2);
    if (record.shown !== target.health) {
      record.shown = target.health;
      this.paintLabel(label, target.health);
    }
  }

  paintLabel(label, count) {
    const g = label.canvas.getContext("2d");
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
    label.map.needsUpdate = true;
  }

  // The lids in the air and the shells shrinking, in the order they started
  drawAir() {
    this.air = this.air.filter((one) => this.now - one.t0 < FLY_TICKS);
    this.flights.forEach((flight, i) => {
      const shell = this.shells[i];
      const one = this.air[i];
      if (!one) {
        flight.group.visible = false;
        shell.mesh.visible = false;
        return;
      }
      const age = Math.max(0, this.now - one.t0);
      const u = age / FLY_TICKS;
      const fit = (one.wide * FIT) / DOLL_WIDE;
      const flat = (one.wide * FIT * SQUAT) / DOLL_HIGH;
      const shrink = 1 - easeInCubic(clamp01((age - SHRINK_DELAY) / SHRINK_TICKS));
      flight.group.visible = shrink > 0.001;
      flight.group.position.set(
        one.x + one.drift * FLY_DRIFT * one.wide * easeOutCubic(u),
        FLY_RISE * one.wide * 4 * u * (1 - u),
        one.z + 0.5 * FLY_DRIFT * one.wide * easeOutCubic(u),
      );
      flight.group.rotation.set(TURNS * 2 * Math.PI * easeOutCubic(u), 0, 0);
      flight.group.scale.set(fit * shrink, flat * shrink, fit * shrink);
      dye(flight, one.color);
      const gone = easeInCubic(clamp01((age - SHELL_STAYS) / SHELL_SHRINK));
      shell.mesh.visible = gone < 1;
      shell.mesh.position.set(one.x, 0, one.z);
      const side = ((one.wide * FIT) / SHELL_WIDE) * (1 - gone);
      shell.mesh.scale.set(side, ((one.wide * FIT * SQUAT) / SHELL_HIGH) * (1 - gone), side);
      shell.material.color.copy(one.color).multiplyScalar(SHELL_SHADE);
    });
  }
}

// Load the doll and its shell, and add pools of standing dolls, flying lids, shells and pills to the scene
export async function create(scene) {
  const loader = new GLTFLoader();
  const [dollGltf, shellGltf] = await Promise.all([loader.loadAsync(DOLL_MODEL), loader.loadAsync(SHELL_MODEL)]);
  const dollGeo = dollGeometries(dollGltf);
  const shellGeo = shellGeometry(shellGltf);
  const dolls = Array.from({ length: DOLLS }, () => makeDoll(scene, dollGeo));
  const flights = Array.from({ length: FLIGHTS }, () => makeDoll(scene, dollGeo));
  const shells = Array.from({ length: FLIGHTS }, () => makeShell(scene, shellGeo));
  const labels = Array.from({ length: DOLLS }, () => {
    const canvas = document.createElement("canvas");
    canvas.width = LABEL_W;
    canvas.height = LABEL_H;
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, LABEL_H / LABEL_W),
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, depthTest: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 6;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, canvas, map };
  });
  return new PigroshkaLook(dolls, flights, shells, labels);
}
