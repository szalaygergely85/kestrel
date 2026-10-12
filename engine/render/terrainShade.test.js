// US-016 Node tests for `shadeTerrain` (docs/architecture.md 14.4 item 5,
// near-detail extension 23.4).
import { shadeTerrain, hashFast01, perCellHashSize, shadeTerrainCells, groundAlbedo, groundTierOffset, patchNoise, valueNoise, NOISE_CELLS, NOISE_SALT, PATCH_K, shadeGrass, grassTableFor, GRASS_GX_HAS, GRASS_BACKLIGHT_K } from './terrainShade.js';
import { Terrain } from '../world/Terrain.js';
import { GBuffer, KIND_TERRAIN } from './GBuffer.js';
import { CellBuffer } from './CellBuffer.js';
import { packNormalOct } from '../voxel/octNormal.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL:', name); } }

const TLOOK_WIDTH = 9;
function makeTlook() {
  const rows = 2; // 0 grass, 1 water (glint)
  const tlook = new Float32Array(4 * TLOOK_WIDTH * rows);
  function setColours(row, dark, mid, light) {
    const base = row * TLOOK_WIDTH * 4;
    [dark, mid, light].forEach((c, i) => { const o = base + i * 4; tlook[o] = c[0]; tlook[o + 1] = c[1]; tlook[o + 2] = c[2]; });
  }
  function setGlyphs(row, near, mid, far, close) {
    const base = row * TLOOK_WIDTH * 4;
    [near, mid, far, close || near].forEach((codes, bi) => {
      const o = base + ((bi < 3 ? 4 + bi : 7) * 4);
      let x = 0; for (let i = 0; i < codes.length; i++) x |= codes[i] << (8 * i);
      tlook[o] = x; tlook[o + 1] = codes.length;
    });
  }
  setColours(0, [0.1, 0.2, 0.1], [0.2, 0.4, 0.2], [0.3, 0.6, 0.3]);
  setGlyphs(0, [0, 1], [2], [3], [9]);
  const albedoOff0 = 0 * TLOOK_WIDTH * 4 + 3 * 4;
  tlook[albedoOff0] = 0.85; tlook[albedoOff0 + 1] = 0;

  setColours(1, [0.05, 0.1, 0.3], [0.1, 0.2, 0.5], [0.2, 0.4, 0.8]);
  setGlyphs(1, [4, 5], [6], [7]);
  const albedoOff1 = 1 * TLOOK_WIDTH * 4 + 3 * 4;
  tlook[albedoOff1] = 0.9; tlook[albedoOff1 + 1] = 1; // glint flag on

  return tlook;
}

const ctx = {
  tlook: makeTlook(), tlookWidth: TLOOK_WIDTH,
  bands: { near: 150, mid: 600 },
  fog: { start: 50, full: 1500, curve: 0.7, nearRGB: [143, 168, 196], farRGB: [196, 220, 239] },
  shading: { fgMin: 0.15, fgGamma: 0.6, fgMaxGain: 1.6 },
};

function out() { return { glyph: 0, fg: new Uint8Array(3), bg: new Uint8Array(3), level: 255 }; }

// Band selection by t.
{
  const o1 = shadeTerrain(100, 0, 0.9, 0, 0, 0, ctx, out());   // < 150 -> near band
  const o2 = shadeTerrain(300, 0, 0.9, 0, 0, 0, ctx, out());   // < 600 -> mid band
  const o3 = shadeTerrain(1000, 0, 0.9, 0, 0, 0, ctx, out());  // >= 600 -> far band
  check('OB-073 calm ground: near glyph is the near set middle entry', o1.glyph === 1);
  check('OB-073 calm ground: mid distance keeps the same glyph', o2.glyph === o1.glyph);
  check('OB-073 calm ground: far distance (unfogged) keeps the same glyph', o3.glyph === o1.glyph);
  // identical glyph at any world point / distance / time / brightness / close band for a fixed type
  let same = true;
  const cc = { ...ctx, closeBand: 40, handover: [130, 170], features: [{ typeId: 0, chance: 1, code0: 10, code1: 11, fg: [200, 150, 50] }] };
  for (let k = 0; k < 400; k++) {
    const o = shadeTerrain((k * 7.3) % 140 + 0.5, 0, 0.3 + (k % 7) * 0.1, k * 1.37 - 80, k * 0.91 + 5, k * 0.7, cc, out());
    if (o.glyph !== o1.glyph) same = false;
  }
  check('OB-073 calm ground: glyph identical at 400 points/distances/times (close band + features ignored)', same);
  let waterSame = true; const w0 = shadeTerrain(100, 1, 0.9, 8, 8, 0, ctx, out()).glyph;
  for (let ts = 0; ts < 100; ts++) if (shadeTerrain(100, 1, 0.9, 8 + ts * 0.3, 8, ts, ctx, out()).glyph !== w0) waterSame = false;
  check('OB-073 calm ground: water glyph never changes with time/point', waterSame);
}

