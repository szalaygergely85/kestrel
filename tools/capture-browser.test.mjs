// tools/capture-browser.test.mjs (US-059, docs/backlog.md row 30c)
//
// Covers only the parts of tools/capture-browser.mjs that don't need a
// real browser: --port range validation, query-string building, the
// live-result normalizer, the --import text parser (against literal
// fixture text matching game/js/main.js's own overlay templates), --diff,
// and the capture file path/date helpers. The CDP-driving code
// (connectCdp/runLiveCapture) is exercised manually - see the story
// report - not here.
//
// node tools/capture-browser.test.mjs

import {
  parseArgs, validatePort, buildQuery, resultGlobalFor,
  normalizeLiveResult, parseImportText, detectImportMode,
  diffResults, formatDiff, formatSummary, todayStr, captureFilePath,
  buildLaunchFlags, isSoftwareRendererLine,
} from './capture-browser.mjs';

let failures = 0;
function check(name, cond) {
  if (!cond) { console.error('FAIL:', name); failures++; }
}
function throws(name, fn) {
  try { fn(); console.error('FAIL:', name, '(did not throw)'); failures++; }
  catch { /* expected */ }
}

// --- parseArgs ---
{
  const o = parseArgs(['--mode', 'gpucompare', '--grid', '240x90', '--port', '9500']);
  check('parseArgs mode', o.mode === 'gpucompare');
  check('parseArgs grid', o.grid === '240x90');
  check('parseArgs port', o.port === 9500);
}
{
  const o = parseArgs(['--import', 'file.txt']);
  check('parseArgs import path', o.import === 'file.txt');
}
{
  const o = parseArgs(['--import']);
  check('parseArgs import stdin (bare flag)', o.import === true);
}
{
  const o = parseArgs(['--diff', 'old.json']);
  check('parseArgs diff', o.diff === 'old.json');
}
throws('parseArgs rejects unknown flag', () => parseArgs(['--bogus']));

// --- validatePort: US-059 fix pass (row 30c) - both PC-A (9000-9499) and
// PC-B (9500-9999) ranges accepted, 8000 (owner) always rejected. ---
{
  validatePort(9000); // PC-A range start - should not throw
  validatePort(9499); // PC-A range end
  validatePort(9500); // PC-B range start
  validatePort(9999); // PC-B range end
  check('validatePort accepts the full 9000-9999 range (both PCs)', true);
}
throws('validatePort rejects 8000 (owner port)', () => validatePort(8000));
throws('validatePort rejects 8999 (just below the range)', () => validatePort(8999));
throws('validatePort rejects 10000 (just above the range)', () => validatePort(10000));
throws('validatePort rejects non-integer', () => validatePort(9500.5));

// --- buildLaunchFlags: US-059 fix pass (row 30c) - real GPU by default,
// SwiftShader only behind the opt-in --swiftshader flag. ---
{
  const winDefault = buildLaunchFlags({ swiftshader: false }, 'win32');
  check('win32 default uses d3d11', winDefault.includes('--use-angle=d3d11'));
  check('win32 default has no swiftshader flags', !winDefault.some((f) => /swiftshader/i.test(f)));
}
{
  const otherDefault = buildLaunchFlags({ swiftshader: false }, 'linux');
  check('non-win32 default has no backend flags (Chrome default)', otherDefault.length === 0);
}
{
  const winSw = buildLaunchFlags({ swiftshader: true }, 'win32');
  check('win32 --swiftshader uses swiftshader flags', winSw.includes('--use-angle=swiftshader') && winSw.includes('--enable-unsafe-swiftshader'));
  check('win32 --swiftshader does not also request d3d11', !winSw.includes('--use-angle=d3d11'));
}
{
  const linuxSw = buildLaunchFlags({ swiftshader: true }, 'linux');
  check('non-win32 --swiftshader still uses swiftshader flags', linuxSw.includes('--use-angle=swiftshader'));
}
check('parseArgs --swiftshader flag', parseArgs(['--swiftshader']).swiftshader === true);
check('parseArgs swiftshader defaults false', parseArgs([]).swiftshader === false);

// --- isSoftwareRendererLine: the fail-fast console-message match ---
check('isSoftwareRendererLine matches the real webgl2Gate.js text', isSoftwareRendererLine('[webgl2Gate] software renderer detected (SwiftShader) - performance may be poor'));
check('isSoftwareRendererLine ignores unrelated console text', !isSoftwareRendererLine('[grid] GpuCellPipeline unavailable on a gl2 backend'));

