// US-016 Node tests for `shadeTerrainFar` (docs/architecture.md 14.4 item 5).
import { shadeTerrainFar } from './terrainShade.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL:', name); } }

const TLOOK_WIDTH = 8;
function makeTlook() {
  const rows = 2; // 0 grass, 1 water (glint)
  const tlook = new Float32Array(4 * TLOOK_WIDTH * rows);
  function setColours(row, dark, mid, light) {
    const base = row * TLOOK_WIDTH * 4;
    [dark, mid, light].forEach((c, i) => { const o = base + i * 4; tlook[o] = c[0]; tlook[o + 1] = c[1]; tlook[o + 2] = c[2]; });
  }
  function setGlyphs(row, near, mid, far) {
    const base = row * TLOOK_WIDTH * 4;
    [near, mid, far].forEach((codes, bi) => {
      const o = base + (4 + bi) * 4;
      let x = 0; for (let i = 0; i < codes.length; i++) x |= codes[i] << (8 * i);
      tlook[o] = x; tlook[o + 1] = codes.length;
    });
  }
  setColours(0, [0.1, 0.2, 0.1], [0.2, 0.4, 0.2], [0.3, 0.6, 0.3]);
  setGlyphs(0, [0, 1], [2], [3]);
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
  const o1 = shadeTerrainFar(100, 0, 0.9, 0, 0, 0, ctx, out());   // < 150 -> near band
  const o2 = shadeTerrainFar(300, 0, 0.9, 0, 0, 0, ctx, out());   // < 600 -> mid band
  const o3 = shadeTerrainFar(1000, 0, 0.9, 0, 0, 0, ctx, out());  // >= 600 -> far band
  check('near band glyph is one of the near set', o1.glyph === 0 || o1.glyph === 1);
  check('mid band glyph is the mid set code', o2.glyph === 2);
  check('far band glyph is the far set code', o3.glyph === 3);
}

// Deterministic: same inputs -> same glyph/colour (world-keyed hash).
{
  const a = shadeTerrainFar(200, 0, 0.5, 123.4, 567.8, 10, ctx, out());
  const b = shadeTerrainFar(200, 0, 0.5, 123.4, 567.8, 10, ctx, out());
  check('deterministic: same inputs -> same glyph', a.glyph === b.glyph);
  check('deterministic: same inputs -> same fg', a.fg[0] === b.fg[0] && a.fg[1] === b.fg[1] && a.fg[2] === b.fg[2]);
}

// All byte outputs are in range.
{
  const bVals = [0.2, 0.6, 0.9];
  const tVals = [100, 400, 1200, 1450];
  for (const b of bVals) for (const t of tVals) {
    const o = shadeTerrainFar(t, 0, b, 42, 99, 0, ctx, out());
    check(`byte range at b=${b} t=${t}: fg`, o.fg.every((v) => v >= 0 && v <= 255));
    check(`byte range at b=${b} t=${t}: bg`, o.bg.every((v) => v >= 0 && v <= 255));
    check(`byte range at b=${b} t=${t}: glyph`, o.glyph >= 0 && o.glyph <= 94);
  }
}

// Heavy fog (t near/at 1500) -> glyph forced to space (glyphIdx 0).
{
  const o = shadeTerrainFar(1490, 0, 0.9, 0, 0, 0, ctx, out());
  check('heavy fog: glyph is space (0)', o.glyph === 0);
}

// Water glint only touches the glint-flagged type (1), never plain grass (0).
{
  let sawAlt = false;
  for (let ts = 0; ts < 20; ts++) {
    const o = shadeTerrainFar(100, 1, 0.9, 8, 8, ts, ctx, out());
    if (o.glyph === 5) sawAlt = true;
  }
  check('water: glint can select the alternate glyph over enough timeSec samples', sawAlt);
}

// BUG-OWN-004 (row 25i): TLOOK colours are linear 0..1 (not 0..255 bytes) -
// `shadeTerrainFar` must scale by 255 itself. Before the fix, near/well-lit
// terrain rendered near-black because 0.1..0.3-range floats were written
// straight to a byte channel. Grass type 0's brightest tier (i=2, "light")
// is [0.3, 0.6, 0.3]; at strong lighting (b=0.9, near band, no fog) the fg
// byte must be a plausible mid/bright green, not near 0.
{
  const o = shadeTerrainFar(100, 0, 0.9, 0, 0, 0, ctx, out());
  check('BUG-OWN-004: near terrain fg is not near-black (r)', o.fg[0] > 40);
  check('BUG-OWN-004: near terrain fg is not near-black (g)', o.fg[1] > 80);
  check('BUG-OWN-004: near terrain fg is not near-black (b)', o.fg[2] > 40);
}

console.log(`terrainShade.test.js: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