// 38.25 amendment C.1 / OB-073: stable-pass level byte - glint removed, so every terrain cell (incl. the old shimmer type) is 255.
{
  let l254 = 0, l255 = 0, allWater = true, allGrass = true;
  for (let k = 0; k < 40; k++) {
    const w = shadeTerrain(200, 1, 0.7, k * 3.1, k * 1.7, k * 0.37, ctx, out()), g = shadeTerrain(200, 0, 0.7, k * 3.1, k * 1.7, k * 0.37, ctx, out());
    if (w.level !== 254) allWater = false; if (g.level !== 255) allGrass = false;
    if (w.level === 254) l254++; if (g.level === 255) l255++;
  }
  check('OB-073: old shimmer type no longer 254 (calm ground)', l254 === 0 && allWater === false);
  check('non-shimmer terrain: level 255', allGrass && l255 === 40);
  check('OB-073: water level 255 too', shadeTerrain(200, 1, 0.7, 3, 4, 5, ctx, out()).level === 255);
}

// Deterministic: same inputs -> same glyph/colour (world-keyed hash).
{
  const a = shadeTerrain(200, 0, 0.5, 123.4, 567.8, 10, ctx, out());
  const b = shadeTerrain(200, 0, 0.5, 123.4, 567.8, 10, ctx, out());
  check('deterministic: same inputs -> same glyph', a.glyph === b.glyph);
  check('deterministic: same inputs -> same fg', a.fg[0] === b.fg[0] && a.fg[1] === b.fg[1] && a.fg[2] === b.fg[2]);
}

// All byte outputs are in range.
{
  const bVals = [0.2, 0.6, 0.9];
  const tVals = [100, 400, 1200, 1450];
  for (const b of bVals) for (const t of tVals) {
    const o = shadeTerrain(t, 0, b, 42, 99, 0, ctx, out());
    check(`byte range at b=${b} t=${t}: fg`, o.fg.every((v) => v >= 0 && v <= 255));
    check(`byte range at b=${b} t=${t}: bg`, o.bg.every((v) => v >= 0 && v <= 255));
    check(`byte range at b=${b} t=${t}: glyph`, o.glyph >= 0 && o.glyph <= 94);
  }
}

// Heavy fog (t near/at 1500) -> glyph forced to space (glyphIdx 0).
{
  const o = shadeTerrain(1490, 0, 0.9, 0, 0, 0, ctx, out());
  check('heavy fog: glyph is space (0)', o.glyph === 0);
}

// OB-073: water glint removed (covered by the calm-ground test above: water glyph never changes with time).

// BUG-OWN-004 (row 25i): TLOOK colours are linear 0..1 (not 0..255 bytes) -
// `shadeTerrain` must scale by 255 itself. Before the fix, near/well-lit
// terrain rendered near-black because 0.1..0.3-range floats were written
// straight to a byte channel. Grass type 0's brightest tier (i=2, "light")
// is [0.3, 0.6, 0.3]; at strong lighting (b=0.9, near band, no fog) the fg
// byte must be a plausible mid/bright green, not near 0.
{
  const o = shadeTerrain(100, 0, 0.9, 0, 0, 0, ctx, out());
  check('BUG-OWN-004: near terrain fg is not near-black (r)', o.fg[0] > 40);
  check('BUG-OWN-004: near terrain fg is not near-black (g)', o.fg[1] > 80);
  check('BUG-OWN-004: near terrain fg is not near-black (b)', o.fg[2] > 40);
}

// ---- US-026a 23.4 near-detail: close band, jitter, features ----------------

// No ctx.closeBand/ctx.handover (old callers, far-only recipes) -> identical
// to the pre-US-026a shape: never picks the close-band glyph (9), even at t=0.
{
  const o = shadeTerrain(0, 0, 0.9, 0, 0, 0, ctx, out());
  check('no closeBand configured: t=0 still uses the near/mid/far tiers, never glyph 9', o.glyph !== 9);
}

