"""Browser server for Warfare 1944. No Discord, Red, or ActivityHub required."""

import argparse
import asyncio
import copy
import json
import logging
import os
import re
import secrets
import socket
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

from aiohttp import WSMsgType, web

from .engine import WarfareGame
from .restore import validated_backup

WEB_DIR = Path(__file__).parent / "web"
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / ".local" / "warfare1944"
COOKIE = "warfare1944_profile"
PROFILE_PATTERN = re.compile(r"[0-9a-f]{32}\Z")
log = logging.getLogger("warfare1944.local")


class CampaignValue:
    """The small part of Red Config's campaign interface used by the shared engine."""

    def __init__(self, path: Path):
        self.path = path

    async def __call__(self):
        def read():
            try:
                return json.loads(self.path.read_text(encoding="utf-8"))
            except FileNotFoundError:
                return None

        return await asyncio.to_thread(read)

    async def set(self, value):
        # Snapshot before yielding; a battle may change its in-memory save while disk work runs.
        payload = json.dumps(copy.deepcopy(value), ensure_ascii=False, indent=2) + "\n"

        def write():
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix=".save-", dir=self.path.parent)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as output:
                    output.write(payload)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, self.path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)

        await asyncio.to_thread(write)


class PlayerSave:
    def __init__(self, path: Path):
        self.campaign = CampaignValue(path)

    async def clear(self):
        await asyncio.to_thread(self.campaign.path.unlink, missing_ok=True)


class LocalSaves:
    """One atomic JSON campaign file per browser profile, retained across server restarts."""

    def __init__(self, directory: Path):
        self.directory = Path(directory)

    def user_from_id(self, user_id: int):
        return PlayerSave(self.directory / f"{user_id:032x}.json")


@dataclass
class LocalRoom:
    id: str = "local"
    connections: list = field(default_factory=list)


class LocalConnection:
    def __init__(self, ws: web.WebSocketResponse, room: LocalRoom, profile: str):
        self.ws = ws
        self.room = room
        self.follow = None
        author = SimpleNamespace(
            id=int(profile, 16),
            display_name=f"Commander {profile[:4].upper()}",
            display_avatar=SimpleNamespace(url=""),
        )
        self.ctx = SimpleNamespace(author=author, room_id=room.id, instance_id=room.id)

    async def send(self, data):
        if self.ws.closed:
            return
        try:
            # A disconnected or stalled phone must not stop the room's other battles.
            await asyncio.wait_for(self.ws.send_json(data), timeout=3)
        except (ConnectionError, RuntimeError, asyncio.TimeoutError):
            await self.ws.close()


class LocalServer:
    def __init__(self, data_dir: Path, lan_access: bool = False, public_url: str | None = None):
        self.game = WarfareGame(LocalSaves(data_dir))
        self.room = LocalRoom()
        self.lan_access = lan_access
        self.public_origin = None
        if public_url:
            address = urlsplit(public_url)
            if (
                address.scheme not in ("http", "https") or not address.netloc
                or address.username or address.password or address.path not in ("", "/")
                or address.query or address.fragment
            ):
                raise ValueError("The public URL must be an http(s) origin, such as https://game.onrender.com")
            self.public_origin = f"{address.scheme}://{address.netloc.lower()}"

    async def restore(self, conn, value):
        """Recover an absent ephemeral-host save, without overwriting newer server progress."""
        player_id = conn.ctx.author.id
        async with self.game.lock(player_id):
            storage = self.game.config.user_from_id(player_id)
            existing = await storage.campaign()
            restored = validated_backup(value) if existing is None else None
            if restored is not None and self.game.running(player_id) is None:
                await storage.campaign.set(restored)
                existing = restored
            await self.game.send_save(player_id, existing)

    async def people(self):
        players = {
            str(conn.ctx.author.id): {
                "id": str(conn.ctx.author.id),
                "name": conn.ctx.author.display_name,
                "avatar": "",
                "away": False,
            }
            for conn in self.room.connections
        }
        message = {"localPeople": list(players.values())}
        for conn in list(self.room.connections):
            await conn.send(message)


SERVER_KEY = web.AppKey("warfare1944.local", LocalServer)


def local_addresses():
    try:
        return sorted({
            item[4][0] for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
            if not item[4][0].startswith("127.")
        })
    except OSError:
        return []


async def index(request):
    html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
    local = (
        '<script type="importmap">'
        '{"imports":{"activityhub":"/local-hub.js"}}'
        '</script>\n<link rel="stylesheet" href="standalone.css" />\n'
    )
    return web.Response(
        text=html.replace("</head>", local + "</head>"),
        content_type="text/html",
        headers={"Cache-Control": "no-store"},
    )


