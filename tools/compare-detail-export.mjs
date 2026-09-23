#!/usr/bin/env node
// US-028 parity tool (docs/backlog.md tech notes item 11, "Parity tool").
// Renders `test_room` through the full v2 pipeline (castSectors's G-buffer
// path -> computeDerivatives -> shadeSurfaces -> edgePass) at the pose/grid
// recorded in the designer's exported JSON (`design/preview/detail_pass.html`
// -> "export proposed JSON", format `ascii-quest/detail-pass-export` v1;
// checked in at `design/preview/exports/detail_pass_start.json`), and
// compares cell-by-cell: glyph equality, and fg/bg within +-8 per channel.
//
//   node tools/compare-detail-export.mjs [path/to/export.json]
//
// Exits 0 when glyph/fg/bg each match in >= 95% of cells, 1 otherwise.
// Mismatched cells are grouped by (kind, rule, material) with up to the
// first 20 (col,row) pairs per group printed (ours vs theirs), so expected
// differences (US-004b overdraw fixes the preview's port lacks; deferred
// sky) can be told apart from real bugs.

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

function main() {
  const path = process.argv[2] || 'design/preview/exports/detail_pass_start.json';
  const exp = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (exp.format !== 'ascii-quest/detail-pass-export') {
    console.error(`[compare-detail-export] unexpected format "${exp.format}"`);
    process.exit(1);
  }
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
  let glyphMatch = 0, fgMatch = 0, bgMatch = 0;
  const groups = new Map();

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

      const glyphOk = myGlyph === theirGlyph;
      const fgOk = [0, 1, 2].every((k) => Math.abs(myFg[k] - theirFg[k]) <= 8);
      const bgOk = [0, 1, 2].every((k) => Math.abs(myBg[k] - theirBg[k]) <= 8);
      if (glyphOk) glyphMatch++;
      if (fgOk) fgMatch++;
      if (bgOk) bgMatch++;

      if (!glyphOk || !fgOk || !bgOk) {
        const key = `${KIND_NAMES[gbuf.kind[i]]}/${RULE_NAMES[gbuf.rule[i]]}/${matTable.records[gbuf.mat[i]]?.key || '(none)'}`;
        let g = groups.get(key);
        if (!g) { g = { count: 0, examples: [] }; groups.set(key, g); }
        g.count++;
        if (g.examples.length < 20) {
          g.examples.push(`(${x},${y}) ours=${JSON.stringify(myGlyph)}/${myFg} theirs=${JSON.stringify(theirGlyph)}/${theirFg}`);
        }
      }
    }
  }

  const pct = (k) => (100 * k / n).toFixed(2);
  console.log(`[compare-detail-export] ${path}`);
  console.log(`  pose: ${JSON.stringify(exp.pose)}  grid: ${cols}x${rows}`);
  console.log(`  glyph match: ${pct(glyphMatch)}%  fg within +-8: ${pct(fgMatch)}%  bg within +-8: ${pct(bgMatch)}%  (n=${n})`);
  console.log('  mismatches grouped by (kind/rule/material):');
  const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [key, g] of sorted) {
    console.log(`    ${key}: ${g.count} cells`);
    for (const ex of g.examples.slice(0, 5)) console.log(`      ${ex}`);
  }

  const ok = glyphMatch / n >= 0.95 && fgMatch / n >= 0.95 && bgMatch / n >= 0.95;
  console.log(ok ? '[compare-detail-export] PASS (>=95/95/95)' : '[compare-detail-export] FAIL');
  process.exit(ok ? 0 : 1);
}

main();