// With closeBand configured, t < closeBand picks from the close glyph set
// (texel W-1), not the near set.
{
  const ctxClose = { ...ctx, closeBand: 40, handover: [130, 170] };
  const o = shadeTerrain(10, 0, 0.9, 0, 0, 0, ctxClose, out());
  check('OB-073: t < closeBand no longer switches to the close glyph set (9)', o.glyph !== 9);
  const o2 = shadeTerrain(100, 0, 0.9, 0, 0, 0, ctxClose, out());
  check('t >= closeBand (still < near band): same calm glyph as inside', o2.glyph === o.glyph);
}

// Brightness jitter (+-0.08) only applies inside the close band - same b,
// same (u,v) outside the close band never differs, but the SAME cell just
// inside it can differ from a hypothetical un-jittered call because the tier
// pick uses `b +- jitter`. We check this indirectly: enough different world
// cells inside the close band produce more than one tier-mixing outcome for
// a b value sitting right at a tier boundary (0.45), which a fixed b alone
// (no jitter) would never do.
{
  const ctxClose = { ...ctx, closeBand: 40, handover: [130, 170] };
  const seen = new Set();
  for (let cell = 0; cell < 40; cell++) {
    const o = shadeTerrain(5, 0, 0.45, cell * 2 + 1, 0, 0, ctxClose, out());
    seen.add(o.fg[0] + ',' + o.fg[1] + ',' + o.fg[2]);
  }
  check('close-band jitter: brightness at the tier boundary varies across world cells', seen.size > 1);
}

// Handover hash-cell size: t < handover[1] hashes at 2 m (adjacent 2 m cells
// can pick different tier offsets), t >= handover[1] hashes at 8 m (the same
// 8 m cell -> same tier offset for every point inside it).
{
  const ctxH = { ...ctx, handover: [10, 20] };
  const cA = hashFast01(0, 0, 0), cB = hashFast01(1, 0, 0);
  check('sanity: hashFast01 differs across adjacent world cells', cA !== cB);
  // Two points 2 m apart, both t >= handover[1] (8 m hashing): floor(0/8) ==
  // floor(2/8) == 0, so they hash to the SAME cell - same glyph pick.
  const oFar1 = shadeTerrain(50, 0, 0.9, 0, 0, 0, ctxH, out());
  const oFar2 = shadeTerrain(50, 0, 0.9, 2, 0, 0, ctxH, out());
  check('t >= handover[1]: 8 m hash cell, two points 2 m apart share a cell', oFar1.glyph === oFar2.glyph);
}

// Features (wildflower/pebble): a feature whose chance is 1 (always fires)
// on type 0 always overrides the close-band glyph/colour.
{
  const ctxFeat = {
    ...ctx, closeBand: 40, handover: [130, 170],
    features: [{ typeId: 0, chance: 1, code0: 10, code1: 11, fg: [200, 150, 50] }],
  };
  const o = shadeTerrain(5, 0, 0.9, 3, 3, 0, ctxFeat, out());
  check('OB-073: features (per-cell specks) removed, chance=1 does not override the glyph', o.glyph !== 10 && o.glyph !== 11);
  // A feature on a DIFFERENT type (1, water) never touches type 0.
  const ctxFeatOther = {
    ...ctx, closeBand: 40, handover: [130, 170],
    features: [{ typeId: 1, chance: 1, code0: 10, code1: 11, fg: [200, 150, 50] }],
  };
  const o2 = shadeTerrain(5, 0, 0.9, 3, 3, 0, ctxFeatOther, out());
  check('feature on a different type never overrides this cell', o2.glyph !== 10 && o2.glyph !== 11);
}

