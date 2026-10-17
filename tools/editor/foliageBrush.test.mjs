// ED-FOLIAGE-01: foliage brush placements mode (architecture.md 38.69). Run: node tools/editor/foliageBrush.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stringifyContent } from '../../engine/index.js';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import { loadTestAssets } from '../testing/content-node.mjs';
import { createDoc } from './doc.js';
import { toFileObject } from './io.js';
import { applyEdit, invert } from './commands.js';
import { validateFoliagePalettes, paletteSpecies, beginFoliageStroke, foliageFalloff, FOLIAGE_MAX_PER_STROKE } from './foliageBrush.js';

const { assets, bundle } = await loadTestAssets();
const json = JSON.parse(readFileSync(new URL('../../content/editor/foliage.json', import.meta.url), 'utf8'));
assert.deepEqual(validateFoliagePalettes(json, { assets }), [], 'shipped palette validates');
assert.deepEqual(Object.keys(json.palettes), ['forest_edge', 'rock_field']);
// validator rejects: unknown key, no proxy, unknown mesh, bad ranges
const bad = (patch) => validateFoliagePalettes({ version: 1, palettes: { p: { place: [{ mesh: 'quaternius/Rock_Medium_1', w: 1, gapM: 1, scale: [1, 1], maxSlopeDeg: 30, ...patch }] } } }, { assets });
assert.deepEqual(bad({}), []);
assert.ok(bad({ extra: 1 }).some(e => /unknown key/.test(e)));
assert.ok(bad({ mesh: 'quaternius/Nope' }).some(e => /unknown registered mesh/.test(e)));
assert.ok(bad({ mesh: 'quaternius/CommonTree_1_LOD1' }).some(e => /no collider proxy/.test(e)), 'collider-less species refused');
assert.ok(bad({ scale: [2, 1] }).length && bad({ maxSlopeDeg: 95 }).length && bad({ gapM: -1 }).length && bad({ w: 0 }).length);
assert.ok(validateFoliagePalettes({ version: 2, palettes: {}, x: 1 }, { assets }).length >= 2);
assert.throws(() => paletteSpecies(json, 'missing', { assets }));

assert.equal(foliageFalloff(0.5, 'hard'), 1); assert.equal(foliageFalloff(1.01, 'hard'), 0);
assert.ok(foliageFalloff(0, 'smooth') === 1 && foliageFalloff(1, 'smooth') === 0 && foliageFalloff(0.3, 'smooth') > foliageFalloff(0.7, 'smooth'));

const fileId = 'world/world_m1';
const fresh = () => { const doc = createDoc(assets, bundle), file = doc.files.get(fileId); file.def = structuredClone(file.def); file.meta = structuredClone(file.meta); return { doc, file }; };
const flat = (extra = {}) => ({ structureAt: () => null, sectorAt: () => null, floorAt: () => 0, ...extra });
const species = paletteSpecies(json, 'rock_field', { assets });
const trees = paletteSpecies(json, 'forest_edge', { assets });
const run = (doc, world, sp, p, centres = [[500, 500]]) => {
  const s = beginFoliageStroke({ doc, fileId, assets, world, species: sp }, { op: 'paint', radius: 10, falloff: 'hard', density: 20, seed: 7, ...p });
  for (const [x, y] of centres) s.dab(x, y);
  return { s, rec: s.end() };
};
const small = [{ ...species[0], gapM: 0.2 }]; // gap rules out of the way for density tests

// deterministic per seed, ids fol_, snapped to the floor
const a = fresh(), b = fresh();
const ra = run(a.doc, flat(), species, { seed: 3 }), rb = run(b.doc, flat(), species, { seed: 3 }), rc = run(fresh().doc, flat(), species, { seed: 4 });
assert.deepEqual(ra.rec, rb.rec, 'same seed -> same record');
assert.notDeepEqual(ra.rec.batch.map(r => r.after.origin), rc.rec.batch.map(r => r.after.origin), 'other seed differs');
assert.ok(ra.rec.batch.length > 10 && ra.rec.batch.every(r => /^fol_\d+$/.test(r.after.id) && r.after.mesh.startsWith('quaternius/Rock_Medium')));
{ const w = flat({ floorAt: (x, y) => 0.5 * Math.sin(x * 0.3) }); // snapped on bumpy ground: z within one footprint of floor+lift
  const r = run(fresh().doc, w, species, { seed: 3 });
  for (const rec of r.rec.batch) { const it = rec.after, f = w.floorAt(it.origin.x, it.origin.y); assert.ok(Math.abs(it.origin.z - f) < 1.5 && it.origin.z >= f - 0.13, 'z comes from the snap'); } }

// density within 10 % on flat ground over a 20 m disc (average of 4 seeds, hard falloff)
{ let n = 0; for (const seed of [1, 2, 3, 4]) n += run(fresh().doc, flat(), small, { seed, density: 20, radius: 10 }).rec.batch.length;
  const expect = 4 * 20 / 100 * Math.PI * 100;
  assert.ok(Math.abs(n - expect) / expect < 0.1, `density ${n} vs ${expect.toFixed(0)}`); }

