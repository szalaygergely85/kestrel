// `?shadetest=1` (US-004b): compares the fast shading path (fastShade.js)
// against the designer's reference `P.util.shade`/`shadeSky`
// (design/palette.js) across every material x 8 distances (0.5 m to past
// fog-full 60 m) x 4 hit heights (including inside and above a `tintBand`),
// plus a handful of sky azimuth/elevation samples, plus the original 5
// US-004 reference cells (kept so a US-004 regression still shows up here).
// Every sample must have an EXACTLY equal glyph and fg/bg within +-4 per
// channel (US-004b AC "Fast shading path").

import { fastShade, fastShadeSky, primeFastShadeFrame } from './fastShade.js';
import { shadeV2 } from './detailShade.js';
import { edgePass } from './edgePass.js';
import { GBuffer } from './GBuffer.js';

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

// US-028 v2 table (docs/backlog.md tech notes item 11): every v2 material x
// applicable faces x 4 distances x 3 texture positions (bed joint / head
// joint / mid-block) x 2 aoD x 3 z, comparing the fast `shadeV2` (this
// module's actual production path, engine/render/detailShade.js) against
// the designer's reference `DP.util.shade` (ALL_ON). Exact glyph, fg/bg
// within +-4/channel. Plus: a determinism row (no-shimmer AC), 8 synthetic
// edge-pass grids (one per rule), and a US-007 readability row.
const DETAIL_DISTANCES = [2, 8, 20, 35];
const DETAIL_AOD = [0.1, Infinity];
const DETAIL_Z = [0.5, 1.5, 3];
// u/v chosen relative to `stone`'s 0.8x0.4 grid so "bed joint / head joint /
// mid-block" line up for every material's own grid (materials with a finer
// grid just see a few extra joints along the way - still exercises the
// bed/head/mid code paths).
const DETAIL_POSITIONS = [
  { name: 'bed joint', u: 1.2, v: 0.0 },
  { name: 'head joint', u: 0.8, v: 0.2 },
  { name: 'mid-block', u: 1.2, v: 0.2 },
];
const MATERIAL_FACES = {
  stone: ['N', 'E', 'S', 'W'], stone_moss: ['N', 'E', 'S', 'W'], stone_scorched: ['N', 'E', 'S', 'W'],
  brick: ['N', 'E', 'S', 'W'], wood: ['N', 'E', 'S', 'W'], rubble: ['N', 'E', 'S', 'W'],
  floor: ['U'], grass: ['U'], ceiling_timber: ['D'],
};

function detailCompare(name, refOut, myOut, rows) {
  const glyphMatch = myOut.glyph === refOut.glyph;
  const fgDiff = [0, 1, 2].map((i) => Math.abs(myOut.fg[i] - refOut.fg[i]));
  const bgDiff = [0, 1, 2].map((i) => Math.abs(myOut.bg[i] - refOut.bg[i]));
  const colorOk = fgDiff.every((d) => d <= TOLERANCE) && bgDiff.every((d) => d <= TOLERANCE);
  const pass = glyphMatch && colorOk;
  rows.push({
    case: name,
    'ref glyph': JSON.stringify(refOut.glyph), 'my glyph': JSON.stringify(myOut.glyph),
    'ref fg': refOut.fg.map(Math.round).join(','), 'my fg': myOut.fg.map(Math.round).join(','),
    'max diff': Math.max(...fgDiff, ...bgDiff),
    pass: pass ? 'PASS' : 'FAIL',
  });
  return pass;
}

