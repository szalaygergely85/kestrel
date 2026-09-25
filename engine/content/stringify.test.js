// engine/content/stringify.test.js (US-027a, docs/architecture.md 21.6/21.10 S2)
//
//   node engine/content/stringify.test.js
//
// Plain Node ESM, no framework - matches engine/core/playerLook.test.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyContent } from './stringify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden.level.json');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// A small but representative level: an ordered map (legend), a top-level
// string array (rows, the grid), a nested string array (layers[].rows,
// voxel layer rows), and id-collections (props/lights/interactables) that
// must NOT be sorted by id (21.6 deviation - array order is preserved).
function makeLevel() {
  return {
    kind: 'level',
    schema: 1,
    id: 'tiny',
    nextId: 3,
    name: 'tiny',
    title: 'Tiny Room',
    version: 1,
    cellSize: 1,
    size: { w: 3, h: 3 },
    rows: ['###', '#.#', '###'],
    legend: {
      '#': { kind: 'wall', material: 'stone' },
      '.': { kind: 'floor', material: 'wood' },
    },
    layers: [
      { id: 'floor', z: 0, rows: ['AAA', 'ABA', 'AAA'] },
    ],
    start: { x: 1.5, y: 1.5, facingDeg: 0 },
    lights: [
      { id: 'brazier', x: 1.5, y: 1.5, z: 1, color: '#ffaa33', intensity: 2 },
    ],
    props: [
      { id: 'brazier', model: 'torch', x: 1.5, y: 1.5, z: 0 },
      { id: 'lever', model: 'lever', x: 0.5, y: 0.5, z: 0 },
    ],
    interactables: [
      { id: 'lever', interact: 'use', x: 0.5, y: 0.5, z: 0, radius: 1, prop: 'lever' },
    ],
    triggers: [],
    markers: {},
    route: [],
    routeNotes: { a: 'start here', b: 'exit' },
  };
}

// --- shuffled keys give the same bytes -------------------------------------
{
  const a = makeLevel();
  const shuffled = {};
  // insert keys in reverse alphabetical order, deliberately not source order
  for (const k of Object.keys(a).sort().reverse()) shuffled[k] = a[k];
  ok('shuffled top-level key order gives the same bytes', stringifyContent(a) === stringifyContent(shuffled));
}

// --- round-trip stability ---------------------------------------------------
{
  const a = makeLevel();
  const s1 = stringifyContent(a);
  const parsed = JSON.parse(s1);
  const s2 = stringifyContent(parsed);
  ok('stringify(parse(stringify(x))) === stringify(x)', s1 === s2);
}

// --- golden fixture, byte for byte ------------------------------------------
{
  const out = stringifyContent(makeLevel());
  if (process.env.WRITE_GOLDEN) {
    fs.writeFileSync(GOLDEN_PATH, out);
  }
  const golden = fs.readFileSync(GOLDEN_PATH, 'utf8');
  ok('matches golden.level.json byte for byte', out === golden);
  ok('ends with a single trailing newline', out.endsWith('\n') && !out.endsWith('\n\n'));
  ok('uses LF only (no CRLF)', !out.includes('\r'));
}

// --- placement order is preserved, not sorted by id -------------------------
{
  const out = stringifyContent(makeLevel());
  const braziers = out.indexOf('"brazier"');
  const lever = out.indexOf('"lever"');
  ok('props keep array order (brazier before lever)', braziers !== -1 && lever !== -1 && braziers < lever);
}

// --- invalid values throw ---------------------------------------------------
{
  const bad = { ...makeLevel(), badFn: () => {} };
  try {
    stringifyContent(bad);
    ok('a function value throws', false, 'did not throw');
  } catch (e) {
    ok('a function value throws', e.name === 'ContentError');
  }
}
{
  const bad = { ...makeLevel(), cellSize: NaN };
  try {
    stringifyContent(bad);
    ok('NaN throws', false, 'did not throw');
  } catch (e) {
    ok('NaN throws', e.name === 'ContentError');
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
