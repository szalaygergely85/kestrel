// engine/content/prefabFile.test.js - PREFAB-SEAM (docs/architecture.md 38.11): prefabFromJSON + placePrefabItems.
//   node engine/content/prefabFile.test.js
import { prefabFromJSON, placePrefabItems } from './prefabFile.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const good = () => ({ kind: 'prefab', schema: 1, id: 'crate_corner', nextId: 3, title: 'crate corner', items: [
  { id: 'p1', type: 'prop', model: 'crate', x: 0.4, y: -0.2, z: 0, facing: 90, colliders: [{ w: 1 }] },
  { id: 'p2', type: 'light', preset: 'lantern', x: 0, y: 0, z: 1.3 },
] });

// returns the ContentError.field of a rejected mutation, or '' if accepted
const rejectField = (mut) => { const o = good(); mut(o); try { prefabFromJSON(o); return ''; } catch (e) { return e.field; } };

// --- accept ---
const pf = prefabFromJSON(good());
ok('accept: id/title/items', pf.id === 'crate_corner' && pf.title === 'crate corner' && pf.items.length === 2);
ok('accept: result is frozen (deep)', Object.isFrozen(pf) && Object.isFrozen(pf.items) && Object.isFrozen(pf.items[0]) && Object.isFrozen(pf.items[0].colliders[0]));
const src = good();
ok('accept: copy, not the input object', prefabFromJSON(src).items[0] !== src.items[0] && !Object.isFrozen(src.items[0]));
ok('accept: yawDeg instead of facing', rejectField((o) => { o.items[0].yawDeg = 10; delete o.items[0].facing; }) === '');
ok('accept: boundary |x|=64, z=-16 and 64', rejectField((o) => { o.items[0].x = 64; o.items[0].y = -64; o.items[0].z = -16; o.items[1].z = 64; }) === '');
ok('accept: missing title defaults to id', prefabFromJSON({ ...good(), title: undefined }).title === 'crate_corner');

// --- reject, one row per rule, with the field path ---
const rows = [
  ['kind', (o) => { o.kind = 'level'; }, 'kind'],
  ['id uppercase', (o) => { o.id = 'crateCorner'; }, 'id'],
  ['id missing', (o) => { delete o.id; }, 'id'],
  ['title not string', (o) => { o.title = 5; }, 'title'],
  ['items not array', (o) => { o.items = {}; }, 'items'],
  ['items empty', (o) => { o.items = []; }, 'items'],
  ['items 257', (o) => { o.items = Array.from({ length: 257 }, () => ({ type: 'light', x: 0, y: 0, z: 0 })); }, 'items'],
  ['item not object', (o) => { o.items[1] = 4; }, 'items[1]'],
  ['bad type', (o) => { o.items[1].type = 'npc'; }, 'items[1].type'],
  ['x NaN', (o) => { o.items[0].x = NaN; }, 'items[0].x'],
  ['y string', (o) => { o.items[0].y = '1'; }, 'items[0].y'],
  ['|x| > 64', (o) => { o.items[1].x = 64.5; }, 'items[1].x'],
  ['|y| > 64', (o) => { o.items[1].y = -65; }, 'items[1].y'],
  ['z missing', (o) => { delete o.items[1].z; }, 'items[1].z'],
  ['z < -16', (o) => { o.items[0].z = -16.1; }, 'items[0].z'],
  ['z > 64', (o) => { o.items[0].z = 65; }, 'items[0].z'],
  ['facing Infinity', (o) => { o.items[0].facing = Infinity; }, 'items[0].facing'],
  ['yawDeg NaN', (o) => { o.items[1].yawDeg = NaN; }, 'items[1].yawDeg'],
  ['prop without model', (o) => { delete o.items[0].model; }, 'items[0].model'],
  ['prop empty model', (o) => { o.items[0].model = ''; }, 'items[0].model'],
  ['forbidden group', (o) => { o.items[0].group = 'g1'; }, 'items[0].group'],
  ['forbidden prefab', (o) => { o.items[0].prefab = 'x'; }, 'items[0].prefab'],
  ['forbidden structId', (o) => { o.items[1].structId = 's'; }, 'items[1].structId'],
  ['forbidden prop', (o) => { o.items[1].prop = 'p'; }, 'items[1].prop'],
  ['forbidden light', (o) => { o.items[0].light = 'l'; }, 'items[0].light'],
  ['forbidden flameProp', (o) => { o.items[0].flameProp = 'f'; }, 'items[0].flameProp'],
];
for (const [name, mut, field] of rows) ok(`reject: ${name} -> ${field}`, rejectField(mut) === field, `got "${rejectField(mut)}"`);
ok('reject: non-object input', (() => { try { prefabFromJSON(null); return false; } catch (e) { return e.name === 'ContentError'; } })());

// --- place ---
const near = (a, b) => Math.abs(a - b) < 1e-9;
const snapshot = JSON.stringify(pf);
const w0 = placePrefabItems(pf, { x: 10, y: 5, z: 0, yawDeg: 0 });
ok('place yaw 0: translated, type split out, id dropped', w0.length === 2 && w0[0].type === 'prop' && near(w0[0].item.x, 10.4) && near(w0[0].item.y, 4.8) && near(w0[0].item.z, 0) && !('id' in w0[0].item) && !('type' in w0[0].item) && w0[0].item.model === 'crate');
ok('place yaw 0: facing kept, light z offset', near(w0[0].item.facing, 90) && near(w0[1].item.z, 1.3) && w0[1].item.preset === 'lantern');
// rotateVec2(90, 0.4, -0.2) = (0.4*cos90 + 0.2*sin90, 0.4*sin90 - 0.2*cos90) = (0.2, 0.4)
const w90 = placePrefabItems(pf, { x: 10, y: 5, z: 2, yawDeg: 90 });
ok('place (10,5,z2,yaw 90): hand-computed coords', near(w90[0].item.x, 10.2) && near(w90[0].item.y, 5.4) && near(w90[0].item.z, 2) && near(w90[1].item.z, 3.3), JSON.stringify(w90[0].item));
ok('place yaw 90: facing 90+90 = 180', near(w90[0].item.facing, 180));
ok('place: facing wraps into [0,360)', near(placePrefabItems(pf, { x: 0, y: 0, z: 0, yawDeg: 300 })[0].item.facing, 30));
const withYaw = prefabFromJSON({ ...good(), items: [{ type: 'light', x: 1, y: 0, z: 0, yawDeg: 350 }] });
ok('place: yawDeg field is rotated too', near(placePrefabItems(withYaw, { x: 0, y: 0, z: 0, yawDeg: 20 })[0].item.yawDeg, 10));
ok('place: item without facing gets none', !('facing' in w90[1].item) && !('yawDeg' in w90[1].item));
ok('place: input prefab not mutated', JSON.stringify(pf) === snapshot);
ok('place: output items are independent clones', (() => { w0[0].item.colliders[0].w = 9; return pf.items[0].colliders[0].w === 1 && w90[0].item.colliders[0].w === 1; })());
// 4 x 90 = identity: re-stamp the local frame four times
let cur = pf;
for (let i = 0; i < 4; i++) cur = { items: placePrefabItems(cur, { x: 0, y: 0, z: 0, yawDeg: 90 }).map((p) => ({ ...p.item, type: p.type })) };
ok('place: 4 x 90 degrees = identity (1e-9)', cur.items.every((it, i) => near(it.x, pf.items[i].x) && near(it.y, pf.items[i].y) && near(it.z, pf.items[i].z)) && near(cur.items[0].facing, 90));

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