// reject rules
{ const r = run(fresh().doc, flat({ floorAt: () => null }), small, {}); assert.equal(r.rec, null); assert.ok(r.s.stats.noFloor > 0, 'no floor'); }
{ const r = run(fresh().doc, flat({ structureAt: () => ({}), sectorAt: () => null }), small, {}); assert.equal(r.rec, null, 'courtyard gap'); }
{ const r = run(fresh().doc, flat({ structureAt: () => ({}), sectorAt: () => ({}) }), small, {}); assert.equal(r.rec, null); assert.ok(r.s.stats.zone > 0, 'inside structure bbox'); }
{ const r = run(fresh().doc, flat({ floorAt: (x, y) => 2 * x }), small, {}); assert.equal(r.rec, null); assert.ok(r.s.stats.slope > 0, 'slope 63 deg > 45'); }
{ const r = run(fresh().doc, flat({ floorAt: (x, y) => 0.3 * x }), small, {}); assert.ok(r.rec.batch.length > 10, 'slope 17 deg is fine'); }
{ const r = run(fresh().doc, flat({ waterAt: (x, y, o) => { o.surfaceZ = 2; o.depth = 2; return true; } }), small, {}); assert.equal(r.rec, null); assert.ok(r.s.stats.water > 0, 'water'); }
{ const wide = [{ ...species[0], gapM: 6 }], r = run(fresh().doc, flat(), wide, { density: 20 });
  const pts = r.rec.batch.map(x => x.after.origin);
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= 6, 'gap inside the stroke');
  assert.ok(r.s.stats.gap > 0);
  // spacing against an existing placement (any mesh counts, default gap 0.5)
  const { doc, file } = fresh(); file.def.structures.push({ id: 'old', mesh: 'quaternius/Pebble_Round_1', origin: { x: 500.5, y: 500.5, z: 0 }, yawDeg: 0 });
  const r2 = run(doc, flat(), wide, { density: 20 }); assert.ok(!r2.rec.batch.some(x => Math.hypot(x.after.origin.x - 500.5, x.after.origin.y - 500.5) < 6), 'gap vs existing placement'); }
{ const r = run(fresh().doc, flat(), small, { density: 20, radius: 24 }); assert.equal(r.rec.batch.length, FOLIAGE_MAX_PER_STROKE); assert.ok(r.s.messages.length, 'cap message'); }

// one batch record, undo byte-identical, ids never reused
{ const { doc, file } = fresh(), text0 = stringifyContent(toFileObject(file)), next0 = file.meta.nextId;
  const { rec } = run(doc, flat(), species, { seed: 9 }, [[500, 500], [506, 500], [512, 500]]);
  assert.equal(rec.label, 'foliage paint'); assert.ok(Array.isArray(rec.batch) && rec.batch.length > 10);
  assert.equal(new Set(rec.batch.map(r => r.after.id)).size, rec.batch.length);
  applyEdit(doc, rec);
  assert.equal(file.def.structures.filter(s => s.id.startsWith('fol_')).length, rec.batch.length);
  applyEdit(doc, invert(rec));
  const t = JSON.parse(stringifyContent(toFileObject(file))); delete t.nextId; const o = JSON.parse(text0); delete o.nextId;
  assert.deepEqual(t, o, 'undo restores the doc');
  assert.ok(file.meta.nextId > next0, 'undo never reuses ids');
  assert.equal(stringifyContent(toFileObject(file)).replace(/"nextId": \d+/, ''), text0.replace(/"nextId": \d+/, ''), 'byte-identical apart from the nextId counter');

  // erase: palette species only, referrer refusal, Shift erases any species, one batch, undo identical
  applyEdit(doc, rec);
  const keepId = rec.batch[0].after.id, textP = stringifyContent(toFileObject(file));
  file.def.entities.push({ id: 'refer', spawn: { structure: keepId } }); // in-file referrer
  const er = beginFoliageStroke({ doc, fileId, assets, world: flat(), species }, { op: 'erase', radius: 24, falloff: 'hard', density: 1, seed: 1, externalRefs: id => id === rec.batch[1].after.id ? ['quest.q1'] : [] });
  er.dab(506, 500);
  const erec = er.end();
  assert.equal(er.refused.length, 2, 'both referenced placements refused'); assert.ok(er.refused.some(r => r.id === keepId) && er.refused.some(r => r.id === rec.batch[1].after.id));
  assert.ok(!erec.batch.some(r => r.id === keepId || r.id === rec.batch[1].after.id));
  assert.equal(erec.label, 'foliage erase');
  const before = structuredClone(file.def.structures);
  applyEdit(doc, erec);
  assert.ok(file.def.structures.length < before.length && file.def.structures.some(s => s.id === keepId));
  applyEdit(doc, invert(erec));
  assert.deepEqual(file.def.structures, before, 'erase undo restores order and content');
  file.def.entities.pop();
  assert.equal(stringifyContent(toFileObject(file)), textP, 'byte-identical after erase+undo');
  // non-palette placements are kept unless Shift
  const stray = { id: 'tree_x', mesh: 'quaternius/Pebble_Round_1', origin: { x: 506, y: 500, z: 0 }, yawDeg: 0 }; file.def.structures.push(stray);
  const e2 = beginFoliageStroke({ doc, fileId, assets, world: flat(), species }, { op: 'erase', radius: 24, falloff: 'hard', density: 1, seed: 1 }); e2.dab(506, 500);
  assert.ok(!e2.end().batch.some(r => r.id === 'tree_x'), 'non-palette species kept');
  const e3 = beginFoliageStroke({ doc, fileId, assets, world: flat(), species }, { op: 'erase', radius: 24, falloff: 'hard', density: 1, seed: 1, shift: true }); e3.dab(506, 500);
  assert.ok(e3.end().batch.some(r => r.id === 'tree_x'), 'Shift erases any mesh species');
  // erase with nothing in range -> null
  const e4 = beginFoliageStroke({ doc, fileId, assets, world: flat(), species }, { op: 'erase', radius: 2, falloff: 'hard', density: 1, seed: 1 }); e4.dab(-900, -900);
  assert.equal(e4.end(), null); }
// trees palette also works
{ const r = run(fresh().doc, flat(), trees, { seed: 5 }); assert.ok(r.rec.batch.length > 5); }
console.log('foliageBrush: all ok');