// ME-06b: background canopy FACE look (forest row 0 with face glyphs, row 1 without).
{
  const W = 17;
  const tl = new Float32Array(4 * W * 2);
  for (let r = 0; r < 2; r++) {
    const b0 = r * W * 4;
    [[0.1, 0.2, 0.1], [0.2, 0.4, 0.2], [0.3, 0.6, 0.3]].forEach((c, i) => { tl[b0 + i * 4] = c[0]; tl[b0 + i * 4 + 1] = c[1]; tl[b0 + i * 4 + 2] = c[2]; });
    [4, 5, 6, 7].forEach((texel) => { tl[b0 + texel * 4] = 5; tl[b0 + texel * 4 + 1] = 1; }); // glyph code 5 everywhere
  }
  tl[3 * 4 + 2] = 6 | (7 << 8); tl[3 * 4 + 3] = 2; // row 0 face glyphs: codes 6, 7
  tl[16 * 4] = 0.35; tl[16 * 4 + 1] = 0.22; tl[16 * 4 + 2] = 0.12; // trunk colour
  const c2 = { tlook: tl, tlookWidth: W, bands: { near: 150, mid: 600 },
    fog: { start: 50, full: 1500, curve: 0.7, nearRGB: [0, 0, 0], farRGB: [0, 0, 0] },
    shading: { fgMin: 0.15, fgGamma: 0.6, fgMaxGain: 1.6 } };
  const flat = shadeTerrain(200, 0, 0.9, 5, 5, 0, c2, out(), 0);
  const face = shadeTerrain(200, 0, 0.9, 5, 5, 0, c2, out(), 1);
  check('surface look unchanged when faceMode 0', flat.glyph === 5);
  check('face cell picks a face glyph', face.glyph === 6 || face.glyph === 7);
  check('face cell is 0.8x the surface brightness', Math.abs(face.fg[1] - 0.8 * flat.fg[1]) <= 1.5);
  let trunks = 0, foliage = 0;
  for (let k = 0; k < 300; k++) { const o = shadeTerrain(200, 0, 0.9, k * 8 + 1, 3, 0, c2, out(), 2); if (o.glyph === 92) trunks++; else if (o.glyph === 7) foliage++; }
  check('foot row: about 1 cell in 3 is a trunk |', trunks > 70 && trunks < 130);
  check('foot row: the rest is dark foliage %', trunks + foliage === 300);
  const beyond = shadeTerrain(100, 0, 0.9, 5, 5, 0, c2, out(), 1);
  check('inside the near band no face look', beyond.glyph === 5);
  const nonForest = shadeTerrain(200, 1, 0.9, 5, 5, 0, c2, out(), 1);
  check('type without face glyphs unchanged even with faceMode', nonForest.glyph === 5);
}


// BUG-RTS-001 (28.11a): ctx.hashCell override.
{
  const ctxH = { ...ctx, closeBand: 40, handover: [130, 170] };
  const pts = [[30, 0.5, 3.1, 7.7], [30, 0.9, 101.3, 55.2], [60, 0.3, 12.5, 400.1], [100, 0.6, 77.7, 13.3],
    [150, 0.7, 5.5, 5.5], [200, 0.5, 222.2, 11.1], [400, 0.8, 9.9, 901.4], [1000, 0.4, 333.3, 444.4]];
  let same = true;
  for (const [t, b, u, v] of pts) {
    const a = shadeTerrain(t, 0, b, u, v, 1, ctxH, out());
    const c = shadeTerrain(t, 0, b, u, v, 1, { ...ctxH, hashCell: 0 }, out());
    if (a.glyph !== c.glyph || a.fg[0] !== c.fg[0] || a.fg[1] !== c.fg[1] || a.fg[2] !== c.fg[2] || a.bg[0] !== c.bg[0]) same = false;
  }
  check('hashCell 0 == absent (8 test points, byte identical)', same);
  // With a 0.25 m cell, u and u + 0.3 fall in different cells: over many samples they differ somewhere;
  // with the 2 m cell they are the same cell (u 10.1 -> 10.4 within [10,12)) so always identical.
  const c25 = { ...ctxH, hashCell: 0.25 };
  let diff25 = 0, diff2 = 0;
  for (let i = 0; i < 64; i++) {
    const u = 40 + i * 1.37, v = 13.3 + i * 0.71;
    const a = shadeTerrain(20, 0, 0.6, u, v, 0, c25, out()), c = shadeTerrain(20, 0, 0.6, u + 0.3, v, 0, c25, out());
    if (a.glyph !== c.glyph || a.fg[0] !== c.fg[0]) diff25++;
    const e = shadeTerrain(3, 0, 0.6, Math.floor(u / 2) * 2 + 0.1, v, 0, ctxH, out()), g = shadeTerrain(3, 0, 0.6, Math.floor(u / 2) * 2 + 0.4, v, 0, ctxH, out()); // OB-073: near the feet
    if (e.glyph !== g.glyph || e.fg[0] !== g.fg[0]) diff2++;
  }
  check('hashCell 0.25: u and u+0.3 land in different cells (output differs)', diff25 > 10);
  check('OB-073 no 2 m block: u and u+0.3 inside one 2 m cell can differ (smooth noise + 0.25 m glyph cell)', diff2 > 10);
}

// BUG-FP-002 per-cell hash size (hashCell = -k).
{
  const H = [130, 170];
  check('perCellHashSize t*k=0.3 -> 0.5', perCellHashSize(30, 0.01, H) === 0.5);
  check('perCellHashSize t*k=0.01 -> 0.125', perCellHashSize(0.02, 0.5, H) === 0.125);
  check('perCellHashSize t*k=5 -> 2', perCellHashSize(100, 0.05, undefined) === 2);
  check('perCellHashSize t >= handover[1] -> 8', perCellHashSize(170, 0.001, H) === 8 && perCellHashSize(500, 0.001, H) === 8);
  check('perCellHashSize no handover never 8', perCellHashSize(1e6, 1, undefined) === 2);
  // OB-073: shadeTerrain no longer keys on perCellHashSize (smooth noise band-limited by groundFootprint instead); the helper stays for old callers.
}


