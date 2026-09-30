// engine/ui/overlay.test.js (RE-07a, docs/architecture.md 28.9 tests 1-9). Headless Node ESM.
// Run: node --expose-gc engine/ui/overlay.test.js  (zero-alloc check is skipped without --expose-gc)
import { createOverlay, applyOverlay, OVL_MAX_OPS } from './overlay.js';
import { CellBuffer } from '../render/CellBuffer.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const COLS = 400, ROWS = 150;
const STYLES = {
  select: { glyphs: '-|\\/', fg: [10, 200, 30] },
  hover: { glyph: 'o', fg: [200, 200, 20] },
  barFill: { glyph: '#', fg: [220, 30, 30] },
  barEmpty: { glyph: '.', fg: [60, 60, 60] },
  box: { glyphs: '-|+*', fg: [255, 255, 255] },
};
function mk(cols = COLS, rows = ROWS) {
  const ov = createOverlay(cols, rows);
  ov.setStyles(STYLES);
  return ov;
}
const PITCHED = { x: 0, y: 40, z: 60, yawDeg: 0, pitchDeg: -58, vfovDeg: 36, projection: 'pitched' };
const SHEAR = { x: 0, y: 0, z: 2, yawDeg: 0, pitchDeg: -5 };

function cellsOf(ov) {
  const out = [];
  for (let t = 0; t < ov.stats.cells; t++) out.push(ov.touched[t]);
  return out;
}

// 1. closed ring at pitch -58: every cell has >= 2 8-neighbours, symmetric about the centre column.
{
  const ov = mk();
  ov.clear(); ov.ring(0, 0, 0, 3, ov.styleId('select')); ov.flush(PITCHED);
  const cells = cellsOf(ov);
  const set = new Set(cells);
  let bad = 0;
  for (const i of cells) {
    const c = i % COLS, r = (i / COLS) | 0;
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dc || dr) && set.has((r + dr) * COLS + c + dc)) n++;
    if (n < 2) bad++;
  }
  ok('1a: ring has cells', cells.length > 20, `${cells.length}`);
  ok('1b: closed loop (every cell >= 2 neighbours)', bad === 0, `bad=${bad}`);
  let sym = true;
  const cx = COLS / 2;
  for (const i of cells) {
    const c = i % COLS, r = (i / COLS) | 0;
    const m = 2 * Math.round(cx) - c; // mirror about centre column, tolerance 1
    if (!(set.has(r * COLS + m) || set.has(r * COLS + m - 1) || set.has(r * COLS + m + 1))) sym = false;
  }
  ok('1c: symmetric about the centre column within 1 cell', sym);
}

// 2. depth test vs a synthetic wall / open ground.
{
  const ov = mk();
  ov.clear(); ov.ring(0, 0, 0, 3, ov.styleId('select')); ov.flush(PITCHED);
  const cells = cellsOf(ov);
  const n = COLS * ROWS;
  const open = new Float32Array(n).fill(1e6);
  const cb1 = new CellBuffer(COLS, ROWS);
  applyOverlay(ov, cb1, open);
  let shown = 0; for (const i of cells) if (cb1.glyphIdx[i]) shown++;
  ok('2a: ring visible on open ground (sky depth)', shown === cells.length, `${shown}/${cells.length}`);
  // wall: depth much closer than ref on the left half
  const wall = new Float32Array(n).fill(1e6);
  for (const i of cells) if (i % COLS < COLS / 2) wall[i] = ov.ovlZ[i] - 5;
  const cb2 = new CellBuffer(COLS, ROWS);
  applyOverlay(ov, cb2, wall);
  let hidden = 0, vis = 0;
  for (const i of cells) { const s = cb2.glyphIdx[i] !== 0; if (i % COLS < COLS / 2) { if (!s) hidden++; } else if (s) vis++; }
  const left = cells.filter((i) => i % COLS < COLS / 2).length;
  ok('2b: ring hidden behind a closer wall, visible elsewhere', hidden === left && vis === cells.length - left && left > 0, `${hidden}/${left} ${vis}`);
  // within bias -> passes
  const near = new Float32Array(n);
  for (const i of cells) near[i] = ov.ovlZ[i] - 0.2;
  const cb3 = new CellBuffer(COLS, ROWS);
  applyOverlay(ov, cb3, near);
  let passed = 0; for (const i of cells) if (cb3.glyphIdx[i]) passed++;
  ok('2c: depth within bias passes', passed === cells.length);
}

