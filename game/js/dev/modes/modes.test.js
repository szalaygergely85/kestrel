// US-048 (docs/backlog.md, PC-B QUEUE 4 item 2) smoke test: every dev-mode
// URL name main.js dispatches to must resolve to a module in the `MODES`
// table with a callable `run`. Node-only (no window/document) - this just
// proves the table shape and that each module imports cleanly, not that a
// mode actually renders anything (that needs a real GPU/browser - see the
// story's Programmer notes for what could not be checked headlessly here).
import assert from 'node:assert/strict';
import { MODES } from './index.js';

import { run as runGpuCompareMode } from './gpucompare.js';

assert.throws(() => runGpuCompareMode({ params: new URLSearchParams('gpucompare=mesh') }), /mode must be 1/, 'removed migration compare cannot start another renderer');

const EXPECTED_NAMES = ['bench', 'shadetest', 'gpucompare', 'flicker', 'glyphs', 'demo'];

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('FAIL:', msg); }
}

check(Array.isArray(MODES), 'MODES must be an array');
check(MODES.length === EXPECTED_NAMES.length, `MODES should have ${EXPECTED_NAMES.length} entries, got ${MODES.length}`);

const seen = new Set();
for (const mode of MODES) {
  check(typeof mode.name === 'string' && mode.name.length > 0, `mode has a non-empty string 'name' (got ${JSON.stringify(mode.name)})`);
  check(typeof mode.run === 'function', `mode '${mode.name}'.run must be a function`);
  seen.add(mode.name);
}
for (const name of EXPECTED_NAMES) {
  check(seen.has(name), `MODES table is missing an entry named '${name}'`);
}

if (failures) {
  console.error(`modes.test.js: ${failures} failure(s)`);
  process.exit(1);
} else {
  console.log(`modes.test.js: OK (${MODES.length} modes: ${[...seen].join(', ')})`);
}