// ---- S8-B2-12b (38.13): shadeTerrainCells scales the terrain analytic sun term by cF = 1 - light.cloudQ[i]/255 ----
// A self-contained synthetic recipe/palette (no `design/` import, same pattern as TerrainTextures.test.js's stub)
// so this exercises the REAL `shadeTerrainCells` cell loop (not the low-level `shadeTerrain` the rest of this file
// probes), which is where the cloud byte is actually read.
{
  const w = 8, h = 8, cell = 8;
  const recipe = {
    seed: 1, map: { w, h, cell }, bands: { near: 150, mid: 600 },
    terrain: { grass: { id: 0, colors: ['grassDark', 'grass', 'grassLight'], glyphs: { near: '",', mid: ',.', far: '.' }, albedo: 0.85 } },
    recipe: {},
    util: {
      heightAt: (x, y) => (x + y) * 0.01,
      typeAt: () => 0,
      generate() { const n = w * h; return { height: new Float32Array(n), type: new Uint8Array(n), w, h, cell }; },
      bake(x0, y0, cell2, bw, bh) { const n = bw * bh; return { x0, y0, w: bw, h: bh, cell: cell2, height: new Float32Array(n), type: new Uint8Array(n) }; },
      gridHeight() { return 0; },
    },
  };
  const palette = {
    rgb: { grassDark: [10, 40, 10], grass: [20, 80, 20], grassLight: [40, 120, 40] },
    fog: { far: { start: 50, full: 1500, curve: 0.7, color: 'grassDark', colorFar: 'grassLight' } },
    shading: { fgMin: 0.15, fgGamma: 0.6, fgMaxGain: 1.6 },
    timeOfDay: { day: { sunElev: 60, ambientI: 0.2, sunI: 0.9 } }, defaultTime: 'day',
  };
  const terrain = new Terrain(recipe);
  terrain.bakeFarSync();
  const world = { sun: { azimuth: 90, elevation: 60 } }; // sun truthy -> sunFromWorld never touches world.structures
  function sampleTerrain(q) {
    const gbuf = new GBuffer(1, 1);
    gbuf.kind[0] = KIND_TERRAIN; gbuf.mat[0] = 0; gbuf.u[0] = 4; gbuf.v[0] = 4;
    new Uint32Array(gbuf.aoD.buffer)[0] = packNormalOct(0, 0, 1); // straight-up normal, full N.sunDir exposure
    const fb = {
      rt: new CellBuffer(1, 1), gbuf, palette, matTable: null,
      depth: { depth: Float32Array.of(100) }, // near band (< 150), well clear of heavy fog
      light: { uniform: false, sunMapOn: false, rgb: new Float32Array(3), cloudQ: Uint8Array.of(q) }, // lamp term 0: isolates sun+cloud
    };
    shadeTerrainCells(fb, terrain, world, 0, 0);
    return { glyph: fb.rt.glyphIdx[0], fg: fb.rt.fg.slice(0, 3), bg: fb.rt.bg.slice(0, 3) };
  }
  const t0 = sampleTerrain(0), t153 = sampleTerrain(153), t255 = sampleTerrain(255);
  const tNull = (() => {
    const gbuf = new GBuffer(1, 1);
    gbuf.kind[0] = KIND_TERRAIN; gbuf.mat[0] = 0; gbuf.u[0] = 4; gbuf.v[0] = 4;
    new Uint32Array(gbuf.aoD.buffer)[0] = packNormalOct(0, 0, 1);
    const fb = { rt: new CellBuffer(1, 1), gbuf, palette, matTable: null, depth: { depth: Float32Array.of(100) }, light: null };
    shadeTerrainCells(fb, terrain, world, 0, 0);
    return { glyph: fb.rt.glyphIdx[0], fg: fb.rt.fg.slice(0, 3), bg: fb.rt.bg.slice(0, 3) };
  })();
  check('q=0 (explicit cloud byte) is byte-identical to light: null (bit-identical AC)', t0.glyph === tNull.glyph && t0.fg.every((v, i) => v === tNull.fg[i]) && t0.bg.every((v, i) => v === tNull.bg[i]));
  check('same band/glyph across cloud bytes (only brightness changes)', t0.glyph === t153.glyph && t0.glyph === t255.glyph);
  const sum = (a) => a[0] + a[1] + a[2];
  check('q=153 (cF=0.4) darkens the terrain cell vs q=0', sum(t153.fg) < sum(t0.fg));
  check('q=255 (cF~0) darkens further than q=153 - monotonic in q', sum(t255.fg) <= sum(t153.fg));
  // mutation sanity: a light.uniform object (no per-cell byte meaning) must behave like cF=1 even with a non-zero cloud array
  const tUniform = (() => {
    const gbuf = new GBuffer(1, 1);
    gbuf.kind[0] = KIND_TERRAIN; gbuf.mat[0] = 0; gbuf.u[0] = 4; gbuf.v[0] = 4;
    new Uint32Array(gbuf.aoD.buffer)[0] = packNormalOct(0, 0, 1);
    const fb = { rt: new CellBuffer(1, 1), gbuf, palette, matTable: null, depth: { depth: Float32Array.of(100) }, light: { uniform: true, sunMapOn: false, rgb: new Float32Array(3), cloudQ: Uint8Array.of(255) } };
    shadeTerrainCells(fb, terrain, world, 0, 0);
    return { glyph: fb.rt.glyphIdx[0], fg: fb.rt.fg.slice(0, 3), bg: fb.rt.bg.slice(0, 3) };
  })();
  check('light.uniform ignores the cloud byte (cF stays 1)', tUniform.fg.every((v, i) => v === t0.fg[i]));
}


