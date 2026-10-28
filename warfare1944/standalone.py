"""Local browser server for Warfare 1944. No Discord, Red, or ActivityHub required."""

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
    def __init__(self, data_dir: Path, lan_access: bool = False):
        self.game = WarfareGame(LocalSaves(data_dir))
        self.room = LocalRoom()
        self.lan_access = lan_access

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
    join_host = request.host
    address = urlsplit(f"{request.scheme}://{join_host}")
    if address.hostname in ("127.0.0.1", "localhost", "::1") and request.app[SERVER_KEY].lan_access:
        addresses = local_addresses()
        if addresses:
            join_host = addresses[0] + (f":{address.port}" if address.port else "")
    response = web.json_response(
        {
            "id": str(int(profile, 16)), "displayName": f"Commander {profile[:4].upper()}",
            "joinUrl": f"{request.scheme}://{join_host}/",
        },
        headers={"Cache-Control": "no-store"},
    )
    response.set_cookie(
        COOKIE, profile, max_age=365 * 24 * 60 * 60, httponly=True,
        samesite="Strict", secure=request.secure,
    )
    return response


async def websocket(request):
    origin = request.headers.get("Origin")
    if origin:
        parsed = urlsplit(origin)
        if parsed.scheme != request.scheme or parsed.netloc.lower() != request.host.lower():
            raise web.HTTPForbidden(text="Open the game from this server's own address.")
    profile = request.cookies.get(COOKIE, "")
    if not PROFILE_PATTERN.fullmatch(profile):
        raise web.HTTPUnauthorized(text="Open the game page first to create a local profile.")
    server = request.app[SERVER_KEY]
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


def create_app(data_dir: Path = DEFAULT_DATA_DIR, lan_access: bool = False):
    app = web.Application()
    app[SERVER_KEY] = LocalServer(data_dir, lan_access)
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
    parser.add_argument("--port", type=int, default=8744)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR, help="Folder for local campaign saves")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)

    def started(_):
        local_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
        if ":" in local_host:
            local_host = f"[{local_host}]"
        print(f"\nWarfare 1944: http://{local_host}:{args.port}/")
        if args.host in ("0.0.0.0", "::"):
            for address in local_addresses():
                print(f"Phone on the same Wi-Fi: http://{address}:{args.port}/")
        print(f"Campaign saves: {args.data_dir.resolve()}\nPress Ctrl+C to stop.\n", flush=True)

    web.run_app(
        create_app(args.data_dir, lan_access=args.host not in ("127.0.0.1", "localhost", "::1")),
        host=args.host, port=args.port, print=started,
    )


if __name__ == "__main__":
    main()
