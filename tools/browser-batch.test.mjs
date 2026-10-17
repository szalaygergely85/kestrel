// tools/browser-batch.test.mjs - argument parsing and port allocation of the batched browser gate (no browser started).
import assert from 'node:assert/strict';
import { parseArgs, buildChecks, DEFAULT_BASELINE, PRESETS, presetBaselinePath, pickBaseline, classifyGpucompare, evaluateGpucompare } from './browser-batch.mjs';

let n = 0;
const ok = (cond, name) => { assert.ok(cond, name); n++; };

const d = parseArgs([]);
ok(d.portBase === 9540 && d.defaults && d.baseline === DEFAULT_BASELINE && d.extra.length === 0, 'defaults');
const dc = buildChecks(d);
ok(dc.length === 4 && dc[0].cmd.includes('--port 9540') && dc[0].autoBaseline, 'gpucompare first (auto baseline), base port');
ok(dc[1].cmd.includes('route-walk-browser.mjs --port 9542'), 'route walk second, port + 2');
ok(dc[2].cmd === 'node tools/flicker-gate.mjs --port 9544' && dc[3].cmd === 'node tools/verify-far-silhouette.mjs 9546 ob222', 'flicker + far silhouette default checks');
ok(buildChecks(parseArgs(['--quick'])).length === 2, '--quick skips flicker + far silhouette');
const fb = buildChecks(parseArgs(['--baseline', 'x.json']));
ok(fb[0].cmd.endsWith('--baseline x.json') && !fb[0].autoBaseline, '--baseline override kept');

// adapter -> baseline pick
const rtx = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11)';
ok(pickBaseline(rtx).endsWith('webgpu-rtx4060.json'), 'rtx -> rtx4060');
ok(pickBaseline('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)').endsWith('webgpu-arc.json'), 'arc -> arc');
ok(pickBaseline('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)') === DEFAULT_BASELINE, 'intel -> intel');
ok(pickBaseline(undefined) === DEFAULT_BASELINE, 'unknown -> intel default');
// known-row classification
const bl = { backend: 'webgpu', adapter: rtx, rows: { a: 'PASS', b: 'FAIL', c: 'PASS', 'x signal tower': 'PASS' } };
let c = classifyGpucompare(bl, { a: 'PASS', b: 'FAIL', c: 'PASS', 'x signal tower': 'FAIL', n: 'FAIL' }, rtx);
ok(c.ok && c.known.join() === 'b,x signal tower' && c.newFail.join() === 'n' && c.regress.length === 0, 'known baseline FAIL + extra known row = KNOWN, not fatal');
c = classifyGpucompare(bl, { a: 'FAIL', b: 'PASS', c: 'PASS' }, rtx);
ok(!c.ok && c.regress.join() === 'a' && c.fixed.join() === 'b' && c.missing.join() === 'x signal tower', 'regression fails; fixed + missing listed');
c = classifyGpucompare(bl, { 'x signal tower': 'FAIL' }, 'ANGLE (Intel, Intel(R) UHD)');
ok(!c.ok, 'extra-known list is per GPU (not applied to Intel)');
const ev = evaluateGpucompare({ backend: 'webgpu', adapter: rtx, rows: { a: 'PASS', b: 'FAIL', c: 'PASS', 'x signal tower': 'PASS' } }, () => bl);
ok(ev.ok && ev.lines.includes('KNOWN       b'), 'evaluate: only known rows fail = ok');
ok(!evaluateGpucompare({ backend: 'webgpu', adapter: 'other', rows: {} }, () => bl).ok, 'adapter mismatch fails');

const e = buildChecks(parseArgs(['--port-base', '9600', 'node tools/verify-chest-hook.mjs {port} webgpu']));
ok(e.length === 5 && e[4].cmd === 'node tools/verify-chest-hook.mjs 9608 webgpu', 'extra check gets base + 8');
ok(e[4].name === 'tools/verify-chest-hook.mjs', 'extra check name = script path');

const x = buildChecks(parseArgs(['--no-default', 'a {port} {port}']));
ok(x.length === 1 && x[0].cmd === 'a 9540 9540', '--no-default keeps only extras; every {port} replaced');

// GFX-04-pc: four preset runs, one at a time, own baseline file each; default run untouched
const pc = buildChecks(parseArgs(['--presets', '--gpu', 'rtx4060']));
ok(pc.map((c) => c.name).join('|') === 'gpucompare webgpu low|gpucompare webgpu medium|gpucompare webgpu high|gpucompare webgpu ultra', 'preset run names');
ok(pc.map((c) => c.cmd.match(/--baseline (\S+)/)[1]).join(' ') === PRESETS.map((p) => `docs/test-reports/gpucompare-baseline-webgpu-rtx4060-${p}.json`).join(' '), 'preset baseline file names');
ok(pc.every((c, i) => c.cmd.includes(`quality=${PRESETS[i]}"`) && c.cmd.includes(`--port ${9540 + 2 * i}`)), 'preset query + ports');
ok(presetBaselinePath('intel', 'low') === 'docs/test-reports/gpucompare-baseline-webgpu-intel-low.json', 'intel default naming');
ok(buildChecks(parseArgs(['--presets'])).length === 4 && buildChecks(parseArgs([])).length === 4, 'default run unchanged');

assert.throws(() => parseArgs(['--bogus'])); n++;
assert.throws(() => parseArgs(['--port-base', '80'])); n++;

console.log(`browser-batch: ${n} passed, 0 failed.`);
