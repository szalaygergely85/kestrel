// ED-MESH-1d: coalesced rebuilds (split out of the retired frame.test.mjs; the idleSkip tests live in engine/render/frameRenderer.test.js).
import { createRebuildScheduler } from './rebuildScheduler.js';
import { makeOk } from '../../engine/test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
{
  let n = 0, folded = 0;
  const s = createRebuildScheduler(() => { n++; return 1.5; }, (ms, f) => { folded = f; });
  for (let i = 0; i < 5; i++) s.request();
  ok('requests alone do not rebuild', n === 0 && s.pending);
  s.flush();
  ok('5 requests in one frame -> 1 rebuild (5 folded)', n === 1 && folded === 5 && !s.pending);
  s.flush();
  ok('an empty flush does nothing', n === 1);
  s.flushNow();
  ok('flushNow rebuilds immediately', n === 2 && s.runs === 2);
}
console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
console.log('ALL PASS');