export function runDetailShadeTest(P, DP) {
  const rgb = P.rgb;
  const amb = P.lights.ambient;
  const hue = P.hue[amb.color];
  const L = [hue[0] * amb.intensity, hue[1] * amb.intensity, hue[2] * amb.intensity];

  console.log('%c[shadetest] US-028: v2 shader/edge pass vs design/detail-pass.js reference', 'font-weight:bold');

  let allPass = true, total = 0, passCount = 0;
  const rows = [];
  const s = { kind: 'wall', mat: 'stone', normal: 'N', planeId: 1, u: 0, v: 0, dudx: 0, dvdx: 0, dudy: 0, dvdy: 0, z: 0, aoD: Infinity, dist: 0 };
  const refOut = { glyph: ' ', fg: [0, 0, 0], bg: [0, 0, 0], b: 0, f: 0 };
  const myOut = { glyph: ' ', fg: [0, 0, 0], bg: [0, 0, 0], b: 0, f: 0 };

  for (const matKey of Object.keys(DP.materials)) {
    const m = DP.materials[matKey];
    const faces = MATERIAL_FACES[matKey] || ['N'];
    for (const face of faces) {
      const vert = face === 'N' || face === 'E' || face === 'S' || face === 'W';
      for (const dist of DETAIL_DISTANCES) {
        for (const pos of DETAIL_POSITIONS) {
          for (const aoD of DETAIL_AOD) {
            for (const z of DETAIL_Z) {
              s.kind = vert ? 'wall' : (face === 'D' ? 'ceil' : 'floor');
              s.mat = matKey; s.normal = face; s.planeId = 1;
              s.u = pos.u; s.v = vert ? z : pos.v; // walls: v = height; planes: v = world y (pos.v stands in for it)
              // Simple analytic derivatives (a flat frontal surface at this distance).
              s.dudx = dist * 0.02; s.dvdx = 0; s.dudy = 0; s.dvdy = (vert ? -1 : 1) * dist * 0.02;
              s.z = z; s.aoD = aoD; s.dist = dist;
              DP.util.shade(s, L, refOut, DP.util.ALL_ON);
              shadeV2(DP, rgb, m, s, L, myOut);
              const name = `${matKey} ${face} @${dist}m ${pos.name} aoD=${aoD} z=${z}`;
              const pass = detailCompare(name, refOut, myOut, rows);
              allPass = allPass && pass; total++; if (pass) passCount++;
            }
          }
        }
      }
    }
  }

  // No-shimmer AC: the same sample shaded twice (as if at different screen
  // positions/frames) gives an identical result - shadeV2 depends only on
  // the sample + light, never on a screen index.
  {
    s.kind = 'wall'; s.mat = 'stone'; s.normal = 'E'; s.planeId = 1;
    s.u = 3.7; s.v = 1.2; s.dudx = 0.3; s.dvdx = 0; s.dudy = 0; s.dvdy = -0.3; s.z = 1.2; s.aoD = Infinity; s.dist = 6;
    const out1 = { glyph: ' ', fg: [0, 0, 0], bg: [0, 0, 0], b: 0, f: 0 };
    const out2 = { glyph: ' ', fg: [0, 0, 0], bg: [0, 0, 0], b: 0, f: 0 };
    shadeV2(DP, rgb, DP.materials.stone, s, L, out1);
    shadeV2(DP, rgb, DP.materials.stone, s, L, out2);
    const pass = out1.glyph === out2.glyph && out1.fg.every((v, i) => v === out2.fg[i]) && out1.bg.every((v, i) => v === out2.bg[i]);
    rows.push({ case: 'determinism (same sample, two calls)', 'ref glyph': JSON.stringify(out1.glyph), 'my glyph': JSON.stringify(out2.glyph), 'ref fg': out1.fg.join(','), 'my fg': out2.fg.join(','), 'max diff': 0, pass: pass ? 'PASS' : 'FAIL' });
    allPass = allPass && pass; total++; if (pass) passCount++;
  }

  // US-007 readability row: floor, face U, sunlit vs ambient-only - level()
  // (glyph density bucket) must differ by >= 4.
  {
    const ambientOnly = L;
    const sunlit = [L[0] + 1.0, L[1] + 0.95, L[2] + 0.8]; // synthetic strong sunlight added to ambient
    s.kind = 'floor'; s.mat = 'floor'; s.normal = 'U'; s.planeId = 1;
    s.u = 3.2; s.v = 4.1; s.dudx = 0.1; s.dvdx = 0; s.dudy = 0; s.dvdy = 0.1; s.z = 0; s.aoD = Infinity; s.dist = 6;
    const outDark = { glyph: ' ', fg: [0, 0, 0], bg: [0, 0, 0], b: 0, f: 0 };
    const outLit = { glyph: ' ', fg: [0, 0, 0], bg: [0, 0, 0], b: 0, f: 0 };
    shadeV2(DP, rgb, DP.materials.floor, s, ambientOnly, outDark);
    shadeV2(DP, rgb, DP.materials.floor, s, sunlit, outLit);
    const n = DP.sets.floorFace.length;
    const levelOf = (b) => {
      const cutoff = DP.shading.cutoff, lift = DP.shading.lift, gamma = DP.shading.gamma;
      const gb = b < cutoff ? 0 : lift + (1 - lift) * Math.min(b, 1);
      if (gb < cutoff) return 0;
      return 1 + Math.min(n - 1, Math.floor(Math.pow(gb, gamma) * n));
    };
    const lvDark = levelOf(outDark.b), lvLit = levelOf(outLit.b);
    const pass = lvLit - lvDark >= 4;
    rows.push({ case: `US-007 readability: floor lvl dark=${lvDark} lit=${lvLit}`, 'ref glyph': '-', 'my glyph': '-', 'ref fg': '-', 'my fg': '-', 'max diff': lvLit - lvDark, pass: pass ? 'PASS' : 'FAIL' });
    allPass = allPass && pass; total++; if (pass) passCount++;
  }

  // Edge-pass rows: 8 synthetic 5x3 G-buffers (one per rule), each crafted
  // so exactly the target rule should fire on the CENTER cell (1,1) -> index 6.
  const edgeCases = buildEdgeCases();
  for (const ec of edgeCases) {
    const gbuf = new GBuffer(5, 3);
    gbuf.beginFrame();
    const depth = new Float32Array(15).fill(Infinity);
    for (let i = 0; i < 15; i++) {
      const c = ec.cells[i];
      if (!c) continue;
      gbuf.kind[i] = c.kind;
      gbuf.planeId[i] = c.planeId;
      depth[i] = c.dist;
      gbuf.fogF[i] = c.fogF || 0;
    }
    const rt = { cells: { glyphIdx: new Uint8Array(15), fg: new Uint8Array(60) } };
    for (let i = 0; i < 15; i++) { const fi = i * 4; rt.cells.fg[fi] = 100; rt.cells.fg[fi + 1] = 100; rt.cells.fg[fi + 2] = 100; }
    edgePass(gbuf, depth, rt, DP.edges);
    const ruleNames = ['none', 'cap', 'lip', 'side', 'convex', 'concave', 'seamFloor', 'seamCeil', 'nosing'];
    const gotRule = ruleNames[gbuf.rule[6]];
    const pass = gotRule === ec.expect;
    rows.push({ case: `edge rule: ${ec.expect}`, 'ref glyph': ec.expect, 'my glyph': gotRule, 'ref fg': '-', 'my fg': '-', 'max diff': 0, pass: pass ? 'PASS' : 'FAIL' });
    allPass = allPass && pass; total++; if (pass) passCount++;
  }

  if (console.table) console.table(rows);
  else rows.forEach((r) => console.log(r));

  console.log(`[shadetest] v2: ${passCount}/${total} pass`);
  console.log(allPass ? '[shadetest] v2 ALL PASS' : '[shadetest] v2 FAILURES ABOVE');
  return allPass;
}

