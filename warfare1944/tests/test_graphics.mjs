import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { limitPageLoads } from "../web/graphics.js";
import { ImageSource, Rectangle, Sprite, Texture } from "../web/vendor/pixi.min.mjs";

test("smaller backing pixels preserve the real renderer's atlas geometry", () => {
  const bounds = [];
  for (const pixels of [2048, 1024]) {
    const source = new ImageSource({
      resource: { width: pixels, height: pixels },
      resolution: pixels / 2048,
    });
    const texture = new Texture({ source, frame: new Rectangle(1000, 500, 200, 100) });
    const shape = new Sprite(texture);
    shape.position.set(-10, 20);
    shape.scale.set(0.5);
    const box = shape.getBounds();
    bounds.push({ x: box.x, y: box.y, width: box.width, height: box.height });
    assert.equal(source.pixelWidth, pixels);
    assert.equal(source.width, 2048);
    shape.destroy({ children: true });
    texture.destroy(true);
  }
  assert.deepEqual(bounds[1], bounds[0]);
  assert.deepEqual(bounds[1], { x: -10, y: 20, width: 100, height: 50 });
});

test("concurrent screen requests share the same decode budget", async () => {
  const release = [];
  let active = 0;
  let peak = 0;
  const load = limitPageLoads(async (index) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => release.push(resolve));
    active -= 1;
    return index;
  }, 1);
  const pages = Array.from({ length: 8 }, (_, index) => load(index));
  for (let index = 0; index < pages.length; index += 1) {
    await new Promise(setImmediate);
    assert.equal(release.length, index + 1);
    release[index]();
    assert.equal(await pages[index], index);
  }
  assert.equal(peak, 1);
});

test("a rejected download does not strand queued pages or prevent a retry", async () => {
  let tries = 0;
  const load = limitPageLoads(async (index) => {
    if (index === 0 && tries++ === 0) {
      throw new Error("Interrupted download");
    }
    return index;
  }, 1);
  const first = load(0);
  const next = load(1);
  await assert.rejects(first, /Interrupted download/);
  assert.equal(await next, 1);
  assert.equal(await load(0), 0);
});

test("compact menu art is separated from mission art and preserves every placement", async () => {
  const original = JSON.parse(await readFile(new URL("../web/art/flash.json", import.meta.url)));
  const compact = JSON.parse(await readFile(new URL("../web/art/compact/flash.json", import.meta.url)));
  const pending = [compact.exports.menu];
  const seen = new Set();
  const pages = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const piece of compact.atlas.shapes[id] ?? []) pages.add(piece[0]);
    for (const frame of compact.sprites[id]?.f ?? []) {
      for (const operation of frame) if (operation[1]) pending.push(operation[1]);
    }
    for (const [child] of compact.buttons?.[id] ?? []) pending.push(child);
  }
  const menuPages = [...pages];
  assert.ok(menuPages.length < 16, "the menu must not preload most of the battle's textures");
  assert.ok(compact.atlas.pages.length <= original.atlas.pages.length, "keep the previous total decoded-pixel budget");
  assert.ok(menuPages.every(index => compact.atlas.pages[index].startsWith("menu-")));
  assert.ok(compact.atlas.pages.some(name => name.startsWith("battle-")));
  assert.deepEqual(Object.keys(compact.atlas.shapes), Object.keys(original.atlas.shapes));
  for (const [id, pieces] of Object.entries(original.atlas.shapes)) {
    assert.equal(compact.atlas.shapes[id].length, pieces.length);
    pieces.forEach((piece, index) => {
      const packed = compact.atlas.shapes[id][index];
      assert.deepEqual(packed.slice(3), piece.slice(3), `${id}: size and placement unchanged`);
      assert.ok(packed[1] >= 0 && packed[2] >= 0 && packed[1] + packed[3] <= 2048 && packed[2] + packed[4] <= 2048);
    });
  }
  const { atlas: ignoredOriginal, ...originalDefinitions } = original;
  const { atlas: ignoredCompact, ...compactDefinitions } = compact;
  assert.deepEqual(compactDefinitions, originalDefinitions);
});
