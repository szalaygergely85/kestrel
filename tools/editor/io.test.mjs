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
import { createVisibilityState, setHiddenFlag, setLockedFlag } from './visibility.js';
import { makeRecord, applyEdit } from './commands.js';
import { makeOk } from '../../engine/test/assert.js';

let pass = 0;
let fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

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

// ---- ED-SCALE-1c (34.3/34.4): a 1 -> 1.5 -> 1 scale cycle saves
// byte-identical (the `scale` key is written only when != 1, 34.1's own
// "untouched content stays byte-identical" rule) -----------------------
{
  const doc = fixtureDoc();
  const file = doc.files.get('level/fixture');
  file.def.props.push({ id: 'brazier', model: 'brazier', x: 1, y: 1, z: 0, facing: 0 });
  const text0 = stringifyContent(toFileObject(file));

  const item = file.def.props[0];
  const rec1 = makeRecord('scale', 'level/fixture', 'props', item.id, 0, item, { ...item, scale: 1.5 });
  applyEdit(doc, rec1);
  ok('scale 1.5 written to the live def', file.def.props[0].scale === 1.5);

  const item2 = file.def.props[0];
  const after2 = { ...item2 };
  delete after2.scale;
  const rec2 = makeRecord('scale', 'level/fixture', 'props', item2.id, 0, item2, after2);
  applyEdit(doc, rec2);
  ok('scale key deleted going back to 1', !('scale' in file.def.props[0]));

  const text1 = stringifyContent(toFileObject(file));
  ok('1 -> 1.5 -> 1 cycle saves byte-identical', text0 === text1, `${text0}\n---\n${text1}`);
}

// ---- validateDoc: a valid doc passes -----------------------------------
{
  const doc = fixtureDoc();
  const err = await validateDoc(doc, codeParts);
  ok('validateDoc: a valid level+world doc returns null', err === null, err && err.message);
}


// ---- validateDoc: world structures[].mesh resolve via reference content (BUG: editor Save disabled on world_m1) ----
{
  const { readFileSync } = await import('node:fs');
  const { loadContentPack } = await import('../../engine/index.js');
  const meshText = readFileSync(new URL('../../content/meshes/quaternius/DeadTree_1.mesh.json', import.meta.url), 'utf8');
  const mem = new Map([['m.json', JSON.stringify({ kind: 'manifest', schema: 1, id: 'm', contentVersion: 0, files: ['DeadTree_1.mesh.json'] })], ['DeadTree_1.mesh.json', meshText]]);
  const reference = await loadContentPack('http://x.invalid/m.json', { fetchText: (u) => { const k = new URL(u).pathname.slice(1); return mem.has(k) ? Promise.resolve(mem.get(k)) : Promise.reject(new Error('HTTP 404')); } });
  const meshId = Object.keys(reference.meshes)[0];
  const doc = fixtureDoc();
  doc.files.get('world/fixture_world').def.structures.push({ id: 'tree', mesh: meshId, origin: { x: 1, y: 1, z: 0 }, yawDeg: 0 });
  const err = await validateDoc(doc, codeParts, { reference });
  ok('validateDoc: world mesh structure validates with reference meshes', err === null, err && err.message);
  const noRef = await validateDoc(doc, codeParts);
  ok('validateDoc: mesh structure without reference errors (unknown mesh)', noRef instanceof ContentError && /unknown mesh/.test(noRef.message), noRef && noRef.message);
  doc.files.get('world/fixture_world').def.structures[1].mesh = 'quaternius/Nope';
  const bad = await validateDoc(doc, codeParts, { reference });
  ok('validateDoc: an unknown mesh id still errors', bad instanceof ContentError, bad && bad.message);
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

// ---- US-067: hide/lock state NEVER leaks into a save ------------------------
// The overlay (visibility.js's `createVisibilityState`) lives entirely
// outside `doc` - toggling it must not change a single byte of what
// `toFileObject`/`stringifyContent` would write for any file, proving the
// state really never reaches the JSON (not just "the UI doesn't show it").
{
  const docA = fixtureDoc();
  const props = docA.files.get('level/fixture').def.props;
  props.push({ id: 'lantern_1', model: 'lantern', x: 1, y: 1, z: 0, facing: 0 });
  const textsBefore = [...docA.files.values()].map((f) => stringifyContent(toFileObject(f)));

  const docB = fixtureDoc();
  docB.files.get('level/fixture').def.props.push({ id: 'lantern_1', model: 'lantern', x: 1, y: 1, z: 0, facing: 0 });
  const visState = createVisibilityState();
  const propItem = { fileId: 'level/fixture', collection: 'props', id: 'lantern_1' };
  setHiddenFlag(visState, propItem, true);
  setLockedFlag(visState, propItem, true);
  const textsAfter = [...docB.files.values()].map((f) => stringifyContent(toFileObject(f)));

  ok('save output is byte-identical whether or not hide/lock is toggled', JSON.stringify(textsBefore) === JSON.stringify(textsAfter));
  ok('hidden/locked state does not add any field to the saved prop', !textsAfter.some((t) => t.includes('hidden') || t.includes('locked')), textsAfter.join('\n'));
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