// OB-073 (replaces the OB-054/067 identical-at-any-distance checks, which forced hard 1 m squares): a world point's look may only
// change smoothly or ONCE per switch as the camera approaches (never re-roll); slow walk flips < 3 % of glyphs 3..30 m ahead.
const K_REAL = -0.011; // 2*tanHalfX/cols of the owner's view (~90 deg, ~180 cols)
export function glyphStable(shade) {
  const c = { ...ctx, handover: [130, 170], closeBand: 6, fog: { ...ctx.fog, start: 1e6, full: 2e6 }, hashCell: K_REAL };
  let worstG = 0, worstJ = 0, n = 0;
  for (let i = 0; i < 200; i++) {
    const u = 11.37 + i * 0.913, v = 3.21 + i * 0.571, b = [0.3, 0.6, 0.95][i % 3], ty = i % 2;
    let p = shade(2, ty, b, u, v, 0, c, out()), gch = 0, jumps = 0, pg = p.glyph, pf = p.fg[1];
    for (let t = 2.05; t <= 40; t += 0.05) {
      const o = shade(t, ty, b, u, v, 0, c, out()); n++;
      if (o.glyph !== pg) gch++;
      if (Math.abs(o.fg[1] - pf) > 4) jumps++;
      pg = o.glyph; pf = o.fg[1];
    }
    worstG = Math.max(worstG, gch); worstJ = Math.max(worstJ, jumps);
  }
  return { worstG, worstJ, n };
}
const meadowTl = (() => { // ctx.tlook row 0 with overworld_far grass glyphs: close ".,'`", near ".,'"
  const tl = ctx.tlook.slice(), pk = (str) => { let x = 0; for (let i = 0; i < str.length; i++) x |= (str.charCodeAt(i) - 32) << (8 * i); return x; };
  tl[4 * 4] = pk(".,'"); tl[4 * 4 + 1] = 3; tl[7 * 4] = pk(".,'`"); tl[7 * 4 + 1] = 4; return tl;
})();
export function slowWalkFlips(shade) {
  const c = { ...ctx, tlook: meadowTl, handover: [130, 170], closeBand: 40, fog: { ...ctx.fog, start: 1e6, full: 2e6 }, hashCell: K_REAL };
  let flips = 0, n = 0;
  for (let i = 0; i < 2000; i++) { // point at forward distance d from the eye; eye then moves 1 m closer
    const d = 3 + (i / 2000) * 27, u = 100 + d * 1.003, v = 50 + (i % 37) * 0.137;
    const a = shade(d, 0, 0.6, u, v, 0, c, out()), bb = shade(d - 1, 0, 0.6, u, v, 0, c, out()); n++;
    if (a.glyph !== bb.glyph) flips++;
  }
  return { flips, n };
}
// top-down 20x20 m at 0.1 m from 2..6 m away (near detail on): colour-boundary pixels on 1 m grid lines, largest one-colour region
export function patchShape(shade) {
  const c = { ...ctx, handover: [130, 170], fog: { ...ctx.fog, start: 1e6, full: 2e6 }, hashCell: K_REAL };
  const N = 200, col = new Int32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = 300 + x * 0.1 + 0.05, v = 700 + y * 0.1 + 0.05, t = 2 + 4 * ((x + y) / (2 * N));
    const o = shade(t, 0, 0.6, u, v, 0, c, out()); col[y * N + x] = (o.fg[0] << 16) | (o.fg[1] << 8) | o.fg[2];
  }
  let edges = 0, onGrid = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N - 1; x++) if (col[y * N + x] !== col[y * N + x + 1]) { edges++; if ((x + 1) % 10 === 0) onGrid++; }
  for (let y = 0; y < N - 1; y++) for (let x = 0; x < N; x++) if (col[y * N + x] !== col[(y + 1) * N + x]) { edges++; if ((y + 1) % 10 === 0) onGrid++; }
  // largest solid one-colour square (a "flat block"); wandering connected strands of a tier are fine, compact blocks are not
  const dp = new Int16Array(N * N); let sq = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    dp[i] = (x && y && col[i] === col[i - 1] && col[i] === col[i - N] && col[i] === col[i - N - 1]) ? 1 + Math.min(dp[i - 1], dp[i - N], dp[i - N - 1]) : 1;
    if (dp[i] > sq) sq = dp[i];
  }
  const maxA = sq * sq;
  return { gridFrac: onGrid / Math.max(1, edges), maxM2: maxA * 0.01, edges };
}
{
  const r = glyphStable(shadeTerrain);
  console.log('OB-073 2..40 m sweep (0.05 m steps): worst glyph changes/point ' + r.worstG + ', worst colour jumps/point ' + r.worstJ);
  check('OB-073 approaching 2..40 m: each point changes glyph <= 3x (band/near->far switch, never re-rolls) (' + r.worstG + ')', r.worstG <= 3);
  check('OB-073 approaching 2..40 m: each point colour jumps (> 4 bytes / 0.05 m) <= 4x (tier crossings only) (' + r.worstJ + ')', r.worstJ <= 4);
  const w = slowWalkFlips(shadeTerrain);
  console.log('OB-073 walk 1 m: ' + w.flips + '/' + w.n + ' glyphs flip 3..30 m ahead');
  check('OB-073 walking 1 m flips < 3 % of glyphs 3..30 m ahead (' + w.flips + '/' + w.n + ')', w.flips / w.n < 0.03);
  const sh = patchShape(shadeTerrain);
  console.log('OB-073 shape: boundary px on 1 m grid lines ' + (sh.gridFrac * 100).toFixed(1) + ' % (random ~10 %), largest solid one-colour square ' + sh.maxM2.toFixed(2) + ' m2, edges ' + sh.edges);
  check('OB-073 no square grid: < 15 % of colour boundaries on 1 m lines', sh.gridFrac < 0.15);
  check('OB-073 no big flat block near the player: largest solid one-colour square <= 4 m2', sh.maxM2 <= 4);
  check('OB-073 has variety near the feet (enough boundaries)', sh.edges > 2000);
}

