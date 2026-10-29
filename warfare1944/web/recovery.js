// Recovery sends only existing, idempotent pause requests. It never replays
// deployments, orders, campaign creation or purchases after an uncertain reply.
export class Recovery {
  constructor(page, reconnect) {
    this.page = page;
    this.reconnect = reconnect;
    this.kind = null;
    this.artFailed = false;
    this.box = document.getElementById("recovery");
    this.title = document.getElementById("recovery-title");
    this.line = document.getElementById("recovery-line");
    this.primary = document.getElementById("recovery-primary");
    this.primary.addEventListener("click", () => this.act());
    this.box.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const buttons = [...this.box.querySelectorAll("button:not(:disabled)")];
      if (event.shiftKey && document.activeElement === buttons[0]) {
        event.preventDefault();
        buttons.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
        event.preventDefault();
        buttons[0].focus();
      }
    });
    document.getElementById("recovery-menu").addEventListener("click", () => {
      if (page.battle && !page.send(page.battle.you === null ? { unwatch: true } : { quit: true })) {
        this.line.textContent = "Reconnect first to leave this battle safely.";
        return;
      }
      if (this.kind === "graphics" || !page.app) {
        location.reload();
      } else {
        this.hide();
        page.battle = null;
        page.show("main");
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.interrupted();
    });
    window.addEventListener("pagehide", () => this.interrupted());
    window.addEventListener("blur", () => page.field.cancelInput());
  }

  pause() {
    const battle = this.page.battle;
    this.page.field.cancelInput();
    if (battle?.you && battle.kind !== "versus" && !battle.result) this.page.send({ pause: true });
  }

  interrupted() {
    if (this.page.screen !== "battle" || !this.page.battle || this.page.battle.result) return;
    this.pause();
    this.show("resume");
  }

  artworkFailed(error) {
    console.warn("Warfare 1944 artwork download failed", error);
    this.artFailed ||= this.page.screen === "battle";
    this.pause();
  }

  artworkReady() {
    if (this.artFailed && this.page.screen === "battle" && !this.page.field.ending) {
      this.artFailed = false;
      this.page.field.panels.openMenu();
    }
  }

  show(kind) {
    if (this.kind === kind) return;
    if (this.kind === "graphics" && kind !== "graphics") return;
    this.kind = kind;
    this.box.hidden = false;
    const solo = this.page.battle?.you && this.page.battle.kind !== "versus";
    const words = {
      graphics: ["Graphics interrupted", "Reload to restore the picture. Your campaign remains saved; a live solo battle pauses while disconnected.", "Reload game"],
      startup: ["Couldn’t connect", "The game server may be waking up. Check your connection and try again.", "Retry"],
      connection: ["Connection lost", "Reconnecting to the battle server. Orders are available again when it responds.", "Reconnect"],
      resume: ["Welcome back", solo ? "Your solo battle has been asked to pause. Resume when you’re ready." : "This live battle continued while you were away.", solo ? "Resume battle" : "Return to battle"],
    };
    const [title, line, action] = words[kind];
    this.title.textContent = title;
    this.line.textContent = line;
    this.primary.textContent = action;
    this.primary.focus({ preventScroll: true });
  }

  connected() {
    if (this.kind === "connection") this.hide();
  }

  hide() {
    this.kind = null;
    this.box.hidden = true;
  }

  act() {
    if (this.kind === "graphics" || this.kind === "startup") {
      location.reload();
    } else if (this.kind === "connection") {
      this.reconnect();
    } else if (this.kind === "resume") {
      if (!this.page.field.panels.menu && this.page.battle?.you && this.page.battle.kind !== "versus" && !this.page.send({ pause: false })) {
        this.show("connection");
        return;
      }
      this.page.field.cancelInput();
      this.hide();
    }
  }
}
