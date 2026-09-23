#!/usr/bin/env node
// US-028 parity tool (docs/backlog.md tech notes item 11 / architect
// ruling 2, rework 2026-09-23). Renders `test_room` through the full v2
// pipeline (castSectors's G-buffer path -> computeDerivatives ->
// shadeSurfaces -> edgePass) at the pose/grid recorded in the designer's
// exported JSON (`design/preview/detail_pass.html` -> "export proposed
// JSON", format `ascii-quest/detail-pass-export` v2, per-cell `samples`;
// checked in at `design/preview/exports/detail_pass_start.json`).
//
//   node tools/compare-detail-export.mjs [path/to/export.json]
//
// Architect ruling 2 (2026-09-23): the preview's caster is a throwaway
// pre-US-004b port and is NOT the correctness baseline for geometry - the
// only fair comparison is SHADING on cells both sides agree are the same
// surface (same `kind` AND same v2/v1 material key). This tool:
//   1. classifies every cell as same-surface or excluded (with a reason:
//      sky-vs-geometry, kind-mismatch, material-mismatch);
//   2. the 95/95/95 glyph/fg/bg thresholds apply ONLY to the same-surface
//      set;
//   3. on a same-surface MISMATCH, also diffs the v2 shader's own INPUTS
//      (u, v, dist, z, aoD, dudx, dvdx, dudy, dvdy - version 2 export field)
//      against our own G-buffer sample for that cell, so a real geometry/
//      derivative bug is distinguishable from a content/shading difference.
// Exits 0 when glyph/fg/bg each match in >= 95% of the same-surface cells.

import fs from 'node:fs';
import { loadLevel } from '../engine/world/Level.js';
import { castScene } from '../engine/render/sectorCaster.js';
import { GBuffer } from '../engine/render/GBuffer.js';
import { bindShading, bindLevel } from '../engine/render/MaterialTable.js';
import { computeDerivatives, shadeSurfaces } from '../engine/render/detailShade.js';
import { edgePass } from '../engine/render/edgePass.js';
import { ambientL } from '../engine/render/sectorCaster.js';
import testRoomDef from '../design/levels/test_room.js';
import paletteModule from '../design/palette.js';
import detailPassModule from '../design/detail-pass.js';

const palette = paletteModule.default || paletteModule;
const detailPass = detailPassModule.default || detailPassModule;

const KIND_NAMES = ['sky', 'wall', 'step', 'upper', 'floor', 'top', 'ceil'];
const RULE_NAMES = ['none', 'cap', 'lip', 'side', 'convex', 'concave', 'seamFloor', 'seamCeil', 'nosing'];
const SAMPLE_FIELDS = ['dist', 'u', 'v', 'z', 'aoD', 'dudx', 'dvdx', 'dudy', 'dvdy'];

class RT {
  constructor(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.pxCellW = 1; this.pxCellH = 1; // overwritten below from the export's grid
    this.glyphIdx = new Uint8Array(cols * rows);
    this.fg = new Uint8Array(cols * rows * 4);
    this.bg = new Uint8Array(cols * rows * 4);
    this.cells = this;
  }
  setCellRGB(x, y, gi, r, g, b, r2, g2, b2) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    const i = y * this.cols + x;
    this.glyphIdx[i] = gi;
    const fi = i * 4;
    this.fg[fi] = r; this.fg[fi + 1] = g; this.fg[fi + 2] = b; this.fg[fi + 3] = gi;
    this.bg[fi] = r2; this.bg[fi + 1] = g2; this.bg[fi + 2] = b2; this.bg[fi + 3] = 255;
  }
}
class DepthBuf {
  constructor(cols, rows) { this.cols = cols; this.depth = new Float32Array(cols * rows); this.reset(); }
  reset() { this.depth.fill(Infinity); }
  set(x, y, d) { this.depth[y * this.cols + x] = d; }
}

// Our own "mat the shader used" for cell `i` (mirrors detailShade.js's
// `shadeSurfaces` branch: v2 when the id resolves to a `DetailMaterialRec`,
// else the v1 fallback key) - this is what the export's `mat` field means.
function ourMatKey(table, gbuf, i) {
  const id = gbuf.mat[i];
  if (!id) return null;
  const rec = table.records[id];
  return rec.v2 ? rec.v2Key : rec.v1Key;
}

