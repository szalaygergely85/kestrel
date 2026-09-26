// engine/world/migrateState.test.js (CO-5, docs/coordinates.md section 8).
// Headless Node ESM, no framework. Run: node engine/world/migrateState.test.js
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateState, parentFromId, LATEST_VERSION, MIGRATIONS } from './migrateState.js';
import { stringifyContent } from '../content/stringify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'worldState.v1.json');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const v1 = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
const v1Snapshot = JSON.parse(JSON.stringify(v1));

// ---------------------------------------------------------------------------
// 1. The committed v1 fixture actually is v1 (sanity - if someone "fixes"
// the fixture forward, this test should fail loudly, not silently pass).
// ---------------------------------------------------------------------------
ok('1a: fixture is version 1', v1.version === 1);
ok('1b: fixture has no entities[].parent yet (that is what migration adds)', v1.entities.every((e) => !('parent' in e)));

// ---------------------------------------------------------------------------
// 2. Migrating v1 -> v2.
// ---------------------------------------------------------------------------
const v2 = migrateState(v1);
ok('2a: migrated state is version 2', v2.version === 2);
ok('2b: LATEST_VERSION is 2', LATEST_VERSION === 2);
ok('2c: exactly one migration step is registered (v1 -> v2)', MIGRATIONS.length === 1);

const brazier = v2.entities.find((e) => e.id === 'tower.brazier');
const lantern = v2.entities.find((e) => e.id === 'annex.lantern');
const player = v2.entities.find((e) => e.id === 'player');
const debris = v2.entities.find((e) => e.id === 'debris_1');
ok('2d: a "tower."-prefixed entity gets parent = "tower"', brazier && brazier.parent === 'tower');
ok('2e: an "annex."-prefixed entity gets parent = "annex"', lantern && lantern.parent === 'annex');
ok('2f: an entity with no matching structure prefix gets parent = null', player && player.parent === null);
ok('2g: an unprefixed entity id gets parent = null', debris && debris.parent === null);

// Nothing else about the state changed by the migration.
ok('2h: non-entity fields are untouched', JSON.stringify(v2.terrain) === JSON.stringify(v1.terrain)
  && JSON.stringify(v2.structures) === JSON.stringify(v1.structures)
  && JSON.stringify(v2.state) === JSON.stringify(v1.state));

// Pure: the input fixture object itself was never mutated.
ok('2i: migrateState does not mutate its input', JSON.stringify(v1) === JSON.stringify(v1Snapshot));

// ---------------------------------------------------------------------------
// 3. parentFromId helper directly.
// ---------------------------------------------------------------------------
const structs = [{ id: 'tower' }, { id: 'annex' }];
ok('3a: parentFromId matches a real prefix', parentFromId('tower.brazier', structs) === 'tower');
ok('3b: parentFromId returns null for an unmatched prefix', parentFromId('cave.torch', structs) === null);
ok('3c: parentFromId returns null with no dot', parentFromId('debris_1', structs) === null);
ok('3d: parentFromId returns null for a leading dot', parentFromId('.weird', structs) === null);

// ---------------------------------------------------------------------------
// 4. Already-v2 state passes through unchanged (no gratuitous clone/edit).
// ---------------------------------------------------------------------------
const alreadyV2 = migrateState(v2);
ok('4a: an already-v2 state is returned as-is', alreadyV2 === v2);

// ---------------------------------------------------------------------------
// 5. A future/unknown version throws a clear, specific error - never a
// silent best-effort migration.
// ---------------------------------------------------------------------------
{
  let threw = null;
  try { migrateState({ ...v2, version: 3 }); } catch (err) { threw = err; }
  ok('5a: version 3 throws', threw instanceof Error);
  ok('5b: the message names the offending version and the max supported', /3/.test(threw.message) && /2/.test(threw.message));
}
{
  let threw = null;
  try { migrateState({ ...v2, version: 0 }); } catch (err) { threw = err; }
  ok('5c: version 0 throws (not treated as "older, migrate")', threw instanceof Error);
}
{
  let threw = null;
  try { migrateState({ ...v2, version: 'two' }); } catch (err) { threw = err; }
  ok('5d: a non-numeric version throws', threw instanceof Error);
}

// ---------------------------------------------------------------------------
// 6. The migrated v2 state stringifies through the canonical `save` key
// order without throwing (schema.js's KEY_ORDER.save covers it).
// ---------------------------------------------------------------------------
let stringifyThrew = null;
let text = '';
try { text = stringifyContent({ kind: 'save', ...v2 }); } catch (err) { stringifyThrew = err; }
ok('6a: the migrated v2 state stringifies cleanly', stringifyThrew === null, stringifyThrew && stringifyThrew.message);
ok('6b: canonical text starts with the object envelope', text.startsWith('{\n') && text.endsWith('}\n'));

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
