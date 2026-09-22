// `?shadetest=1` (US-004b): compares the fast shading path (fastShade.js)
// against the designer's reference `P.util.shade`/`shadeSky`
// (design/palette.js) across every material x 8 distances (0.5 m to past
// fog-full 60 m) x 4 hit heights (including inside and above a `tintBand`),
// plus a handful of sky azimuth/elevation samples, plus the original 5
// US-004 reference cells (kept so a US-004 regression still shows up here).
// Every sample must have an EXACTLY equal glyph and fg/bg within +-4 per
// channel (US-004b AC "Fast shading path").

import { fastShade, fastShadeSky, primeFastShadeFrame } from './fastShade.js';

const TOLERANCE = 4;
const DISTANCES = [0.5, 3, 6, 10, 15, 20, 40, 65]; // spans 0.5 m to past fog-full (60 m)
const HEIGHTS = [0, 0.5, 1.2, 2.5]; // 0 = floor; 0.5/1.2 inside a tintBand; 2.5 above it
const SKY_SAMPLES = [
  { az: 0, elev: 5 }, { az: 90, elev: 20 }, { az: 180, elev: 45 }, { az: 270, elev: 60 },
];

function glyphFromIdx(idx) { return String.fromCharCode(idx + 32); }

function compare(name, refOut, fastGlyph, fastOut, rows) {
  const glyphMatch = fastGlyph === refOut.glyph;
  const fgDiff = [0, 1, 2].map((i) => Math.abs(fastOut.fg[i] - refOut.fg[i]));
  const bgDiff = [0, 1, 2].map((i) => Math.abs(fastOut.bg[i] - refOut.bg[i]));
  const colorOk = fgDiff.every((d) => d <= TOLERANCE) && bgDiff.every((d) => d <= TOLERANCE);
  const pass = glyphMatch && colorOk;
  const maxDiff = Math.max(...fgDiff, ...bgDiff);
  rows.push({
    case: name,
    'ref glyph': JSON.stringify(refOut.glyph),
    'fast glyph': JSON.stringify(fastGlyph),
    'ref fg': refOut.fg.map(Math.round).join(','),
    'fast fg': fastOut.fg.map(Math.round).join(','),
    'ref bg': refOut.bg.map(Math.round).join(','),
    'fast bg': fastOut.bg.map(Math.round).join(','),
    'max diff': Math.round(maxDiff * 100) / 100,
    pass: pass ? 'PASS' : 'FAIL',
  });
  return pass;
}

export function runShadeTest(P) {
  const U = P.util;
  const amb = P.lights.ambient;
  const hue = P.hue[amb.color];
  const L = [hue[0] * amb.intensity, hue[1] * amb.intensity, hue[2] * amb.intensity];
  primeFastShadeFrame(L);

  console.log('%c[shadetest] US-004b: fast shader vs design/palette.js reference shader', 'font-weight:bold');

  let allPass = true;
  let passCount = 0;
  let total = 0;
  let worstDiff = 0;
  const rows = [];

  // Original US-004 reference cells (kept for continuity).
  const legacyCases = [
    { name: 'stone (mid distance)', mat: 'stone', u: 2.35, v: 1.4, dist: 5, z: 1.4 },
    { name: 'stone_moss (near floor, full tint)', mat: 'stone_moss', u: 1.0, v: 0.5, dist: 4, z: 0.5 },
    { name: 'floor', mat: 'floor', u: 3.2, v: 4.1, dist: 6, z: 0 },
    { name: 'iron', mat: 'iron', u: 0.5, v: 1.2, dist: 3, z: 1.2 },
  ];
  for (const c of legacyCases) {
    const refOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyph: ' ' };
    U.shade(c.mat, L, c.u, c.v, c.dist, refOut, { z: c.z, fog: 'interior' });
    const fastOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyphIdx: 0 };
    fastShade(P, c.mat, c.u, c.v, c.dist, c.z, fastOut);
    const fastGlyph = glyphFromIdx(fastOut.glyphIdx);
    const pass = compare(c.name, refOut, fastGlyph, fastOut, rows);
    allPass = allPass && pass; total++; if (pass) passCount++;
    worstDiff = Math.max(worstDiff, Math.max(
      ...[0, 1, 2].map((i) => Math.abs(fastOut.fg[i] - refOut.fg[i])),
      ...[0, 1, 2].map((i) => Math.abs(fastOut.bg[i] - refOut.bg[i]))));
  }

  // Full matrix: every material x every distance x every height.
  for (const matKey of Object.keys(P.materials)) {
    if (P.materials[matKey].kind === 'sky') continue;
    for (const dist of DISTANCES) {
      for (const z of HEIGHTS) {
        const u = 2.35, v = z; // v mirrors z, same convention as the legacy cases above
        const refOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyph: ' ' };
        U.shade(matKey, L, u, v, dist, refOut, { z, fog: 'interior' });
        const fastOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyphIdx: 0 };
        fastShade(P, matKey, u, v, dist, z, fastOut);
        const fastGlyph = glyphFromIdx(fastOut.glyphIdx);
        const name = `${matKey} @ ${dist}m, z=${z}`;
        const pass = compare(name, refOut, fastGlyph, fastOut, rows);
        allPass = allPass && pass; total++; if (pass) passCount++;
        worstDiff = Math.max(worstDiff, Math.max(
          ...[0, 1, 2].map((i) => Math.abs(fastOut.fg[i] - refOut.fg[i])),
          ...[0, 1, 2].map((i) => Math.abs(fastOut.bg[i] - refOut.bg[i]))));
      }
    }
  }

  // Sky samples.
  const skyCase = { name: 'sky (morning, elev 30)', az: 112.5, elev: 30 };
  {
    const refOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyph: ' ' };
    U.shadeSky(skyCase.az, skyCase.elev, refOut, P.defaultTime);
    const fastOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyphIdx: 0 };
    fastShadeSky(P, skyCase.az, skyCase.elev, P.defaultTime, fastOut);
    const fastGlyph = glyphFromIdx(fastOut.glyphIdx);
    const pass = compare(skyCase.name, refOut, fastGlyph, fastOut, rows);
    allPass = allPass && pass; total++; if (pass) passCount++;
  }
  for (const s of SKY_SAMPLES) {
    const refOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyph: ' ' };
    U.shadeSky(s.az, s.elev, refOut, P.defaultTime);
    const fastOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyphIdx: 0 };
    fastShadeSky(P, s.az, s.elev, P.defaultTime, fastOut);
    const fastGlyph = glyphFromIdx(fastOut.glyphIdx);
    const pass = compare(`sky az=${s.az} elev=${s.elev}`, refOut, fastGlyph, fastOut, rows);
    allPass = allPass && pass; total++; if (pass) passCount++;
  }

  if (console.table) console.table(rows);
  else rows.forEach((r) => console.log(r));

  console.log(`[shadetest] ${passCount}/${total} pass, worst deviation ${worstDiff.toFixed(2)}`);
  console.log(allPass ? '[shadetest] ALL PASS' : '[shadetest] FAILURES ABOVE');
  return allPass;
}
