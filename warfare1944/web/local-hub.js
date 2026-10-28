// The standalone transport implements the small interface game.js uses from ActivityHub.
// Battles and saves stay on the local Python server; all requests use this page's own origin.
let hub;

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
      window.prompt("Open this address on another device on the same Wi-Fi:", url);
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
