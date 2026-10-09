// tools/browser-batch.test.mjs - argument parsing and port allocation of the batched browser gate (no browser started).
import assert from 'node:assert/strict';
import { parseArgs, buildChecks, DEFAULT_BASELINE } from './browser-batch.mjs';

let n = 0;
const ok = (cond, name) => { assert.ok(cond, name); n++; };

const d = parseArgs([]);
ok(d.portBase === 9540 && d.defaults && d.baseline === DEFAULT_BASELINE && d.extra.length === 0, 'defaults');
const dc = buildChecks(d);
ok(dc.length === 2 && dc[0].cmd.includes('--port 9540') && dc[0].cmd.includes(`--baseline ${DEFAULT_BASELINE}`), 'gpucompare first, base port');
ok(dc[1].cmd.includes('route-walk-browser.mjs --port 9542'), 'route walk second, port + 2');

const e = buildChecks(parseArgs(['--port-base', '9600', 'node tools/verify-chest-hook.mjs {port} webgpu']));
ok(e.length === 3 && e[2].cmd === 'node tools/verify-chest-hook.mjs 9604 webgpu', 'extra check gets base + 4');
ok(e[2].name === 'tools/verify-chest-hook.mjs', 'extra check name = script path');

const x = buildChecks(parseArgs(['--no-default', 'a {port} {port}']));
ok(x.length === 1 && x[0].cmd === 'a 9540 9540', '--no-default keeps only extras; every {port} replaced');

assert.throws(() => parseArgs(['--bogus'])); n++;
assert.throws(() => parseArgs(['--port-base', '80'])); n++;

console.log(`browser-batch: ${n} passed, 0 failed.`);
