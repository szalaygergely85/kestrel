// engine/content/migrate.test.js (US-027a, docs/architecture.md 21.5/21.10 S1)
//
//   node engine/content/migrate.test.js
//
// Plain Node ESM, no framework - matches engine/core/playerLook.test.js.

import { migrateContent } from './migrate.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// A synthetic kind, passed entirely through opts - the engine's own
// MIGRATIONS/LATEST_SCHEMA tables hold no test kinds.
const latest = { widget: 2 };
const migrations = {
  widget: [
    (obj) => ({ ...obj, extra: 'added-in-v2' }),
  ],
};

// v1 -> v2 migration runs and bumps schema.
{
  const v1 = Object.freeze({ kind: 'widget', schema: 1, id: 'w1', name: 'thing' });
  const out = migrateContent('widget', v1, 'w1.json', { migrations, latest });
  ok('migrates v1 to v2', out.schema === 2 && out.extra === 'added-in-v2', JSON.stringify(out));
  ok('input object never mutated', v1.schema === 1 && !('extra' in v1));
  ok('name carried through', out.name === 'thing');
}

// already at latest: returned as-is (same reference).
{
  const v2 = { kind: 'widget', schema: 2, id: 'w2' };
  const out = migrateContent('widget', v2, 'w2.json', { migrations, latest });
  ok('already-latest returns the same object', out === v2);
}

// newer than the engine knows: ContentError.
{
  const v3 = { kind: 'widget', schema: 3, id: 'w3' };
  try {
    migrateContent('widget', v3, 'w3.json', { migrations, latest });
    ok('newer-than-latest throws', false, 'did not throw');
  } catch (e) {
    ok('newer-than-latest throws', e.name === 'ContentError');
    ok('newer-than-latest message names file+field', /w3\.json/.test(e.message) && /schema/.test(e.message));
    ok('newer-than-latest message states versions', /3.*newer.*max.*2/.test(e.message), e.message);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