// --- buildQuery / resultGlobalFor ---
check('buildQuery gpucompare default', buildQuery('gpucompare', {}) === 'gpucompare=1');
check('buildQuery gpucompare shade variant', buildQuery('gpucompare', { variant: 'shade' }) === 'gpucompare=shade');
check('buildQuery bench', buildQuery('bench', {}) === 'bench=present');
check('buildQuery voxelbench default grid/rays', buildQuery('voxelbench', {}) === 'voxelbench=1&grid=240x90&rays=2');
check('buildQuery voxelbench custom grid/rays', buildQuery('voxelbench', { grid: '160x60', rays: 1 }) === 'voxelbench=1&grid=160x60&rays=1');
check('buildQuery gpucompare with grid', buildQuery('gpucompare', { grid: '160x60' }) === 'gpucompare=1&grid=160x60');
throws('buildQuery rejects unknown mode', () => buildQuery('bogus', {}));

check('resultGlobalFor gpucompare', resultGlobalFor('gpucompare') === '__gpuCompare');
check('resultGlobalFor bench', resultGlobalFor('bench') === '__bench');
check('resultGlobalFor voxelbench', resultGlobalFor('voxelbench') === '__voxelBench');
throws('resultGlobalFor rejects unknown mode', () => resultGlobalFor('bogus'));

// --- normalizeLiveResult: mirrors the real window.__gpuCompare/__bench/__voxelBench shapes ---
{
  // shade-variant window.__gpuCompare shape (game/js/main.js line 1005)
  const raw = { rows: [
    { pose: 'p1', ok: true, glyphMatchPct: 99.9, edgeCells: 3, fgOutside: 0, bgOutside: 0, fgMax: 1, bgMax: 1, depthMatchPct: 100, matZeroCount: 0 },
    { pose: 'p2', ok: false, glyphMatchPct: 80.1, edgeCells: 5, fgOutside: 9, bgOutside: 2, fgMax: 60, bgMax: 40, depthMatchPct: 90, matZeroCount: 4 },
  ], ok: false };
  const n = normalizeLiveResult('gpucompare', raw);
  check('normalize gpucompare rows length', n.rows.length === 2);
  check('normalize gpucompare row1 pass', n.rows[0].pass === true);
  check('normalize gpucompare row2 fail', n.rows[1].pass === false);
  check('normalize gpucompare overall ok', n.ok === false);
  check('normalize gpucompare metric flattened', n.rows[0].metrics.glyphMatchPct === 99.9);
}
{
  // dda-variant window.__gpuCompare shape (game/js/main.js line 1543)
  const raw = { rows: [
    { pose: 'p1', ok: true, cmpGeom: { kindMatchPct: 100, holes: 0, k8Cpu: 2, k8Gpu: 2 }, cmpCells: { glyphMatchPct: 99, fgMax: 1 }, cmpLight: { pass: true, dLViol: 0 } },
  ], ok: true, infoRows: [] };
  const n = normalizeLiveResult('gpucompare', raw, { variant: 'dda' });
  check('normalize dda nested flatten', n.rows[0].metrics['cmpGeom.kindMatchPct'] === 100);
  check('normalize dda nested light', n.rows[0].metrics['cmpLight.pass'] === true);
}
{
  // window.__bench shape (game/js/main.js line 1712-1722)
  const raw = {
    frames: 600, backend: 'webgl2', canvasPxW: 800, canvasPxH: 600, devicePixelRatio: 1, pxCellW: 8, pxCellH: 14,
    present: { avgMs: 1.2, p95Ms: 2.0, maxMs: 3.0 }, fullFrame: { avgMs: 6.0, p95Ms: 7.5, maxMs: 9.0 },
  };
  const n = normalizeLiveResult('bench', raw);
  check('normalize bench single row', n.rows.length === 1 && n.rows[0].name === 'present');
  check('normalize bench pass under budget', n.rows[0].pass === true); // avgMs 6.0 <= 8
  check('normalize bench metrics flattened', n.rows[0].metrics['fullFrame.avgMs'] === 6.0);

  const rawOver = { ...raw, fullFrame: { avgMs: 9.5, p95Ms: 10, maxMs: 11 } };
  const n2 = normalizeLiveResult('bench', rawOver);
  check('normalize bench fail over budget', n2.rows[0].pass === false);
}
{
  // window.__voxelBench shape (game/js/main.js line 1806-1810)
  const raw = { frames: 300, grid: '240x90', rays: 2, instances: 11, voxelMsP50: 0.2, voxelMsP95: 0.4, gpuMsP50: 1.5, gpuMsP95: 3.5 };
  const n = normalizeLiveResult('voxelbench', raw);
  check('normalize voxelbench pass within gate', n.rows[0].pass === true);
  const rawOver = { ...raw, voxelMsP95: 0.9 };
  const n2 = normalizeLiveResult('voxelbench', rawOver);
  check('normalize voxelbench fail over gate', n2.rows[0].pass === false);
}

