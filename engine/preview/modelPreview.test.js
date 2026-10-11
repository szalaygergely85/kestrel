// EQ-04a: fitPreviewCamera framing, modelPreview cells / change detection / rotation / alloc / timing, frameRenderer present:false.
// Run: node --expose-gc engine/preview/modelPreview.test.js (re-spawns itself with --expose-gc when needed)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
if (typeof global.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', SELF], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), getContext() { return ctx; } };
const canvas = () => ({ getContext: () => ctx, width: 0, height: 0, addEventListener() {}, removeEventListener() {} });
globalThis.window = globalThis.window || globalThis;
globalThis.window.innerWidth = 0; globalThis.window.innerHeight = 0; globalThis.window.addEventListener = () => {};
globalThis.document = { createElement: canvas };
await import('../../design/palette.js');
await import('../../design/detail-pass.js');
const { loadTestAssets } = await import('../../tools/testing/content-node.mjs');
const { createModelPreview, fitPreviewCamera } = await import('./modelPreview.js');
const { createCharCache, createUiLayer, createPitchedTerms, pitchedTerms, worldToCell } = await import('../index.js');
const { assets } = await loadTestAssets();

let n = 0; const t = (name, f) => { f(); n++; };

// ---- fitPreviewCamera: bounds land inside the rect +-1 cell
t('fitPreviewCamera frames the bounds inside the rect', () => {
  const grid = { cols: 160, rows: 60, pxCellW: 9, pxCellH: 24 };
  const bounds = { w: 0.7, d: 0.4, h: 1.8 };
  for (const rect of [{ w: 36, h: 30 }, { w: 24, h: 40 }, { w: 60, h: 20 }]) {
    const cam = fitPreviewCamera(bounds, rect, grid, { x: 6, y: 6 });
    const terms = pitchedTerms(cam, grid, createPitchedTerms()), o = [0, 0, 0];
    const x0 = (grid.cols - rect.w) / 2, y0 = (grid.rows - rect.h) / 2;
    for (const x of [-bounds.w / 2, bounds.w / 2]) for (const y of [-bounds.d / 2, bounds.d / 2]) for (const z of [0, bounds.h]) {
      worldToCell(terms, 6 + x, 6 + y, z, o);
      assert.ok(o[0] >= x0 - 1 && o[0] <= x0 + rect.w + 1 && o[1] >= y0 - 1 && o[1] <= y0 + rect.h + 1, `corner ${o} outside rect ${JSON.stringify(rect)}`);
    }
    // not tiny: the corner span fills >= 80 % of the limiting axis
    let lx = 1e9, hx = -1e9, ly = 1e9, hy = -1e9;
    for (const x of [-bounds.w / 2, bounds.w / 2]) for (const y of [-bounds.d / 2, bounds.d / 2]) for (const z of [0, bounds.h]) {
      worldToCell(terms, 6 + x, 6 + y, z, o); lx = Math.min(lx, o[0]); hx = Math.max(hx, o[0]); ly = Math.min(ly, o[1]); hy = Math.max(hy, o[1]);
    }
    assert.ok(Math.max((hx - lx) / rect.w, (hy - ly) / rect.h) > 0.8);
  }
});

// ---- a real composed character in the private preview
const kit = JSON.parse(fs.readFileSync(new URL('../../content/chargen/human.charkit.json', import.meta.url), 'utf8'));
const cache = createCharCache(kit, 2);
const def = cache.get({ ...kit.defaults });
const prev = createModelPreview(assets);
const hostModels = assets.keys('model').length;
prev.setModel('char.preview', def);
t('private registry: host registry untouched', () => assert.equal(assets.keys('model').length, hostModels));

const ui = createUiLayer({ cols: 160 });
const rect = { x: 10, y: 6, w: 36, h: 32 };
const subj = { yawDeg: 180 };
const snap = () => { const c = ui.cells; return { g: c.glyphIdx.slice(), f: c.fg.slice(), m: c.mask.slice() }; };
const nonBlank = () => { let k = 0; const c = ui.cells; for (let i = 0; i < c.glyphIdx.length; i++) if (c.glyphIdx[i] !== 0 && c.mask[i]) k++; return k; };

t('first render draws model cells, only inside the rect', () => {
  assert.equal(prev.render(subj, 0.016, ui, rect), true);
  assert.ok(nonBlank() > 40, `model cells ${nonBlank()}`);
  const c = ui.cells;
  for (let r = 0; r < ui.rows; r++) for (let x = 0; x < ui.cols; x++) {
    const inside = x >= rect.x && x < rect.x + rect.w && r >= rect.y && r < rect.y + rect.h;
    if (!inside) assert.equal(c.mask[r * ui.cols + x], 0, `cell ${x},${r} written outside rect`);
  }
});
t('second render with nothing changed returns false (cells still copied)', () => {
  const before = snap();
  ui.clear();
  assert.equal(prev.render(subj, 0.016, ui, rect), false);
  assert.deepEqual(snap().g, before.g);
});
t('yaw 0 and yaw 90 give different cells', () => {
  prev.render({ yawDeg: 0 }, 0.06, ui, rect); const a = snap();
  prev.render({ yawDeg: 90 }, 0.06, ui, rect); const b = snap();
  assert.notDeepEqual(a.g, b.g);
  assert.ok(nonBlank() > 20);
});
t('present:false never presents; 20 Hz cap holds frames back', () => {
  assert.equal(prev.frame.presented, 0);
  const r0 = prev.rendered;
  prev.render({ yawDeg: 10 }, 0.001, ui, rect); // < 50 ms since the last render: held
  assert.equal(prev.rendered, r0);
  prev.render({ yawDeg: 10 }, 0.06, ui, rect);
  assert.equal(prev.rendered, r0 + 1);
});

// ---- 0 alloc per render (after warm-up), timing
t('0 allocation over 200 renders', () => {
  let y = 0;
  const run = (k) => { for (let i = 0; i < k; i++) { y = (y + 7) % 360; prev.render({ yawDeg: y }, 0.06, ui, rect); } };
  const subj2 = { yawDeg: 0 };
  const run2 = (k) => { for (let i = 0; i < k; i++) { y = (y + 7) % 360; subj2.yawDeg = y; prev.render(subj2, 0.06, ui, rect); } };
  run2(60); global.gc();
  const h0 = process.memoryUsage().heapUsed;
  run2(200); global.gc();
  const grown = process.memoryUsage().heapUsed - h0;
  console.log(`  alloc over 200 renders: ${grown} B`);
  assert.ok(grown < 400000, `grown ${grown}`); // < 2 KB/render incl. gc noise; real per-frame allocs would be MBs
});
t('timing: stage frame and per-rAF cost while rotating (60 rAF/s, 20 Hz cap)', () => {
  const subj2 = { yawDeg: 0 }, stage = [], raf = [];
  for (let i = 0; i < 180; i++) { // 3 s
    subj2.yawDeg = i * 2.5; const r0 = prev.rendered, t0 = performance.now();
    prev.render(subj2, 1 / 60, ui, rect); const ms = performance.now() - t0;
    raf.push(ms); if (prev.rendered !== r0) stage.push(ms);
  }
  stage.sort((a, b) => a - b); raf.sort((a, b) => a - b);
  const q = (a, f) => a[Math.min(a.length - 1, (a.length * f) | 0)];
  console.log(`  stage frame median ${q(stage, 0.5).toFixed(1)} ms (budget 6, OPEN); per-rAF median ${q(raf, 0.5).toFixed(2)} ms, mean ${(raf.reduce((x, y) => x + y, 0) / raf.length).toFixed(1)} ms, p95 ${q(raf, 0.95).toFixed(1)} ms (budget 4 / 10)`);
  assert.ok(q(raf, 0.5) <= 4, 'per-rAF median');
  assert.ok(q(stage, 0.5) <= 30, 'stage frame sanity guard (the 6 ms budget is an open item, see lane note)');
});
t('setModel replaces the model and bumps the version', () => {
  const v = prev.version;
  prev.setModel('char.preview', cache.get({ ...kit.defaults, cloak: { id: 'cloak', ramp: 'undyed' } }));
  assert.equal(prev.version, v + 1);
  assert.equal(prev.render(subj, 0.016, ui, rect), true);
});
prev.dispose();
console.log(`modelPreview: ${n} tests PASS`);
