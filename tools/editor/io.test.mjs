// tools/editor/io.test.mjs - US-034 (docs/architecture.md 24.10/24.11).
// Plain Node ESM, no framework. Run with `node tools/editor/io.test.mjs`.
//
// Exercises the pure/Node-safe half of io.js only (`toFileObject`,
// `validateDoc`, `anyDirty`) - `saveFile`/`saveAll`/`loadFile`/
// `launchPlaytest` touch `window`/`localStorage`/the FSA API and are
// browser-only (verified by hand, see the US-034 backlog note).
import { stringifyContent, migrateContent, ContentError } from '../../engine/index.js';
import { toFileObject, validateDoc, anyDirty } from './io.js';
import { fileKey } from './doc.js';

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// A tiny, valid level (a 3x3 room) - just enough for `loadLevel`/
// `World.placeStructure` to accept it (rectangular rows, a fully-specified
// legend entry per used char).
function fixtureLevelDef() {
  return {
    name: 'fixture',
    cellSize: 1,
    legend: {
      '#': { floorH: 0, ceilH: 3, wallMat: 'rock', floorMat: 'rock', ceilMat: 'rock', solid: true },
      '.': { floorH: 0, ceilH: 3, wallMat: 'rock', floorMat: 'rock', ceilMat: 'rock', solid: false, start: true },
    },
    rows: ['###', '#.#', '###'],
    props: [],
    lights: [],
    interactables: [],
    triggers: [],
  };
}

function fixtureWorldDef() {
  return {
    name: 'fixture_world',
    terrain: null,
    structures: [{ id: 'fx', level: 'fixture', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }],
    entities: [],
    horizon: [],
    triggers: [],
    state: {},
  };
}

function fixtureDoc() {
  const files = new Map();
  files.set('level/fixture', { kind: 'level', id: 'fixture', def: fixtureLevelDef(), meta: { schema: 1, nextId: 1 }, dirty: false, handle: null });
  files.set('world/fixture_world', { kind: 'world', id: 'fixture_world', def: fixtureWorldDef(), meta: { schema: 1, nextId: 1 }, dirty: false, handle: null });
  return { worldId: 'fixture_world', files, readOnly: false };
}

const codeParts = { palette: {}, models: {}, worlds: {}, levels: {}, uiStyle: null, detailPass: null };

// ---- toFileObject / stringifyContent: byte-stable round trip (24.10) ------
{
  const doc = fixtureDoc();
  const file = doc.files.get('level/fixture');
  const text1 = stringifyContent(toFileObject(file));
  // Re-parse and re-stringify (simulating a save -> load -> save cycle):
  // bytes must be identical (21.6's canonical-writer guarantee).
  const parsed = JSON.parse(text1);
  const { kind, schema, id, nextId, ...defRest } = parsed;
  const file2 = { kind, id, def: defRest, meta: { schema, nextId } };
  const text2 = stringifyContent(toFileObject(file2));
  ok('stringifyContent(toFileObject(...)) is byte-stable across a parse/re-stringify cycle', text1 === text2);
  ok('the written text starts with the envelope in ENVELOPE_KEYS order', /^\{\n {2}"kind": "level",\n {2}"schema": 1,\n {2}"id": "fixture",\n {2}"nextId": 1,/.test(text1), text1.slice(0, 120));
}

// ---- validateDoc: a valid doc passes -----------------------------------
{
  const doc = fixtureDoc();
  const err = await validateDoc(doc, codeParts);
  ok('validateDoc: a valid level+world doc returns null', err === null, err && err.message);
}

// ---- validateDoc: catches a broken cross-file reference (structures[].level) ----
{
  const doc = fixtureDoc();
  doc.files.get('world/fixture_world').def.structures[0].level = 'no_such_level';
  const err = await validateDoc(doc, codeParts);
  ok('validateDoc: a broken structures[].level reference is caught', err instanceof ContentError, err);
}

// ---- validateDoc: catches a broken same-file reference (interactables[].prop) ----
{
  const doc = fixtureDoc();
  doc.files.get('level/fixture').def.interactables.push({ id: 'lever', x: 1, y: 1, z: 0, radius: 1, prompt: '[E]', interact: 'x', prop: 'no_such_prop' });
  const err = await validateDoc(doc, codeParts);
  ok('validateDoc: a broken interactables[].prop reference is caught', err instanceof ContentError, err && err.message);
}

// ---- validateDoc: duplicate id within one collection is caught ------------
{
  const doc = fixtureDoc();
  const props = doc.files.get('level/fixture').def.props;
  props.push({ id: 'dup', model: 'x', x: 0, y: 0, z: 0, facing: 0 });
  props.push({ id: 'dup', model: 'x', x: 1, y: 0, z: 0, facing: 0 });
  const err = await validateDoc(doc, codeParts);
  ok('validateDoc: a duplicate id in one collection is caught', err instanceof ContentError, err && err.message);
}

// ---- validateDoc's "substitute this file's text" option (Load flow) -------
{
  const doc = fixtureDoc();
  const brokenText = stringifyContent({ ...fixtureLevelDef(), kind: 'level', schema: 1, id: 'fixture', nextId: 1, interactables: [{ id: 'x', x: 0, y: 0, z: 0, radius: 1, prompt: '', interact: '', prop: 'ghost' }] });
  const err = await validateDoc(doc, codeParts, { overrideFileId: 'level/fixture', overrideText: brokenText });
  ok('validateDoc: overrideFileId/overrideText substitutes a candidate file before validating', err instanceof ContentError, err && err.message);
  ok('validateDoc: the override does not mutate the real doc', doc.files.get('level/fixture').def.interactables.length === 0);
}

// ---- schema version: a clear error on an unknown/newer schema (US-027-consistent, AC 4) ----
{
  let threw = null;
  try {
    migrateContent('level', { kind: 'level', schema: 99, id: 'fixture' }, 'fixture.level.json', {});
  } catch (e) {
    threw = e;
  }
  ok('migrateContent: a schema newer than this engine throws a ContentError', threw instanceof ContentError, threw && threw.message);
  ok('migrateContent: the error message names the problem', threw && /newer/.test(threw.message), threw && threw.message);
}

// ---- anyDirty ---------------------------------------------------------------
{
  const doc = fixtureDoc();
  ok('anyDirty: false when nothing is dirty', anyDirty(doc) === false);
  doc.files.get('level/fixture').dirty = true;
  ok('anyDirty: true once a file is dirty', anyDirty(doc) === true);
}

// ---- fileKey sanity (used throughout io.js) --------------------------------
ok("fileKey('level','fixture') -> 'level/fixture'", fileKey('level', 'fixture') === 'level/fixture');

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
