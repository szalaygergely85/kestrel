// tools/editor/commands.test.mjs - US-032 S4 (docs/architecture.md 24.13).
// Plain Node ESM, no framework. Run with `node tools/editor/commands.test.mjs`.
import {
  makeRecord, invert, applyEdit, findReferrers, findReferrersDetailed, makeFieldEditRecord, makeDeleteRecord,
  makeInsertRecord, makeRenameBatch,
} from './commands.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// A fixture level def + a one-file doc (24.13 S4: "over a fixture level def").
function fixtureDoc() {
  const def = {
    props: [
      { id: 'brazier', model: 'brazier', x: 1, y: 1, z: 0, facing: 0 },
      { id: 'lantern', model: 'lantern', x: 2, y: 2, z: 1, facing: 90 },
      { id: 'rubble', model: 'rubble', x: 3, y: 3, z: 0, facing: 0 },
    ],
    lights: [{ id: 'brazier', preset: 'torch', x: 1, y: 1, z: 1.2, on: true }],
    interactables: [{ id: 'lever', x: 4, y: 4, z: 0, radius: 1.5, prompt: '[E] Use', interact: 'pullLever', prop: 'brazier' }],
    triggers: [],
  };
  const files = new Map();
  files.set('level/fixture', { kind: 'level', id: 'fixture', def, meta: { nextId: 4 }, dirty: false, handle: null });
  return { worldId: 'fixture', files };
}

function snapshot(doc) {
  return JSON.stringify(doc.files.get('level/fixture').def);
}

// ---- nudge/yaw/drop over a fixture, undo returns deep-equal def -----------
{
  const doc = fixtureDoc();
  const before = snapshot(doc);
  const item = doc.files.get('level/fixture').def.props[1]; // lantern
  const rec = makeFieldEditRecord('nudge', 'level/fixture', 'props', item, 1, { x: 2.25, y: 2 });
  applyEdit(doc, rec);
  ok('nudge: applies the patched x', doc.files.get('level/fixture').def.props[1].x === 2.25);
  ok('nudge: file marked dirty', doc.files.get('level/fixture').dirty === true);
  applyEdit(doc, invert(rec));
  ok('nudge: undo (invert) returns a deep-equal def', snapshot(doc) === before);
}

// ---- yaw ------------------------------------------------------------------
{
  const doc = fixtureDoc();
  const item = doc.files.get('level/fixture').def.props[1];
  const rec = makeFieldEditRecord('yaw', 'level/fixture', 'props', item, 1, { facing: (item.facing + 45) % 360 });
  applyEdit(doc, rec);
  ok('yaw: facing updated', doc.files.get('level/fixture').def.props[1].facing === 135);
  applyEdit(doc, invert(rec));
  ok('yaw: undo restores facing', doc.files.get('level/fixture').def.props[1].facing === 90);
}

// ---- drop to floor ----------------------------------------------------------
{
  const doc = fixtureDoc();
  const item = doc.files.get('level/fixture').def.props[0];
  const rec = makeFieldEditRecord('drop', 'level/fixture', 'props', item, 0, { z: 0.5 });
  applyEdit(doc, rec);
  ok('drop: z updated', doc.files.get('level/fixture').def.props[0].z === 0.5);
}

// ---- insert (place) ---------------------------------------------------------
{
  const doc = fixtureDoc();
  const before = snapshot(doc);
  const newProp = { id: 'prop_4', model: 'lantern', x: 5, y: 5, z: 0, facing: 0 };
  const rec = makeInsertRecord('level/fixture', 'props', newProp);
  applyEdit(doc, rec);
  ok('insert: appended', doc.files.get('level/fixture').def.props.length === 4);
  ok('insert: new item present', doc.files.get('level/fixture').def.props[3].id === 'prop_4');
  applyEdit(doc, invert(rec));
  ok('insert: undo (delete) returns a deep-equal def', snapshot(doc) === before);
}

// ---- delete reinserts at the same index on undo ----------------------------
{
  const doc = fixtureDoc();
  const before = snapshot(doc);
  const item = doc.files.get('level/fixture').def.props[1]; // lantern, index 1
  const rec = makeDeleteRecord('level/fixture', 'props', item, 1);
  applyEdit(doc, rec);
  ok('delete: item removed', doc.files.get('level/fixture').def.props.length === 2);
  ok('delete: remaining order preserved', doc.files.get('level/fixture').def.props[0].id === 'brazier' && doc.files.get('level/fixture').def.props[1].id === 'rubble');
  applyEdit(doc, invert(rec));
  ok('delete: undo reinserts at the same index', doc.files.get('level/fixture').def.props[1].id === 'lantern');
  ok('delete: undo returns a deep-equal def', snapshot(doc) === before);
}

// ---- delete-with-referrers is refused (checked before building the record) --
{
  const doc = fixtureDoc();
  const def = doc.files.get('level/fixture').def;
  const referrers = findReferrers(def, 'level', 'props', 'brazier');
  ok('findReferrers: the lever interactable references the brazier prop', referrers.includes('interactables.lever'), JSON.stringify(referrers));
  const noReferrers = findReferrers(def, 'level', 'props', 'rubble');
  ok('findReferrers: an unreferenced prop has none', noReferrers.length === 0);
}

// ---- US-033: id rename rewrites referrers in the same batch record --------
{
  const doc = fixtureDoc();
  const before = snapshot(doc);
  const def = doc.files.get('level/fixture').def;
  const detailed = findReferrersDetailed(def, 'level', 'props', 'brazier');
  ok('findReferrersDetailed: names the referring field', detailed.length === 1 && detailed[0].field === 'prop' && detailed[0].id === 'lever', JSON.stringify(detailed));

  const item = def.props[0]; // brazier, index 0
  const rec = makeRenameBatch('level/fixture', 'level', 'props', item, 0, 'brazier2', def);
  ok('makeRenameBatch: carries renameFrom/renameTo for selection tracking', rec.renameFrom === 'brazier' && rec.renameTo === 'brazier2');
  ok('makeRenameBatch: one sub-record for the item + one per referrer', rec.batch.length === 2);

  applyEdit(doc, rec);
  ok('rename: the prop itself got the new id', def.props[0].id === 'brazier2');
  ok('rename: the lever interactable\'s `prop` field was rewritten', def.interactables[0].prop === 'brazier2');
  // The light collection ALSO has an item literally id "brazier" (a
  // different collection, not a referrer of the prop - REF_FIELDS only
  // wires interactables[].prop/light/flameProp -> props/lights, never
  // lights[].id itself) - it must be untouched by a PROP rename.
  ok('rename: an unrelated same-named item in another collection is untouched', def.lights[0].id === 'brazier');

  const inv = invert(rec);
  ok('invert: swaps renameFrom/renameTo', inv.renameFrom === 'brazier2' && inv.renameTo === 'brazier');
  applyEdit(doc, inv);
  ok('rename: undo (invert) returns a deep-equal def', snapshot(doc) === before, snapshot(doc));
}

// ---- makeRecord structuredClone's before/after once ------------------------
{
  const item = { id: 'x', x: 1 };
  const rec = makeRecord('test', 'level/fixture', 'props', 'x', 0, item, { ...item, x: 2 });
  item.x = 999; // mutating the source object afterward must not affect the record
  ok('makeRecord clones before (not a live reference)', rec.before.x === 1);
}

console.log(`commands.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
