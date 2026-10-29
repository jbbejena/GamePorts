import assert from "node:assert/strict";
import test from "node:test";
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
