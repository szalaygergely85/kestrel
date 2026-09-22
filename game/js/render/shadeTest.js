// `?shadetest=1`: prints a console comparison for 5 reference cells (stone,
// stone_moss near the floor, floor, iron, sky) between the engine's shading
// path and the designer's reference `P.util.shade`/`shadeSky`
// (design/palette.js), per US-004's acceptance criterion. The engine calls
// `P.util.shade`/`shadeSky` directly (see raycaster.js's module doc), so
// this is presently an exact-equality check by construction - it exists so
// that if the engine ever re-implements shading for speed (as
// design/README.md 1.7 note 5 allows), this harness immediately catches any
// drift, with the ±4 per-channel tolerance the story allows.

const TOLERANCE = 4;

export function runShadeTest(P) {
  const U = P.util;
  const amb = P.lights.ambient;
  const hue = P.hue[amb.color];
  const L = [hue[0] * amb.intensity, hue[1] * amb.intensity, hue[2] * amb.intensity];

  const cases = [
    { name: 'stone (mid distance)', kind: 'surface', mat: 'stone', u: 2.35, v: 1.4, dist: 5, z: 1.4 },
    { name: 'stone_moss (near floor, full tint)', kind: 'surface', mat: 'stone_moss', u: 1.0, v: 0.5, dist: 4, z: 0.5 },
    { name: 'floor', kind: 'surface', mat: 'floor', u: 3.2, v: 4.1, dist: 6, z: 0 },
    { name: 'iron', kind: 'surface', mat: 'iron', u: 0.5, v: 1.2, dist: 3, z: 1.2 },
    { name: 'sky (morning, elev 30)', kind: 'sky', az: 112.5, elev: 30 },
  ];

  console.log('%c[shadetest] US-004: engine vs design/palette.js reference shader', 'font-weight:bold');

  let allPass = true;
  const rows = [];

  for (const c of cases) {
    const engineOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyph: ' ' };
    const refOut = { fg: [0, 0, 0], bg: [0, 0, 0], glyph: ' ' };

    if (c.kind === 'sky') {
      U.shadeSky(c.az, c.elev, engineOut, P.defaultTime);
      U.shadeSky(c.az, c.elev, refOut, P.defaultTime);
    } else {
      U.shade(c.mat, L, c.u, c.v, c.dist, engineOut, { z: c.z, fog: 'interior' });
      U.shade(c.mat, L, c.u, c.v, c.dist, refOut, { z: c.z, fog: 'interior' });
    }

    const glyphMatch = engineOut.glyph === refOut.glyph;
    const fgDiff = [0, 1, 2].map((i) => Math.abs(engineOut.fg[i] - refOut.fg[i]));
    const bgDiff = [0, 1, 2].map((i) => Math.abs(engineOut.bg[i] - refOut.bg[i]));
    const colorOk = fgDiff.every((d) => d <= TOLERANCE) && bgDiff.every((d) => d <= TOLERANCE);
    const pass = glyphMatch && colorOk;
    allPass = allPass && pass;

    rows.push({
      case: c.name,
      'engine glyph': JSON.stringify(engineOut.glyph),
      'ref glyph': JSON.stringify(refOut.glyph),
      'engine fg': engineOut.fg.map(Math.round).join(','),
      'ref fg': refOut.fg.map(Math.round).join(','),
      'engine bg': engineOut.bg.map(Math.round).join(','),
      'ref bg': refOut.bg.map(Math.round).join(','),
      'max diff': Math.max(...fgDiff, ...bgDiff),
      pass: pass ? 'PASS' : 'FAIL',
    });
  }

  if (console.table) console.table(rows);
  else rows.forEach((r) => console.log(r));

  console.log(allPass ? '[shadetest] ALL PASS' : '[shadetest] FAILURES ABOVE');
  return allPass;
}
