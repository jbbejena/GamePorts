// A touch presentation of Hud/Orders, using their existing selection and request
// paths. All resources, cooldowns, health and available orders remain projections
// of the server's battle. No gameplay or progression state is owned here.
import { clockText, unitWords } from "./hud.js";
import { orderWords } from "./orders.js";
import { openUpgrades } from "./upgrades.js";

const $ = (id) => document.getElementById(id);
const SIDES = ["british", "german"];
function text(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

export class MobileControls {
  constructor(page) {
    this.page = page;
    this.active = false;
    this.saved = new Map();
    this.squadSignature = null;
    this.box = $("mobile-controls");
    $("mobile-menu").addEventListener("click", () => page.field.panels.openMenu());
    $("mobile-players").addEventListener("click", () => document.querySelector("#people button")?.click());
    $("mobile-upgrades").addEventListener("click", () => openUpgrades({ inBattle: true }));
    $("mobile-cancel").addEventListener("click", () => page.field.orders.cancel());
    $("mobile-deploy").addEventListener("click", () => page.field.orders.deselect());
    $("mobile-squads").addEventListener("change", (event) => {
      const id = Number(event.target.value);
      if (event.target.value) page.field.orders.select(id);
    });
    this.units = Array.from({ length: 8 }, (_, index) => this.button("mobile-units", () => {
      const entry = page.field.hud.units[index];
      if (entry) page.field.hud.press(entry);
    }));
    this.lanes = ["Top lane", "Middle lane", "Bottom lane"].map((name, index) => {
      const button = this.button("mobile-lanes", () => page.field.hud.deployLane(index + 1));
      button.textContent = name;
      return button;
    });
    this.orders = Array.from({ length: 4 }, (_, index) => this.button("mobile-orders", () => page.field.orders.press(index)));
    page.field.onDraw(() => this.draw());
    page.field.onClear(() => this.setActive(false));
    new ResizeObserver(() => this.measure()).observe(this.box);
  }

  button(parent, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", action);
    $(parent).append(button);
    return button;
  }

  measure() {
    document.body.style.setProperty("--controls-height", `${this.active ? this.box.getBoundingClientRect().height : 0}px`);
    this.page.fit?.();
  }

  setActive(active) {
    if (this.active === active) return;
    this.active = active;
    this.box.hidden = !active;
    document.body.toggleAttribute("data-mobile-battle", active);
    if (!active) {
      for (const [child, renderable] of this.saved) {
        if (!child.destroyed) child.renderable = renderable;
      }
      this.saved.clear();
      if (this.page.field.hud.clip) this.page.field.hud.clip.eventMode = "auto";
    }
    this.measure();
  }

  draw() {
    const page = this.page;
    const field = page.field;
    const hud = field.hud;
    const orders = field.orders;
    const active = Boolean(page.graphics?.compact && page.screen === "battle" && hud.interactive && hud.clip?.visible &&
      !field.waiting && !field.ending && !field.result && !field.panels.menu &&
      !page.find("loadScreen") && !page.find("upgradesOverlay"));
    this.setActive(active);
    if (!active) return;
    // Keep the original ground/morale bars and clock above the battlefield.
    // The small portrait/intel controls are replaced by the touch dock below it.
    hud.clip.eventMode = "none";
    for (const child of hud.clip.children) {
      if (!this.saved.has(child)) this.saved.set(child, child.renderable);
      child.renderable = ["progressBar", "timer"].includes(child.label) || child === hud.missionClock;
    }
    const blocked = !page.conn || Boolean(page.recovery?.kind) || field.paused;
    text($("mobile-resources"), `${hud.last?.rp ?? 0} RP`);
    text($("mobile-clock"), `${field.paused ? "Paused · " : ""}${clockText(hud.last?.seconds ?? 0)}`);
    $("mobile-menu").disabled = !page.conn;
    $("mobile-upgrades").hidden = hud.xp === null;
    $("mobile-upgrades").disabled = blocked;
    text($("mobile-upgrades"), `Upgrades (${hud.xp?.points ?? 0})`);

    const deploying = hud.deployMode !== null;
    const selected = orders.selected !== null;
    $("mobile-units").hidden = deploying || selected;
    $("mobile-lanes").hidden = !deploying;
    $("mobile-orders").hidden = deploying || !selected;
    $("mobile-cancel").hidden = !deploying && !orders.aiming;
    $("mobile-deploy").hidden = !selected || orders.aiming;
    $("mobile-squads").hidden = deploying || orders.aiming;

    this.units.forEach((button, index) => {
      const unit = hud.units[index];
      const words = unitWords(hud.side, index);
      const cost = hud.battle.costs[hud.side][index];
      button.hidden = !unit?.unlocked;
      button.disabled = blocked || !unit?.ready;
      text(button, `${words.name}\n${unit?.ready ? `${cost} RP` : "Resupplying…"}`);
      button.title = words.desc;
    });
    this.lanes.forEach((button, index) => {
      button.disabled = blocked || hud.blocked(index + 1);
      button.title = hud.blocked(index + 1) ? "Tanks need a lane without cover." : "";
    });
    this.orders.forEach((button, index) => {
      const order = orders.buttons[index];
      button.hidden = !order;
      button.disabled = blocked || Boolean(order?.disabled);
      if (order) text(button, orderWords(order.action));
      button.setAttribute("aria-pressed", String(Boolean(order && orders.aim?.button === order.action)));
    });
    let instruction = "Choose a unit to deploy, or select one of your squads. Drag the field to pan.";
    if (deploying) {
      const words = unitWords(hud.side, hud.deployMode - 1);
      instruction = `${words.name}: ${words.desc} Choose a lane.`;
    } else if (orders.aiming) {
      instruction = "Tap a target on the field, then tap its marker to confirm. Drag to pan.";
    } else if (selected) {
      instruction = `${$("mobile-squads").selectedOptions[0]?.textContent ?? "Squad selected"}. ${orders.shown.state ?? ""}`;
    }
    text($("mobile-instruction"), instruction);

    const rows = field.snaps[0]?.s.q.filter(row => SIDES[row[1]] === hud.side && row[2] <= 8) ?? [];
    const choices = rows.map(row => [row[0], `${unitWords(hud.side, row[2] - 1).name} · ${field.units.health(row[0]) ?? 0}%`]);
    const signature = JSON.stringify(choices);
    if (signature !== this.squadSignature) {
      this.squadSignature = signature;
      const options = [new Option("Select squad", ""), ...choices.map(([id, name]) => new Option(name, String(id)))];
      $("mobile-squads").replaceChildren(...options);
    }
    $("mobile-squads").value = orders.selected === null ? "" : String(orders.selected);
    $("mobile-squads").disabled = blocked || !choices.length;
  }
}