// --- parseImportText: literal fixtures matching main.js's exact templates ---
{
  // ?gpucompare=shade overlay text (game/js/main.js lines 987-997)
  const text =
    `?gpucompare=shade  GpuCellPipeline: WebGL2 (NVIDIA)\n` +
    `ref: 800x600 @dpr 1  cell: 8x14px  aspect=1.3333  fov=66 deg (fixed, window-independent)\n` +
    `PASS  pose1\n` +
    `  glyph match (non-edge): 99.87%  edge cells excluded: 12\n` +
    `  fg outside +-4: 0  bg outside +-4: 0  fgMax 2 bgMax 2\n` +
    `  depth match: 100%  mat==0 cells: 0\n` +
    `FAIL  pose2\n` +
    `  glyph match (non-edge): 82.10%  edge cells excluded: 20\n` +
    `  fg outside +-4: 5  bg outside +-4: 3  fgMax 55 bgMax 40\n` +
    `  depth match: 91%  mat==0 cells: 4\n` +
    `\nFAILURES ABOVE`;
  check('detectImportMode shade', JSON.stringify(detectImportMode(text)) === JSON.stringify({ mode: 'gpucompare', variant: 'shade' }));
  const p = parseImportText(text);
  check('import shade rows count', p.rows.length === 2);
  check('import shade row1 pass', p.rows[0].pass === true && p.rows[0].name === 'pose1');
  check('import shade row1 metrics', p.rows[0].metrics.glyphMatchPct === 99.87 && p.rows[0].metrics.edgeCells === 12);
  check('import shade row2 fail', p.rows[1].pass === false);
  check('import shade overall not ok', p.ok === false);
  check('import shade headless false', p.headless === false);
}
{
  // ?gpucompare=1 (dda) overlay text (game/js/main.js lines 1507-1527)
  const text =
    `?gpucompare=1  GpuCellPipeline: WebGL2 (NVIDIA)  grid: 160x60  rays: 1  readback: present() units 0/1\n` +
    `ref: 800x600 @dpr 1  cell: 8x14px  aspect=1.3333  fov=66 deg (fixed, window-independent)\n` +
    `PASS  pose1\n` +
    `  geometry: kind 99.80%  matEq 100/100  planeEq 100/100  depthViol 0  uvViol 0  holes 0 (must be 0)  edgeKindMismatch 0/10\n` +
    `  k8 cpu 4  gpu 4 (both > 0, OK)\n` +
    `  shading: glyph 99.50%  fgOut 0  bgOut 0  outside 0.100% (<=0.5%, 1 cells)  fgMax 2  bgMax 2 (<=64)  poisonedSurvivors 0\n` +
    `  light: OK  sunlit 0.000% (<=0.5%, 0/500)  dLMax 0.0004  dLViol 0 (<=1e-3/chan)\n` +
    `\nALL PASS`;
  check('detectImportMode dda', JSON.stringify(detectImportMode(text)) === JSON.stringify({ mode: 'gpucompare', variant: 'dda' }));
  const p = parseImportText(text);
  check('import dda rows count', p.rows.length === 1);
  check('import dda geom metric', p.rows[0].metrics['cmpGeom.kindMatchPct'] === 99.8);
  check('import dda k8 metric', p.rows[0].metrics['cmpGeom.k8Cpu'] === 4 && p.rows[0].metrics['cmpGeom.k8Gpu'] === 4);
  check('import dda shading metric', p.rows[0].metrics['cmpCells.glyphMatchPct'] === 99.5);
  check('import dda light metric', p.rows[0].metrics['cmpLight.pass'] === true);
  check('import dda overall ok', p.ok === true);
}
{
  // BENCH overlay text (game/js/main.js lines 1730-1735)
  const text =
    `BENCH (600 worst-case frames)  backend: webgl2\n` +
    `canvas: 800x600 px  (dpr 1, cell 8x14px)\n` +
    `present(): avg 1.20 ms  p95 2.00 ms  max 3.00 ms\n` +
    `full frame: avg 6.00 ms  p95 7.50 ms  max 9.00 ms\n` +
    `budget: <= 8 ms/frame for 60 fps`;
  check('detectImportMode bench', detectImportMode(text).mode === 'bench');
  const p = parseImportText(text);
  check('import bench single row', p.rows.length === 1 && p.rows[0].name === 'present');
  check('import bench metrics', p.rows[0].metrics['fullFrame.avgMs'] === 6);
  check('import bench pass under budget', p.rows[0].pass === true);
  check('import bench headless false', p.headless === false);
}
{
  // VOXELBENCH overlay text (game/js/main.js lines 1817-1820)
  const text =
    `VOXELBENCH (300 frames, 240x90, rays 2, 11 instances)\n` +
    `voxel pass: p50 0.20 ms  p95 0.40 ms  (D-019 gate: <= 0.5 ms p95)\n` +
    `gpu total:  p50 1.50 ms  p95 3.50 ms  (gate: <= 4 ms p95)`;
  check('detectImportMode voxelbench', detectImportMode(text).mode === 'voxelbench');
  const p = parseImportText(text);
  check('import voxelbench metrics', p.rows[0].metrics.instances === 11 && p.rows[0].metrics.voxelMsP95 === 0.4);
  check('import voxelbench pass within gate', p.rows[0].pass === true);
}
throws('parseImportText: unrecognized text with no --mode hint throws', () => parseImportText('nonsense text here', null));