// One 5x3 (cols x rows) synthetic G-buffer per edge rule, center cell (1,1)
// = index 6. `dist`/`kind`/`planeId` chosen to satisfy exactly one rule's
// condition (docs/backlog.md tech notes item 7 / `design/detail-pass.js`
// `util.edgePass`); kind 0 = sky/unwritten.
function buildEdgeCases() {
  const W = 1, S = 2, U = 3, F = 4, T = 5, C = 6; // GK_WALL..GK_CEIL (see GBuffer.js)
  const grid = (kinds, dists, planeIds, fogs) => {
    const cells = new Array(15).fill(null);
    for (let i = 0; i < 15; i++) {
      if (kinds[i] == null) continue;
      cells[i] = { kind: kinds[i], dist: dists[i], planeId: planeIds ? planeIds[i] : 1, fogF: fogs ? fogs[i] : 0 };
    }
    return cells;
  };
  const K = (v) => new Array(15).fill(v);
  const D = (v) => new Array(15).fill(v);
  const PID = (v) => new Array(15).fill(v);

  // cap: the cell above the center (index 1) is sky/farther.
  const capK = K(W); capK[1] = 0; const capD = D(5); capD[1] = 100;
  // lip: the cell below the center (index 11) is sky/farther.
  const lipK = K(W); lipK[11] = 0; const lipD = D(5); lipD[11] = 100;
  // side: left/right neighbour of the (vertical) center is sky/farther.
  const sideK = K(W); sideK[5] = 0; const sideD = D(5); sideD[5] = 100;
  // convex: center + right neighbour are both wall, different planes, and
  // both are nearer than (or equal to) their outward neighbours (l2/r2).
  // Depths kept close together (ratio well under the 1.18 "farther"
  // threshold) so `side` doesn't fire before convex/concave is even
  // checked - only the plain <= / >= compares convex/concave use.
  const convexK = K(W); const convexD = [5, 5, 5, 5, 5, 5, 5.0, 5.2, 5.2, 5, 5, 5, 5, 5, 5];
  const convexPid = PID(1); convexPid[7] = 2; convexPid[8] = 2;
  // concave: same shape, but center/right are FARTHER than their outward neighbours.
  const concaveD = [5, 5, 5, 5, 5, 5, 5.2, 5.4, 5.2, 5, 5, 5, 5, 5, 5];
  const concavePid = PID(1); concavePid[7] = 2; concavePid[8] = 2;
  // seamFloor: center is a wall, the cell below is a floor at about the same distance.
  const seamFloorK = K(W); seamFloorK[11] = F; const seamFloorD = D(5);
  // seamCeil: center is a wall, the cell above is a ceiling at about the same distance.
  const seamCeilK = K(W); seamCeilK[1] = C; const seamCeilD = D(5);
  // nosing: center is a step, the cell above is a floor/top.
  const nosingK = K(S); nosingK[1] = F; const nosingD = D(5);

  return [
    { expect: 'cap', cells: grid(capK, capD) },
    { expect: 'lip', cells: grid(lipK, lipD) },
    { expect: 'side', cells: grid(sideK, sideD) },
    { expect: 'convex', cells: grid(convexK, convexD, convexPid) },
    { expect: 'concave', cells: grid(convexK, concaveD, concavePid) },
    { expect: 'seamFloor', cells: grid(seamFloorK, seamFloorD) },
    { expect: 'seamCeil', cells: grid(seamCeilK, seamCeilD) },
    { expect: 'nosing', cells: grid(nosingK, nosingD) },
  ];
}