// 3. bar fill count at 0 / 0.5 / 1
{
  const ov = mk();
  const f = ov.styleId('barFill'), e = ov.styleId('barEmpty');
  const fillOf = (frac) => {
    ov.clear(); ov.bar(0, 0, 2, frac, 10, f, e); ov.flush(PITCHED);
    let nf = 0, ne = 0;
    for (const i of cellsOf(ov)) { const g = ov.ovl[i * 4 + 3] + 32; if (g === 35) nf++; else if (g === 46) ne++; }
    return [nf, ne];
  };
  const a = fillOf(0), b = fillOf(0.5), c = fillOf(1);
  ok('3: bar fill 0/0.5/1', a[0] === 0 && a[1] === 10 && b[0] === 5 && b[1] === 5 && c[0] === 10 && c[1] === 0, JSON.stringify([a, b, c]));
}

// 4. rect: normalised, border only, ref 0
{
  const ov = mk(40, 20);
  ov.clear(); ov.rect(30, 15, 10, 5, ov.styleId('box')); ov.flush(SHEAR);
  const cells = cellsOf(ov);
  let inside = 0, allZero = true;
  for (const i of cells) { const c = i % 40, r = (i / 40) | 0; if (c > 10 && c < 30 && r > 5 && r < 15) inside++; if (ov.ovlZ[i] !== 0) allZero = false; }
  ok('4: rect border only (2*21 + 2*9 = 60), normalised, ref 0', cells.length === 60 && inside === 0 && allZero, `${cells.length}`);
  const cb = new CellBuffer(40, 20);
  const d = new Float32Array(800).fill(1); // wall at depth 1: screen ops are not depth tested
  cb.mask.fill(1); cb.bg[0] = 77;
  applyOverlay(ov, cb, d);
  let shown = 0; for (const i of cells) if (cb.glyphIdx[i]) shown++;
  ok('4b (a4): rect ignores depth; composite writes glyph+fg only (mask/bg untouched)',
    shown === 60 && cb.mask.every((m) => m === 1) && cb.bg[0] === 77 && cb.fg[cells[0] * 4 + 3] === cb.glyphIdx[cells[0]]);
}

// 5. overlap: nearer wins, rect wins
{
  const ov = mk();
  const a = ov.styleId('hover'), b = ov.styleId('barFill');
  ov.clear(); ov.bar(0, 0, 2, 1, 1, a, a); ov.flush(PITCHED);
  const i0 = cellsOf(ov)[0];
  const z0 = ov.ovlZ[i0];
  // a nearer bar at the same world xy but higher z towards the camera (y larger = nearer for yaw 0? use camera-side offset)
  ov.clear(); ov.bar(0, 0, 2, 1, 1, a, a); ov.bar(0, 0, 2, 1, 1, b, b); ov.flush(PITCHED);
  ok('5a: tie -> first op wins', ov.ovl[i0 * 4 + 3] + 32 === 'o'.charCodeAt(0));
  ov.clear(); ov.bar(0, 0, 2, 1, 1, a, a);
  ov.rect(i0 % COLS, (i0 / COLS) | 0, (i0 % COLS) + 2, ((i0 / COLS) | 0) + 2, ov.styleId('box')); ov.flush(PITCHED);
  ok('5b: rect wins over a world op', ov.ovl[i0 * 4 + 3] + 32 === '-'.charCodeAt(0) && ov.ovlZ[i0] === 0 && z0 > 0);
  // nearer wins: same cell, two bars of different ref (raise z changes cell; use shear cam looking along +(-y)): two points on the same ray
  ov.clear();
  ov.bar(0, -30, 2, 1, 1, a, a); ov.bar(0, -10, 2, 1, 1, b, b); // farther first
  ov.flush(SHEAR);
  const cs = cellsOf(ov);
  ok('5c: two bars on one view ray -> one cell, nearer (second) wins', cs.length === 1 && ov.ovl[cs[0] * 4 + 3] + 32 === '#'.charCodeAt(0), `${cs.length}`);
}