// --- diffResults / formatDiff ---
{
  const prev = { rows: [
    { name: 'p1', pass: true, metrics: { glyphMatchPct: 99 } },
    { name: 'p2', pass: true, metrics: { glyphMatchPct: 98 } },
  ], ok: true };
  const cur = { rows: [
    { name: 'p1', pass: false, metrics: { glyphMatchPct: 50 } }, // PASS -> FAIL
    { name: 'p2', pass: true, metrics: { glyphMatchPct: 98 } },  // unchanged
    { name: 'p3', pass: true, metrics: { glyphMatchPct: 100 } }, // new
  ], ok: false };
  const changes = diffResults(cur, prev);
  check('diff detects PASS->FAIL first', changes[0].name === 'p1' && changes[0].passChange.from === true && changes[0].passChange.to === false);
  check('diff omits unchanged row', !changes.some((c) => c.name === 'p2'));
  check('diff includes new row', changes.some((c) => c.name === 'p3' && c.kind === 'new'));
  const text = formatDiff(changes);
  check('formatDiff mentions p1 before p3', text.indexOf('p1') < text.indexOf('p3'));
}
{
  const changes = diffResults({ rows: [{ name: 'a', pass: true, metrics: {} }] }, { rows: [{ name: 'a', pass: true, metrics: {} }] });
  check('diff no changes', changes.length === 0);
  check('formatDiff no changes message', formatDiff(changes).includes('no changes'));
}

// --- formatSummary / todayStr / captureFilePath ---
{
  const s = formatSummary('bench', { rows: [{ name: 'present', pass: true, metrics: { a: 1 } }], ok: true, headless: true });
  check('formatSummary includes mode', s.includes('mode=bench'));
  check('formatSummary includes PASS', s.includes('PASS') && s.includes('present'));
}
check('todayStr format', /^\d{4}-\d{2}-\d{2}$/.test(todayStr(new Date('2026-09-25T00:00:00Z'))));
{
  const p = captureFilePath({ date: '2026-09-25', sha: 'abc1234', mode: 'bench', grid: '240x90' });
  check('captureFilePath name shape', p.endsWith('2026-09-25-abc1234-bench-240x90.json'));
  check('captureFilePath in captures dir', p.replace(/\\/g, '/').includes('docs/test-reports/captures/'));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('capture-browser.test.mjs: all checks passed.');
}
