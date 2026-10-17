// PARTICLE-UPLOAD-02: column-cropped particle upload == full row band (byte-identical texture backing store) + bytes/frame on scattered sparks.
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgSpritesPass } from './passSprites.js';
import { createParticleLayer } from '../../particleLayer.js';

const COLS = 160, ROWS = 60;
// mock device whose writeTexture honours rect / dataOffset (source elements) / rect.stride into a per-texture backing store (4 bytes per texel)
function backedDevice() {
  const { device } = makeMockGpuDevice();
  const orig = device.createTexture.bind(device);
  device.createTexture = (desc) => { const t = orig(desc); t._store = new Uint8Array(desc.width * desc.height * 4); return t; };
  device.writeTexture = (tex, data, rect, dataOffset = 0) => {
    const W = tex.desc.width, x = rect ? rect.x : 0, y = rect ? rect.y : 0, w = rect ? rect.w : W, h = rect ? rect.h : tex.desc.height;
    const stride = rect && rect.stride ? rect.stride : w; // source pitch in texels
    const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength), el = data.BYTES_PER_ELEMENT;
    const texelsPerEl = tex.desc.format === 'rgba8' ? 0.25 : 1; // element = 1 byte (rgba8 array) or 1 float (= 1 texel)
    const base = dataOffset * el;
    for (let r = 0; r < h; r++) for (let b = 0; b < w * 4; b++) tex._store[((y + r) * W + x) * 4 + b] = src[base + r * stride * 4 + b];
    void texelsPerEl;
  };
  return device;
}
function run(crop) {
  const dev = backedDevice();
  const layer = createParticleLayer(); layer.bind(COLS, ROWS);
  const sp = new WgSpritesPass(dev, { pool: { count: 0, spr: new Float32Array(0) } });
  sp.cropColumns = crop; sp.bindParticleLayer(layer);
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const stores = [], bytes = [];
  for (let f = 0; f < 40; f++) {
    // emulate build(): clear last footprint, write ~12 sparks in a 30-col cluster that drifts, spread over all rows
    let pMin = ROWS, pMax = -1, cMin = COLS, cMax = -1;
    for (let t = 0; t < layer.stats.cells; t++) {
      const i = layer.touched[t], row = (i / COLS) | 0, col = i - row * COLS;
      layer.partZ[i] = 0; pMin = Math.min(pMin, row); pMax = Math.max(pMax, row); cMin = Math.min(cMin, col); cMax = Math.max(cMax, col);
    }
    layer.prevMinRow = pMin; layer.prevMaxRow = pMax; layer.prevMinCol = cMin; layer.prevMaxCol = cMax;
    let n = 0, r0 = ROWS, r1 = -1, c0 = COLS, c1 = -1;
    const cx = 20 + ((f * 3) % 60);
    for (let k = 0; k < 12; k++) {
      const x = cx + ((rnd() * 30) | 0), y = (rnd() * ROWS) | 0, idx = y * COLS + x;
      if (layer.partZ[idx] !== 0) continue;
      layer.touched[n++] = idx; layer.part.set([f & 255, k * 9, 200, 65 + k], idx * 4); layer.partZ[idx] = 1 + rnd();
      r0 = Math.min(r0, y); r1 = Math.max(r1, y); c0 = Math.min(c0, x); c1 = Math.max(c1, x);
    }
    layer.minRow = r0; layer.maxRow = r1; layer.minCol = c0; layer.maxCol = c1; layer.stats.cells = n;
    const b0 = sp.stats.partBytes; sp._syncParticles(); bytes.push(sp.stats.partBytes - b0);
    stores.push([Buffer.from(sp.texPart._store), Buffer.from(sp.texPartZ._store)]);
  }
  return { stores, bytes };
}
const a = run(false), b = run(true);
for (let f = 0; f < a.stores.length; f++) {
  assert.ok(a.stores[f][0].equals(b.stores[f][0]), `frame ${f}: part store differs`);
  assert.ok(a.stores[f][1].equals(b.stores[f][1]), `frame ${f}: partZ store differs`);
}
const avg = (v) => v.slice(1).reduce((p, c) => p + c, 0) / (v.length - 1);
assert.ok(avg(b.bytes) < avg(a.bytes) * 0.75, 'crop uploads fewer bytes');
console.log(`passSprites.particleCrop: identical over 40 frames; scattered sparks bytes/frame band ${avg(a.bytes) | 0} -> crop ${avg(b.bytes) | 0}`);
