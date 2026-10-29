"""Repack the repository's original atlas into small menu and battle sheets.

Run from any directory with Pillow installed. Original artwork and placements are
unchanged; only backing pixels and atlas coordinates differ. Pillow is a build
dependency, never a dependency of the game server.
"""

import copy
import json
from functools import lru_cache
from pathlib import Path

from PIL import Image

ART = Path(__file__).resolve().parents[1] / "web" / "art"
SIZE = 2048
PIXELS = 1024
GUTTER = 4


def characters(data, root):
    seen = set()

    def walk(number):
        key = str(number)
        if key in seen:
            return
        seen.add(key)
        for operations in data["sprites"].get(key, {}).get("f", []):
            for operation in operations:
                if len(operation) > 1 and operation[1]:
                    walk(operation[1])
        for number, *_ in data.get("buttons", {}).get(key, []):
            walk(number)

    walk(root)
    return seen


def pack(tiles):
    """Stable rectangle packing, aligned to the half-size grid, without rotation."""
    pages = []
    for key, index, piece in sorted(tiles, key=lambda t: (-max(t[2][3:5]), -t[2][3] * t[2][4], int(t[0]), t[1])):
        width, height = piece[3:5]
        pad_x = min(GUTTER, (SIZE - width) // 2 // 2 * 2)
        pad_y = min(GUTTER, (SIZE - height) // 2 // 2 * 2)
        span_x = (width + 1) // 2 * 2 + pad_x * 2
        span_y = (height + 1) // 2 * 2 + pad_y * 2
        choices = [(min(w - span_x, h - span_y), max(w - span_x, h - span_y), page_index, x, y)
                   for page_index, page in enumerate(pages) for x, y, w, h in page["free"]
                   if w >= span_x and h >= span_y]
        if choices:
            _, _, page_index, x, y = min(choices)
            page = pages[page_index]
        else:
            page = {"free": [(0, 0, SIZE, SIZE)], "tiles": []}
            pages.append(page)
            x = y = 0
        page["tiles"].append((key, index, piece, x + pad_x, y + pad_y))
        free = []
        for fx, fy, fw, fh in page["free"]:
            if x >= fx + fw or x + span_x <= fx or y >= fy + fh or y + span_y <= fy:
                free.append((fx, fy, fw, fh))
                continue
            if x > fx:
                free.append((fx, fy, x - fx, fh))
            if x + span_x < fx + fw:
                free.append((x + span_x, fy, fx + fw - x - span_x, fh))
            if y > fy:
                free.append((fx, fy, fw, y - fy))
            if y + span_y < fy + fh:
                free.append((fx, y + span_y, fw, fy + fh - y - span_y))
        free = list(dict.fromkeys(free))
        page["free"] = [r for r in free if not any(r != s and r[0] >= s[0] and r[1] >= s[1]
                        and r[0] + r[2] <= s[0] + s[2] and r[1] + r[3] <= s[1] + s[3] for s in free)]
    return pages


def main():
    original = json.loads((ART / "flash.json").read_text(encoding="utf-8"))
    result = copy.deepcopy(original)
    result["atlas"]["pages"] = []
    menu = characters(original, original["exports"]["menu"])
    output = ART / "compact"
    output.mkdir(exist_ok=True)

    @lru_cache(maxsize=2)
    def source(index):
        with Image.open(ART / original["atlas"]["pages"][index]) as image:
            return image.convert("RGBA")

    for group, in_menu in (("menu", True), ("battle", False)):
        tiles = [(key, index, piece) for key, pieces in original["atlas"]["shapes"].items()
                 if (key in menu) == in_menu for index, piece in enumerate(pieces)]
        pages = pack(tiles)
        for number, page in enumerate(pages):
            name = f"{group}-{number}.webp"
            page_index = len(result["atlas"]["pages"])
            result["atlas"]["pages"].append(name)
            with Image.new("RGBA", (SIZE, SIZE)) as sheet:
                for key, index, piece, target_x, target_y in page["tiles"]:
                    atlas, x, y, width, height, *_ = piece
                    tile = source(atlas).crop((x, y, x + width, y + height))
                    sheet.paste(tile, (target_x, target_y))
                    tile.close()
                    result["atlas"]["shapes"][key][index][:3] = [page_index, target_x, target_y]
                small = sheet.resize((PIXELS, PIXELS), Image.Resampling.LANCZOS)
                small.save(output / name, lossless=True, method=6, exact=True)
                small.close()
        print(f"{group}: {len(pages)} sheets")
    (output / "flash.json").write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    original_bytes = sum((ART / name).stat().st_size for name in original["atlas"]["pages"])
    compact_bytes = sum((output / name).stat().st_size for name in result["atlas"]["pages"])
    # This dedicated generated directory contains no hand-authored artwork.
    for stale in output.glob("*-*.*"):
        if stale.suffix in (".png", ".webp") and stale.name not in result["atlas"]["pages"]:
            stale.unlink()
    print(f"Artwork bytes: {original_bytes:,} original -> {compact_bytes:,} compact")


if __name__ == "__main__":
    main()
