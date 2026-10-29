// The original art is exported at 2x in 33 sheets of 2048x2048 pixels. Keeping
// both their decoded bitmaps and GPU copies can exhaust a phone's web process.
const ATLAS_SIZE = 2048;

export function graphicsProfile() {
  const compact = navigator.maxTouchPoints > 0 || window.matchMedia("(any-pointer: coarse)").matches;
  return {
    compact,
    artBase: compact ? "art/compact" : "art",
    atlasSize: compact ? ATLAS_SIZE / 2 : ATLAS_SIZE,
    atlasResolution: compact ? 0.5 : 1,
    resolution: compact ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    pageLoads: compact ? 1 : 4,
  };
}

// Bound the entire fetch/decode operation, including requests made concurrently
// by different screens. A failed page releases its slot so Library can retry it.
export function limitPageLoads(load, limit) {
  const waiting = [];
  let active = 0;
  function next() {
    while (active < limit && waiting.length) {
      const { index, resolve, reject } = waiting.shift();
      active += 1;
      Promise.resolve().then(() => load(index)).then(resolve, reject).finally(() => {
        active -= 1;
        next();
      });
    }
  }
  return (index) => new Promise((resolve, reject) => {
    waiting.push({ index, resolve, reject });
    next();
  });
}

export async function atlasBitmap(blob, size) {
  // Decode directly at the smaller size rather than retaining a full-size copy.
  const options = { premultiplyAlpha: "premultiply" };
  let bitmap = await createImageBitmap(blob, { ...options, resizeWidth: size, resizeHeight: size });
  if (bitmap.width === size && bitmap.height === size) {
    return bitmap;
  }
  // Some WebKit versions ignore bitmap resize options. Still enforce the memory
  // budget, and explicitly release both the full bitmap and temporary canvas.
  const original = bitmap;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  try {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Couldn't resize the game's artwork.");
    }
    context.drawImage(original, 0, 0, size, size);
    bitmap = await createImageBitmap(canvas, options);
    return bitmap;
  } finally {
    original.close();
    canvas.width = canvas.height = 0;
  }
}
