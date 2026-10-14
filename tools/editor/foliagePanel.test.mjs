// ED-FOLIAGE-02: Foliage tab logic (state, strokes along a drag, quest refs, commit/undo/redo). Run: node tools/editor/foliagePanel.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import { loadTestAssets } from '../testing/content-node.mjs';
import { createDoc } from './doc.js';
import { applyEdit, invert } from './commands.js';
import { createStack } from './undo.js';
import { createFoliageState, setFoliageParam, pointsAlong, buildExternalRefs, createFoliageController, foliageDabSpacing } from './foliagePanel.js';

const { assets, bundle } = await loadTestAssets();
const json = JSON.parse(readFileSync(new URL('../../content/editor/foliage.json', import.meta.url), 'utf8'));
const fileId = 'world/world_m1';
const flat = { structureAt: () => null, sectorAt: () => null, floorAt: () => 0 };

// state + clamps
const st = createFoliageState(json);
assert.deepEqual(st.ids, ['forest_edge', 'rock_field']); assert.equal(st.palette, 'forest_edge');
assert.equal(setFoliageParam(st, 'radius', 99), 24); assert.equal(setFoliageParam(st, 'radius', -3), 1);
assert.equal(setFoliageParam(st, 'density', 500), 20); assert.equal(setFoliageParam(st, 'density', 'x'), 0.1);
assert.equal(setFoliageParam(st, 'op', 'bogus'), 'paint'); assert.equal(setFoliageParam(st, 'op', 'erase'), 'erase');
assert.equal(setFoliageParam(st, 'palette', 'nope'), 'forest_edge'); assert.equal(setFoliageParam(st, 'palette', 'rock_field'), 'rock_field');
assert.equal(setFoliageParam(st, 'seed', 7.9), 7); assert.equal(setFoliageParam(st, 'falloff', 'hard'), 'hard');
assert.equal(createFoliageState(null).palette, null);

// drag interpolation
assert.deepEqual(pointsAlong(null, { x: 5, y: 5 }, 2), [[5, 5]]);
assert.equal(pointsAlong({ x: 0, y: 0 }, { x: 10, y: 0 }, 2).length, 5);
assert.deepEqual(pointsAlong({ x: 0, y: 0 }, { x: 1, y: 0 }, 2), []);
assert.equal(foliageDabSpacing(1), 1); assert.ok(foliageDabSpacing(24) > 8);

// quest refs
const refs = buildExternalRefs({ 'a.quest.json': JSON.stringify({ steps: [{ target: 'fol_12' }] }), 'ch/pack.json': '{"quests":[{"x":"fol_12","y":"hello world"}]}', 'bad.json': '{' });
assert.deepEqual(refs('fol_12').sort(), ['quest a.quest.json', 'quest ch/pack.json']); assert.deepEqual(refs('fol_99'), []);

// controller: paint -> one commit; erase refuses quest-referenced; undo/redo through the editor stack; Esc cancel
const fresh = () => { const doc = createDoc(assets, bundle), f = doc.files.get(fileId); f.def = structuredClone(f.def); f.meta = structuredClone(f.meta); return { doc, f }; };
const { doc, f } = fresh(), stack = createStack(), commits = [], msgs = [];
const commit = (rec) => { applyEdit(doc, rec); stack.push(rec); commits.push(rec); };
const count = () => f.def.structures.filter((s) => s.id.startsWith('fol_')).length;
let extra = () => [];
const host = { doc, fileId, assets, json, getWorld: () => flat, commit, flash: (m) => msgs.push(m), externalRefs: (id) => extra(id) };
const s2 = createFoliageState(json); s2.density = 20; s2.radius = 8; s2.palette = 'rock_field';
const ctl = createFoliageController(host, s2);
assert.ok(ctl.start({ x: 500, y: 500 })); assert.ok(ctl.active);
ctl.move({ x: 506, y: 500 }); ctl.move({ x: 512, y: 502 });
assert.ok(ctl.ghosts().length > 10, 'ghosts while dragging');
assert.equal(count(), 0, 'nothing in the doc until the stroke ends');
const info = ctl.end();
assert.ok(!ctl.active && ctl.ghosts().length === 0);
assert.equal(commits.length, 1, 'one commit per stroke'); assert.equal(commits[0].label, 'foliage paint');
const n = count(); assert.equal(n, commits[0].batch.length); assert.ok(n > 10);
assert.ok(/foliage paint: \d+ placements/.test(msgs.at(-1)));
// undo/redo
{ const rec = stack.undo(); applyEdit(doc, invert(rec)); assert.equal(count(), 0, 'undo');
  const re = stack.redo(); applyEdit(doc, re); assert.equal(count(), n, 'redo'); }
// cancel
ctl.start({ x: 560, y: 560 }); ctl.move({ x: 566, y: 560 }); assert.equal(ctl.end(true).rec, null);
assert.equal(commits.length, 1, 'cancelled stroke commits nothing'); assert.equal(count(), n);
// erase with a quest reference blocking one placement
const keep = commits[0].batch[0].after.id; extra = (id) => id === keep ? ['quest q.json'] : [];
setFoliageParam(s2, 'op', 'erase'); setFoliageParam(s2, 'radius', 24); setFoliageParam(s2, 'falloff', 'hard');
ctl.start({ x: 506, y: 500 }); const e = ctl.end();
assert.equal(e.refused.length, 1); assert.equal(e.refused[0].id, keep); assert.deepEqual(e.refused[0].refs, ['quest q.json']);
assert.equal(commits.length, 2); assert.equal(count(), 1, 'only the referenced placement survives');
applyEdit(doc, invert(stack.undo())); assert.equal(count(), n, 'erase undo');
// no palette -> refuses to start
assert.equal(createFoliageController({ ...host, flash: () => {} }, createFoliageState(null)).start({ x: 0, y: 0 }), false);
console.log('foliagePanel.test.mjs: ok');