// 6. pitch-0 pitched == shear cam (28.1 parity anchor), same cells
{
  const aspect = COLS / ROWS;
  const vfov = 2 * Math.atan(Math.tan((75 / 2) * Math.PI / 180) / aspect) * 180 / Math.PI;
  const camS = { x: 5, y: 8, z: 3, yawDeg: 20, pitchDeg: 0 };
  const camP = { x: 5, y: 8, z: 3, yawDeg: 20, pitchDeg: 0, vfovDeg: vfov, projection: 'pitched' };
  const rec = (ov) => { ov.clear(); ov.ring(9, -4, 0, 1.5, ov.styleId('select')); ov.bar(8, -3, 2, 0.5, 8, ov.styleId('barFill'), ov.styleId('barEmpty')); };
  const o1 = mk(), o2 = mk();
  rec(o1); o1.flush(camS); rec(o2); o2.flush(camP);
  const s1 = cellsOf(o1).slice().sort((x, y) => x - y), s2 = cellsOf(o2).slice().sort((x, y) => x - y);
  ok('6: pitch-0 pitched == shear cells', s1.length > 10 && s1.length === s2.length && s1.every((v, k) => v === s2[k]), `${s1.length} vs ${s2.length}`);
}

// 7. unknown style throws; overflow counts dropped, never throws
{
  const ov = mk();
  let threw = false; try { ov.styleId('nope'); } catch (_e) { threw = true; }
  ok('7a: unknown style key throws', threw);
  ov.clear();
  for (let k = 0; k < OVL_MAX_OPS + 7; k++) ov.ring(0, 0, 0, 1, 0);
  ok('7b: overflow -> dropped counter, ops capped', ov.stats.dropped === 7 && ov.stats.ops === OVL_MAX_OPS, JSON.stringify(ov.stats));
  ov.clear();
  ok('7c: clear resets counters', ov.stats.dropped === 0 && ov.stats.ops === 0);
}

// 8. zero allocation over 1000 frames of 200 rings + 200 bars
function frame(ov, cb, depth, f, e, s, k) {
  ov.clear();
  for (let u = 0; u < 200; u++) {
    const x = (u % 20) * 2 - 20, y = ((u / 20) | 0) * 2 - 10 + (k % 3) * 0.01;
    ov.ring(x, y, 0, 0.8, s);
    ov.bar(x, y, 2, (u % 11) / 10, 8, f, e);
  }
  ov.renderCpu(PITCHED, cb, depth);
}
{
  const ov = mk();
  const cb = new CellBuffer(COLS, ROWS);
  const depth = new Float32Array(COLS * ROWS).fill(1e6);
  const f = ov.styleId('barFill'), e = ov.styleId('barEmpty'), s = ov.styleId('select');
  for (let k = 0; k < 20; k++) frame(ov, cb, depth, f, e, s, k); // warm
  if (global.gc) {
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let k = 0; k < 1000; k++) frame(ov, cb, depth, f, e, s, k);
    global.gc();
    const grew = process.memoryUsage().heapUsed - before;
    ok('8: zero alloc over 1000 frames of 200 rings + 200 bars (heap growth < 64 KB)', grew < 65536, `grew ${grew} B`);
  } else {
    console.log('  (skip test 8: run with --expose-gc)');
  }
  ok('8b: frames produced cells', ov.stats.cells > 500 && ov.stats.dropped === 0, JSON.stringify(ov.stats));
}

// 9. perf (warn-only): 60+60 <= 0.3 ms, 200+200 <= 0.6 ms
{
  const ov = mk();
  const cb = new CellBuffer(COLS, ROWS);
  const depth = new Float32Array(COLS * ROWS).fill(1e6);
  const f = ov.styleId('barFill'), e = ov.styleId('barEmpty'), s = ov.styleId('select');
  for (const [n, bar] of [[60, 0.3], [200, 0.6]]) {
    const run = () => {
      ov.clear();
      for (let u = 0; u < n; u++) { const x = (u % 20) * 2 - 20, y = ((u / 20) | 0) * 2 - 10; ov.ring(x, y, 0, 0.8, s); ov.bar(x, y, 2, 0.5, 8, f, e); }
      ov.renderCpu(PITCHED, cb, depth);
    };
    for (let k = 0; k < 50; k++) run();
    const t0 = performance.now();
    for (let k = 0; k < 200; k++) run();
    const ms = (performance.now() - t0) / 200;
    console.log(`  ${ms <= bar ? 'ok  ' : 'WARN'} perf ${n}+${n}: ${ms.toFixed(3)} ms (bar ${bar})`);
  }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((x) => '  - ' + x).join('\n')); process.exit(1); }
console.log('ALL PASS');