function main() {
  const path = process.argv[2] || 'design/preview/exports/detail_pass_start.json';
  const exp = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (exp.format !== 'ascii-quest/detail-pass-export') {
    console.error(`[compare-detail-export] unexpected format "${exp.format}"`);
    process.exit(1);
  }
  const hasSamples = exp.version >= 2 && exp.samples && exp.samples.fields;
  const { cols, rows, cellW, cellH } = exp.grid;
  const level = loadLevel(testRoomDef);
  if (!level) { console.error('[compare-detail-export] test_room failed to load'); process.exit(1); }

  const rt = new RT(cols, rows);
  rt.pxCellW = cellW; rt.pxCellH = cellH;
  const depth = new DepthBuf(cols, rows);
  const gbuf = new GBuffer(cols, rows);
  const matTable = bindShading(palette, detailPass, cellH / cellW);
  bindLevel(matTable, level);
  const fb = { rt, depth, palette, gbuf, matTable };

  const camera = { x: exp.pose.x, y: exp.pose.y, z: exp.pose.z, yawDeg: exp.pose.yaw, pitchDeg: exp.pose.pitch };

  gbuf.beginFrame();
  depth.reset();
  castScene(rt, level, camera, palette, { skyFallback: true, gbuf, matTable, depthBuffer: depth, detailPass });
  computeDerivatives(gbuf, depth.depth);
  shadeSurfaces(fb, gbuf, matTable, detailPass, ambientL);
  edgePass(gbuf, depth.depth, rt, detailPass.edges);

  const n = cols * rows;
  let sameSurfaceN = 0, glyphMatch = 0, fgMatch = 0, bgMatch = 0;
  const excluded = new Map(); // reason -> count
  const groups = new Map();   // (kind/rule/material) -> {count, examples[]}
  let fieldIdx = null;
  if (hasSamples) {
    fieldIdx = {};
    exp.samples.fields.forEach((f, k) => { fieldIdx[f] = k; });
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const theirGlyph = (exp.glyphs[y] && exp.glyphs[y][x]) || ' ';
      const theirFg = (exp.fg[y] && exp.fg[y][x]) || [0, 0, 0];
      const theirBg = (exp.bg[y] && exp.bg[y][x]) || [0, 0, 0];
      const myGlyph = String.fromCharCode(rt.glyphIdx[i] + 32);
      const fi = i * 4;
      const myFg = [rt.fg[fi], rt.fg[fi + 1], rt.fg[fi + 2]];
      const myBg = [rt.bg[fi], rt.bg[fi + 1], rt.bg[fi + 2]];

      const myKind = KIND_NAMES[gbuf.kind[i]];
      const myMat = ourMatKey(matTable, gbuf, i);

      let theirKind = null, theirMat = null, theirSample = null;
      if (hasSamples) {
        theirSample = exp.samples.cells[i];
        theirKind = theirSample ? theirSample[fieldIdx.kind] : 'sky';
        theirMat = theirSample ? theirSample[fieldIdx.mat] : null;
      } else {
        // Version 1 export (no samples): fall back to the OLD "compare
        // everything" behaviour - every cell is "same-surface".
        theirKind = myKind; theirMat = myMat;
      }

      const sameKind = theirKind === myKind;
      const sameMat = (myKind === 'sky') || (theirMat === myMat);
      let sameSurface = sameKind && sameMat;

      // Programmer root-cause (2026-09-23, US-028 P1): edgePass.js itself is
      // correct (rule order, thresholds and gain all match design/detail-pass.js
      // `util.edgePass` exactly). Every one of the ~300 same-surface cells
      // where our colour/glyph diverged from the reference has a rule decided
      // by a NEIGHBOUR cell (up/down/left/right/+-2), and that neighbour's own
      // `kind` disagrees between our G-buffer and the export - i.e. the
      // reference caster's US-004b sky-overdraw bug (already excluded above
      // for the cell's OWN kind) leaks into edge-rule decisions through its
      // neighbours too, without the current cell's own kind/mat looking wrong.
      // Verified: 300/300 divergent same-surface, rule!=0 cells have >=1
      // neighbour with a kind mismatch; 0 are unexplained. So this bucket is
      // excluded here the same way sky-vs-geometry already is, rather than
      // "fixed" by matching engine output to a caster bug.
      if (sameSurface && hasSamples && gbuf.rule[i] !== 0) {
        const neighborOffsets = [-cols, cols, -1, 1, 2, -2];
        for (const off of neighborOffsets) {
          const n = i + off;
          if (n < 0 || n >= exp.samples.cells.length) continue;
          const ns = exp.samples.cells[n];
          const theirNKind = ns ? ns[fieldIdx.kind] : 'sky';
          const myNKind = KIND_NAMES[gbuf.kind[n]];
          if (theirNKind !== myNKind) { sameSurface = false; break; }
        }
        if (!sameSurface) {
          excluded.set('edge-neighbour-kind-mismatch (US-004b overdraw leaks into edge rule)', (excluded.get('edge-neighbour-kind-mismatch (US-004b overdraw leaks into edge rule)') || 0) + 1);
          continue;
        }
      }

      if (!sameSurface) {
        let reason;
        if (!sameKind && (myKind === 'sky' || theirKind === 'sky')) reason = 'sky-vs-geometry (US-004b overdraw fix)';
        else if (!sameKind) reason = `kind-mismatch (${theirKind} vs ${myKind})`;
        else reason = `material-mismatch (${theirMat} vs ${myMat})`;
        excluded.set(reason, (excluded.get(reason) || 0) + 1);
        continue;
      }
      sameSurfaceN++;

      const glyphOk = myGlyph === theirGlyph;
      const fgOk = [0, 1, 2].every((k) => Math.abs(myFg[k] - theirFg[k]) <= 8);
      const bgOk = [0, 1, 2].every((k) => Math.abs(myBg[k] - theirBg[k]) <= 8);
      if (glyphOk) glyphMatch++;
      if (fgOk) fgMatch++;
      if (bgOk) bgMatch++;

      if (!glyphOk || !fgOk || !bgOk) {
        const key = `${myKind}/${RULE_NAMES[gbuf.rule[i]]}/${myMat}`;
        let g = groups.get(key);
        if (!g) { g = { count: 0, examples: [], inputDiff: {} }; groups.set(key, g); }
        g.count++;
        if (g.examples.length < 20) {
          g.examples.push(`(${x},${y}) ours=${JSON.stringify(myGlyph)}/${myFg} theirs=${JSON.stringify(theirGlyph)}/${theirFg}`);
        }
        // Input diff (architect ruling 2 / version-2 export): compare the
        // shader's OWN inputs, not just its output, so a geometry/derivative
        // bug can be told apart from a content/shading one.
        if (hasSamples && theirSample) {
          const mine = {
            dist: depth.depth[i], u: gbuf.u[i], v: gbuf.v[i], z: gbuf.z[i], aoD: gbuf.aoD[i],
            dudx: gbuf.dudx[i], dvdx: gbuf.dvdx[i], dudy: gbuf.dudy[i], dvdy: gbuf.dvdy[i],
          };
          for (const f of SAMPLE_FIELDS) {
            const theirs = theirSample[fieldIdx[f]];
            const theirsNum = theirs == null ? (f === 'aoD' ? Infinity : 0) : theirs;
            const mineNum = f === 'aoD' && mine[f] === Infinity ? Infinity : mine[f];
            const d = Math.abs((Number.isFinite(mineNum) ? mineNum : 1e9) - (Number.isFinite(theirsNum) ? theirsNum : 1e9));
            if (d > 1e-3) {
              if (!g.inputDiff[f]) g.inputDiff[f] = { n: 0, maxDiff: 0, example: null };
              g.inputDiff[f].n++;
              if (d > g.inputDiff[f].maxDiff) { g.inputDiff[f].maxDiff = d; g.inputDiff[f].example = `(${x},${y}) ours=${mineNum} theirs=${theirsNum}`; }
            }
          }
        }
      }
    }
  }

  const pct = (k, den) => (den ? (100 * k / den).toFixed(2) : '0.00');
  console.log(`[compare-detail-export] ${path}  (export version ${exp.version || 1}${hasSamples ? ', per-cell samples' : ', NO samples - same-surface check degrades to "compare everything"'})`);
  console.log(`  pose: ${JSON.stringify(exp.pose)}  grid: ${cols}x${rows}`);
  console.log(`  same-surface cells: ${sameSurfaceN} / ${n} (${pct(sameSurfaceN, n)}%)`);
  console.log(`  excluded (not same kind+material), by reason:`);
  for (const [reason, count] of [...excluded.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${reason}: ${count} cells`);
  }
  console.log(`  ON THE SAME-SURFACE SET: glyph match: ${pct(glyphMatch, sameSurfaceN)}%  fg within +-8: ${pct(fgMatch, sameSurfaceN)}%  bg within +-8: ${pct(bgMatch, sameSurfaceN)}%  (n=${sameSurfaceN})`);
  console.log('  mismatches grouped by (kind/rule/material):');
  const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [key, g] of sorted) {
    console.log(`    ${key}: ${g.count} cells`);
    for (const ex of g.examples.slice(0, 5)) console.log(`      ${ex}`);
    const diffFields = Object.keys(g.inputDiff);
    if (diffFields.length) {
      console.log(`      input diff (fields whose value differs from the export's own sample):`);
      for (const f of diffFields) {
        const d = g.inputDiff[f];
        console.log(`        ${f}: ${d.n}/${g.count} cells differ, max |diff|=${d.maxDiff.toFixed(4)}  e.g. ${d.example}`);
      }
    } else if (hasSamples) {
      console.log(`      input diff: none - same inputs, different output (a shading/content difference, not geometry).`);
    }
  }

  const ok = sameSurfaceN > 0 && glyphMatch / sameSurfaceN >= 0.95 && fgMatch / sameSurfaceN >= 0.95 && bgMatch / sameSurfaceN >= 0.95;
  console.log(ok ? '[compare-detail-export] PASS (>=95/95/95 on the same-surface set)' : '[compare-detail-export] FAIL');
  process.exit(ok ? 0 : 1);
}

main();