// OB-067 / gpucompare world_m1: WGSL gets u,v as f32. Points within 1e-4 m of a cell edge at x,y ~ 1000-1500: the JS twin must pick the same
// cell as an f32 (Math.fround) emulation of the GPU, i.e. f64 input noise below f32 ulp must not flip the cell.
{
  const c = { ...ctx, handover: [130, 170], fog: { ...ctx.fog, start: 1e6, full: 2e6 }, hashCell: -0.02 };
  let bad = 0, n = 0;
  for (let i = 0; i < 400; i++) {
    const e = 1000 + (i % 40) * 12 + Math.floor(i / 40), f = 1000 + (i * 7 % 40) * 12;
    const uf = Math.fround(e + 1e-5 * ((i % 5) - 2)), vf = Math.fround(f + 1e-5 * ((i % 3) - 1));
    const a = shadeTerrain(5, 0, 0.6, uf, vf, 0, c, out()), g = shadeTerrain(5, 0, 0.6, uf + 3e-5, vf - 3e-5, 0, c, out()); n++;
    const b = shadeTerrain(5, 0, 0.6, Math.fround(uf + 3e-5), Math.fround(vf - 3e-5), 0, c, out());
    if (g.glyph !== b.glyph || g.fg[0] !== b.fg[0] || g.bg[0] !== b.bg[0]) bad++;
  }
  check('OB-067 f64 u,v vs f32-rounded u,v pick the same cell near edges at x,y~1000-1500 (' + bad + '/' + n + ')', bad === 0);
}
{ // OB-081: far ground blends tier colours (no whole-step jump for a tiny lighting change); near keeps hard tiers
  const ctxF = { ...ctx, hashCell: -0.01 };
  const lum = (o) => o.fg[0] + o.fg[1] + o.fg[2];
  let worstFar = 0, worstNear = 0;
  for (let k = 0; k < 200; k++) {
    const u = 37 + k * 13.7, v = 91 + k * 7.3;
    for (const b0 of [0.44, 0.79]) {
      const fa = shadeTerrain(400, 0, b0, u, v, 0, ctxF, out()), fb = shadeTerrain(400, 0, b0 + 0.02, u, v, 0, ctxF, out());
      const na = shadeTerrain(5, 0, b0, u, v, 0, ctxF, out()), nb = shadeTerrain(5, 0, b0 + 0.02, u, v, 0, ctxF, out());
      worstFar = Math.max(worstFar, Math.abs(lum(fa) - lum(fb))); worstNear = Math.max(worstNear, Math.abs(lum(na) - lum(nb)));
    }
  }
  console.log(`OB-081 tier step for +0.02 light: far worst ${worstFar}, near worst ${worstNear}`);
  check('OB-081: far ground (400 m) has no whole tier step for a +0.02 lighting change', worstFar < worstNear * 0.5);
}

