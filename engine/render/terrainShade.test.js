// US-016 Node tests for `shadeTerrain` (docs/architecture.md 14.4 item 5,
// near-detail extension 23.4).
import { shadeTerrain, hashFast01, perCellHashSize, shadeTerrainCells } from './terrainShade.js';
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

function out() { return { glyph: 0, fg: new Uint8Array(3), bg: new Uint8Array(3) }; }

// Band selection by t.
{
  const o1 = shadeTerrain(100, 0, 0.9, 0, 0, 0, ctx, out());   // < 150 -> near band
  const o2 = shadeTerrain(300, 0, 0.9, 0, 0, 0, ctx, out());   // < 600 -> mid band
  const o3 = shadeTerrain(1000, 0, 0.9, 0, 0, 0, ctx, out());  // >= 600 -> far band
  check('near band glyph is one of the near set', o1.glyph === 0 || o1.glyph === 1);
  check('mid band glyph is the mid set code', o2.glyph === 2);
  check('far band glyph is the far set code', o3.glyph === 3);
}

// 38.25 amendment C.1: stable-pass level byte - 254 (animated, never hold) for the glint/shimmer branch whatever the roll, 255 otherwise.
{
  let l254 = 0, l255 = 0, allWater = true, allGrass = true;
  for (let k = 0; k < 40; k++) {
    const w = shadeTerrain(200, 1, 0.7, k * 3.1, k * 1.7, k * 0.37, ctx, out()), g = shadeTerrain(200, 0, 0.7, k * 3.1, k * 1.7, k * 0.37, ctx, out());
    if (w.level !== 254) allWater = false; if (g.level !== 255) allGrass = false;
    if (w.level === 254) l254++; if (g.level === 255) l255++;
  }
  check('shimmer terrain type: level 254 for every roll', allWater && l254 === 40);
  check('non-shimmer terrain: level 255', allGrass && l255 === 40);
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

// Water glint only touches the glint-flagged type (1), never plain grass (0).
{
  let sawAlt = false;
  for (let ts = 0; ts < 20; ts++) {
    const o = shadeTerrain(100, 1, 0.9, 8, 8, ts, ctx, out());
    if (o.glyph === 5) sawAlt = true;
  }
  check('water: glint can select the alternate glyph over enough timeSec samples', sawAlt);
}

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
  check('t < closeBand: glyph comes from the close set (single code 9)', o.glyph === 9);
  const o2 = shadeTerrain(100, 0, 0.9, 0, 0, 0, ctxClose, out());
  check('t >= closeBand (still < near band): back to the near set', o2.glyph === 0 || o2.glyph === 1);
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
  check('feature with chance=1 always overrides the close glyph', o.glyph === 10 || o.glyph === 11);
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
    const e = shadeTerrain(20, 0, 0.6, Math.floor(u / 2) * 2 + 0.1, v, 0, ctxH, out()), g = shadeTerrain(20, 0, 0.6, Math.floor(u / 2) * 2 + 0.4, v, 0, ctxH, out());
    if (e.glyph !== g.glyph || e.fg[0] !== g.fg[0]) diff2++;
  }
  check('hashCell 0.25: u and u+0.3 land in different cells (output differs)', diff25 > 10);
  check('fixed 2 m cell: u and u+0.3 inside one cell are identical', diff2 === 0);
}

// BUG-FP-002 per-cell hash size (hashCell = -k).
{
  const H = [130, 170];
  check('perCellHashSize t*k=0.3 -> 0.5', perCellHashSize(30, 0.01, H) === 0.5);
  check('perCellHashSize t*k=0.01 -> 0.125', perCellHashSize(0.02, 0.5, H) === 0.125);
  check('perCellHashSize t*k=5 -> 2', perCellHashSize(100, 0.05, undefined) === 2);
  check('perCellHashSize t >= handover[1] -> 8', perCellHashSize(170, 0.001, H) === 8 && perCellHashSize(500, 0.001, H) === 8);
  check('perCellHashSize no handover never 8', perCellHashSize(1e6, 1, undefined) === 2);
  // through shadeTerrain: hashCell=-k equals a fixed positive cell of the same size; hashCell 0 equals the explicit 2/8 m path
  const cH = { ...ctx, handover: [130, 170] };
  const same = (a, b) => a.glyph === b.glyph && a.fg[0] === b.fg[0] && a.fg[1] === b.fg[1] && a.fg[2] === b.fg[2] && a.bg[0] === b.bg[0] && a.bg[1] === b.bg[1] && a.bg[2] === b.bg[2];
  let okNeg = true, ok0 = true;
  for (let i = 0; i < 64; i++) {
    const u = 40 + i * 1.37, v = 13.3 + i * 0.71, t = [30, 3, 100, 150, 175, 400][i % 6];
    const kk = 0.3 / t * (1 + (i % 3));
    const sz = perCellHashSize(t, kk, cH.handover);
    if (!same(shadeTerrain(t, 0, 0.6, u, v, 0, { ...cH, hashCell: -kk }, out()), shadeTerrain(t, 0, 0.6, u, v, 0, { ...cH, hashCell: sz }, out()))) okNeg = false;
    const fixed = t < 170 ? 2 : 8;
    if (!same(shadeTerrain(t, 0, 0.6, u, v, 0, { ...cH, hashCell: 0 }, out()), shadeTerrain(t, 0, 0.6, u, v, 0, { ...cH, hashCell: fixed }, out()))) ok0 = false;
    if (!same(shadeTerrain(t, 0, 0.6, u, v, 0, cH, out()), shadeTerrain(t, 0, 0.6, u, v, 0, { ...cH, hashCell: 0 }, out()))) ok0 = false;
  }
  check('hashCell -k == fixed cell of perCellHashSize', okNeg);
  check('hashCell 0 == explicit 2/8 m path (unchanged)', ok0);
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

console.log(`terrainShade.test.js: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