async def session(request):
    profile = request.cookies.get(COOKIE, "")
    if not PROFILE_PATTERN.fullmatch(profile):
        profile = secrets.token_hex(16)
    server = request.app[SERVER_KEY]
    join_host = request.host
    address = urlsplit(f"{request.scheme}://{join_host}")
    if address.hostname in ("127.0.0.1", "localhost", "::1") and server.lan_access and not server.public_origin:
        addresses = local_addresses()
        if addresses:
            join_host = addresses[0] + (f":{address.port}" if address.port else "")
    response = web.json_response(
        {
            "id": str(int(profile, 16)), "displayName": f"Commander {profile[:4].upper()}",
            "joinUrl": (server.public_origin or f"{request.scheme}://{join_host}") + "/",
            "hosted": bool(server.public_origin),
        },
        headers={"Cache-Control": "no-store"},
    )
    response.set_cookie(
        COOKIE, profile, max_age=365 * 24 * 60 * 60, httponly=True,
        samesite="Strict", secure=request.secure or bool(server.public_origin and server.public_origin.startswith("https:")),
    )
    return response


async def websocket(request):
    server = request.app[SERVER_KEY]
    origin = request.headers.get("Origin")
    if origin:
        expected = server.public_origin or f"{request.scheme}://{request.host.lower()}"
        if origin.lower() != expected:
            raise web.HTTPForbidden(text="Open the game from this server's own address.")
    profile = request.cookies.get(COOKIE, "")
    if not PROFILE_PATTERN.fullmatch(profile):
        raise web.HTTPUnauthorized(text="Open the game page first to create a local profile.")
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=8192)
    await ws.prepare(request)
    conn = LocalConnection(ws, server.room, profile)
    server.room.connections.append(conn)
    try:
        await server.game.join(conn.ctx, conn)
        await server.people()
        async for message in ws:
            if message.type == WSMsgType.TEXT:
                try:
                    data = json.loads(message.data)
                except (ValueError, RecursionError):
                    continue
                if isinstance(data, dict) and set(data) == {"restoreCampaign"}:
                    await server.restore(conn, data["restoreCampaign"])
                else:
                    await server.game.message(conn.ctx, conn, data)
            elif message.type == WSMsgType.ERROR:
                break
    except Exception:
        log.exception("Local player connection failed")
        await conn.send({"notice": "The local server hit a problem. Check its terminal and reconnect."})
    finally:
        server.room.connections.remove(conn)
        await server.game.leave(conn.ctx, conn)
        await server.people()
        await ws.close()
    return ws


async def shutdown(app):
    server = app[SERVER_KEY]
    await asyncio.gather(
        *(conn.ws.close(code=1001, message=b"Server stopping") for conn in list(server.room.connections)),
        return_exceptions=True,
    )
    await server.game.close()


async def health(request):
    return web.json_response({"status": "ok"}, headers={"Cache-Control": "no-store"})


def create_app(data_dir: Path = DEFAULT_DATA_DIR, lan_access: bool = False, public_url: str | None = None):
    app = web.Application()
    app[SERVER_KEY] = LocalServer(data_dir, lan_access, public_url)
    app.router.add_get("/healthz", health)
    app.router.add_get("/", index)
    app.router.add_get("/local/session", session)
    app.router.add_get("/local/socket", websocket)
    # Serve only the game's assets; saves and Python files are outside this directory.
    app.router.add_static("/", WEB_DIR, show_index=False, follow_symlinks=False)
    app.on_shutdown.append(shutdown)
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="Use 0.0.0.0 to allow phones on your Wi-Fi")
    parser.add_argument("--port", type=int, default=os.environ.get("PORT", "8744"))
    parser.add_argument("--data-dir", type=Path, default=os.environ.get("WARFARE_DATA_DIR", DEFAULT_DATA_DIR), help="Folder for campaign saves")
    parser.add_argument(
        "--public-url", default=os.environ.get("WARFARE_PUBLIC_URL") or os.environ.get("RENDER_EXTERNAL_URL"),
        help="Public origin behind an HTTPS proxy (detected automatically on Render)",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)

    def started(_):
        local_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
        if ":" in local_host:
            local_host = f"[{local_host}]"
        print(f"\nWarfare 1944: {args.public_url or f'http://{local_host}:{args.port}'}/")
        if not args.public_url and args.host in ("0.0.0.0", "::"):
            for address in local_addresses():
                print(f"Phone on the same Wi-Fi: http://{address}:{args.port}/")
        print(f"Campaign saves: {args.data_dir.resolve()}\nPress Ctrl+C to stop.\n", flush=True)

    web.run_app(
        create_app(
            args.data_dir, lan_access=args.host not in ("127.0.0.1", "localhost", "::1"),
            public_url=args.public_url,
        ),
        host=args.host, port=args.port, print=started,
    )


if __name__ == "__main__":
    main()