// MASK-c: groundAlbedo = the calm TLOOK tier colour (WGSL twin: shade.wgsl.js grass base, run through compileFn in shade.wgsl.test.js shadeGrass);
// groundTierOffset == shadeTerrain's `off`; back-light term of shadeGrass.
{
  const o3 = new Float64Array(3);
  for (const ti of [0, 1, 2]) {
    groundAlbedo(0, ti, ctx, o3);
    const o = ti * 4;
    check('MASK-c groundAlbedo tier ' + ti, Math.abs(o3[0] - ctx.tlook[o] * 255) < 1e-9 && Math.abs(o3[1] - ctx.tlook[o + 1] * 255) < 1e-9 && Math.abs(o3[2] - ctx.tlook[o + 2] * 255) < 1e-9);
  }
  const q = new Float64Array(3); let badT = 0;
  for (let i = 0; i < 2000; i++) {
    const u = (i * 7.31) % 300 - 150, v = (i * 3.17) % 300 - 150, fp = [0.01, 0.1, 0.5, 2, 6][i % 5];
    q[0] = u; q[1] = v; q[2] = fp;
    const fu = Math.fround(u), fv = Math.fround(v);
    const v8 = valueNoise(fu * (1 / NOISE_CELLS[0]), fv * (1 / NOISE_CELLS[0]), NOISE_SALT);
    let ref = Math.floor(patchNoise(fu, fv, fp, v8) * PATCH_K + 0.5); ref = ref < -1 ? -1 : ref > 1 ? 1 : ref;
    if (groundTierOffset(q) !== ref) badT++;
  }
  check('MASK-c groundTierOffset == floor(patchNoise * K + 0.5) clamped (' + badT + ' differ)', badT === 0);
  const tab = grassTableFor({ variants: [{ ramp: [[40, 80, 20], [120, 200, 60]] }] });
  const gctx = { ...ctx, shading: { ...ctx.shading, floorLum: 0 } };
  const lum = (o) => o.fg[0] + o.fg[1] + o.fg[2];
  const base = shadeGrass(50, 1, 0.8, 0, 0, 0.8, tab, gctx, out(), 0, 1), bl = shadeGrass(50, 1, 0.8, 0, 0, 0.8, tab, gctx, out(), 255 * 256, 1);
  check('MASK-c back-light brightens the upper blade', lum(bl) > lum(base));
  check('MASK-c back-light off when sunI = 0', lum(shadeGrass(50, 1, 0.8, 0, 0, 0.8, tab, gctx, out(), 255 * 256, 0)) === lum(base));
  check('MASK-c back-light zero at the blade base (h01 = 0)', lum(shadeGrass(50, 1, 0, 0, 0, 0.8, tab, gctx, out(), 255 * 256, 1)) === lum(shadeGrass(50, 1, 0, 0, 0, 0.8, tab, gctx, out(), 0, 1)));
  check('MASK-c back-light capped (sunI 5 == sunI 1)', lum(shadeGrass(50, 1, 0.8, 0, 0, 0.8, tab, gctx, out(), 255 * 256, 5)) === lum(bl));
  check('MASK-c back-light cap constant', GRASS_BACKLIGHT_K > 0 && GRASS_BACKLIGHT_K <= 0.5);
}
console.log(`terrainShade.test.js: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
