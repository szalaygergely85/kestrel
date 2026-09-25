// US-016 Node tests for `shadeTerrain` (docs/architecture.md 14.4 item 5,
// near-detail extension 23.4).
import { shadeTerrain, hashFast01 } from './terrainShade.js';

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

console.log(`terrainShade.test.js: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
