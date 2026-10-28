// The standalone transport implements the small interface game.js uses from ActivityHub.
// The Python server runs battles; browser backups keep campaigns across free-host restarts.
// All requests use this page's own origin, both on a LAN and on an HTTPS host.
let hub;
const SAVE_FIELDS = ["side", "difficulty", "mission", "xp", "level", "points", "upgrades", "career", "finished"];

function backupKey(player) {
  return `warfare1944.campaign.${player.id}`;
}

function readBackup(player) {
  try {
    return JSON.parse(localStorage.getItem(backupKey(player)) || "null");
  } catch {
    return null;
  }
}

function keepBackup(player, save) {
  try {
    const value = Object.fromEntries(SAVE_FIELDS.map(key => [key, save[key]]));
    localStorage.setItem(backupKey(player), JSON.stringify(value));
  } catch (error) {
    console.warn("Warfare 1944 could not keep a browser save backup.", error);
  }
}

export async function connect() {
  if (hub) return hub;
  const response = await fetch("/local/session", { cache: "no-store" });
  if (!response.ok) throw new Error("The local server could not create a player profile.");
  const player = await response.json();
  const listeners = new Set();
  hub = {
    local: true,
    offline: false,
    player,
    people: [{ id: player.id, name: player.displayName, avatar: "", away: false }],
    status(text) {
      document.title = text ? `${text} · Warfare 1944` : "Warfare 1944";
    },
    busy() {},
    peopleButton() {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "local-invite";
      button.textContent = "↗";
      button.title = "Invite another player";
      button.setAttribute("aria-label", "Invite another player");
      button.addEventListener("click", () => hub.openPeople());
      return button;
    },
    async openPeople() {
      const url = player.joinUrl || location.origin + "/";
      if (navigator.share) {
        try {
          await navigator.share({ title: "Warfare 1944", url });
          return;
        } catch (error) {
          if (error.name === "AbortError") return;
        }
      }
      window.prompt(player.hosted ? "Send this link to another player:" : "Open this address on another device on the same Wi-Fi:", url);
    },
    onPeople(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    socket() {
      return new Promise((resolve, reject) => {
        const url = new URL("/local/socket", location.href);
        url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(url);
        const queued = [];
        let receive = null;
        let closed = null;
        let closeCode = null;
        let opened = false;
        let triedRestore = false;
        const connection = {
          send(message) {
            if (ws.readyState !== WebSocket.OPEN) return false;
            ws.send(JSON.stringify(message));
            return true;
          },
          on(listener) {
            receive = listener;
            for (const message of queued.splice(0)) receive(message);
          },
          onClose(listener) {
            closed = listener;
            if (closeCode !== null) closed(closeCode);
          },
          // game.js handles reconnection by asking for a fresh socket after onClose.
          onReconnecting() {},
          onReconnected() {},
        };
        ws.addEventListener("open", () => {
          opened = true;
          resolve(connection);
        });
        ws.addEventListener("message", (event) => {
          const data = JSON.parse(event.data);
          if (Object.hasOwn(data, "save")) {
            // Restore only when the server has no campaign. Existing server progress always wins.
            if (data.save === null && !triedRestore) {
              triedRestore = true;
              const backup = readBackup(player);
              if (backup) {
                connection.send({ restoreCampaign: backup });
                return;
              }
            }
            if (data.save) keepBackup(player, data.save);
          }
          if (data.localPeople) {
            hub.people = data.localPeople;
            for (const listener of listeners) listener(hub.people);
          } else if (receive) {
            receive(data);
          } else {
            queued.push(data);
          }
        });
        ws.addEventListener("close", (event) => {
          closeCode = event.code;
          if (opened) closed?.(event.code);
          else reject(Object.assign(new Error("Could not connect to the local game server."), { status: event.code }));
        });
        ws.addEventListener("error", () => {
          if (!opened) reject(new Error("Could not connect to the local game server."));
        });
      });
    },
  };
  return hub;
}

export function backToMenu() {
  // The standalone page has no outer launcher. This control is hidden by standalone.css.
  location.reload();
}
