// ENV-02d part 3: synthetic terrain + ground-look config + gbuf filler shared by the look twin bench and test (Node only; no design/ import).
import { Terrain } from '../world/Terrain.js';
import { GBuffer, KIND_TERRAIN } from './GBuffer.js';
import { CellBuffer } from './CellBuffer.js';
import { packNormalOct } from '../voxel/octNormal.js';

export const MAPN = 64, CELL = 8, MAP_M = MAPN * CELL;
const asc = (s) => Array.from(s, (c) => c.charCodeAt(0));
const mkLook = (id, o) => Object.assign({
  id, glyphs: asc('.,\'"'), lean: asc('.,``'), ramp: [[0.05, 0.2, 0.03], [0.1, 0.3, 0.06], [0.2, 0.5, 0.1], [0.4, 0.7, 0.2]], bg: [[0.02, 0.06, 0.01], [0.04, 0.12, 0.03]],
  noiseScale: 3.5, macroScale: 24, contrast: 0.55, shimmerMode: 1, shimmerAmp: 0.4, sheen: 0.3,
  accents: [{ glyph: 46, color: [0.9, 0.9, 0.8], density: 0.02, cluster: 0.6, maxDist: 25 }, { glyph: 111, color: [0.9, 0.3, 0.3], density: 0.01, cluster: 0.5, maxDist: 18 }],
}, o);
export const LOOK_CFG = {
  looks: [mkLook(1, {}), mkLook(2, { glyphs: asc('.:;%'), lean: asc('.:;%'), shimmerMode: 0, noiseScale: 2 })],
  lookMap: [{ look: 2, ground: [1], biomes: null }, { look: 1, ground: null, biomes: [1] }], blendM: 24,
};
export const PALETTE = {
  rgb: { g: [20, 80, 20], gl: [10, 40, 10], gh: [40, 120, 40] }, fog: { far: { start: 50, full: 1500, curve: 0.7, color: 'gl', colorFar: 'gh' } },
  shading: { fgMin: 0.15, fgGamma: 0.6, fgMaxGain: 1.6 }, timeOfDay: { day: { sunElev: 60, ambientI: 0.2, sunI: 0.9 } }, defaultTime: 'day',
};
export const WORLD = { sun: { azimuth: 90, elevation: 60 }, wind: { params: { amp: 0.6 } } };

function recipe() {
  const heightAt = (x, y) => Math.sin(x * 0.01) * 3 + y * 0.002, typeAt = (x) => (x >= 300 && x < 340 ? 1 : 0);
  const bake = (x0, y0, cell, w, h) => {
    const height = new Float32Array(w * h), type = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell; height[i + j * w] = heightAt(x, y); type[i + j * w] = typeAt(x, y); }
    return { x0, y0, w, h, cell, height, type };
  };
  return { seed: 1, map: { w: MAPN, h: MAPN, cell: CELL }, bands: { near: 150, mid: 600 },
    terrain: { grass: { id: 0, colors: ['gl', 'g', 'gh'], glyphs: { near: '",', mid: ',.', far: '.' }, albedo: 0.85 }, forest: { id: 1, colors: ['gl', 'g', 'gh'], glyphs: { near: '^', mid: '^', far: '^' }, albedo: 0.5 } }, recipe: {},
    util: { heightAt, typeAt, bake, generate: () => bake(0, 0, CELL, MAPN, MAPN), gridHeight: () => 0,
      biomeBlend(x, y, o) { const t = (x - 188) / 24; if (t <= 0) { o.a = 0; o.b = 0; o.w = 0; } else if (t >= 1) { o.a = 1; o.b = 1; o.w = 0; } else { o.a = t < 0.5 ? 0 : 1; o.b = t < 0.5 ? 1 : 0; o.w = t < 0.5 ? t : 1 - t; } } } };
}
export function makeTerrain(withLook) { const t = new Terrain(recipe()); if (withLook) t.setGroundLook(LOOK_CFG); t.bakeFarSync(); return t; }

/** gbuf of cols x rows terrain cells with u,v = world x,y taken from `uv(i) -> [u, v]` and depth from `depthOf(i)`; returns the fb for shadeTerrainCells. */
export function makeFb(cols, rows, uv, depthOf) {
  const gbuf = new GBuffer(cols, rows), n = cols * rows, depth = new Float32Array(n), nrm = packNormalOct(0, 0, 1), aoU = new Uint32Array(gbuf.aoD.buffer);
  for (let i = 0; i < n; i++) { const p = uv(i); gbuf.kind[i] = KIND_TERRAIN; gbuf.mat[i] = 0; gbuf.u[i] = p[0]; gbuf.v[i] = p[1]; gbuf.z[i] = 0; aoU[i] = nrm; depth[i] = depthOf(i); }
  return { rt: new CellBuffer(cols, rows), gbuf, palette: PALETTE, matTable: null, depth: { depth }, light: null };
}
