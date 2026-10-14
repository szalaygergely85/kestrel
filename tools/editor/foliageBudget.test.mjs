// ED-FOLIAGE-05: budget meter, hard-cap refusal, terrain re-snap. Run: node tools/editor/foliageBudget.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import { loadTestAssets } from '../testing/content-node.mjs';
import { createDoc } from './doc.js';
import { applyEdit, invert } from './commands.js';
import { createStack } from './undo.js';
import { createFoliageState } from './foliagePanel.js';
import { createFoliageController } from './foliagePanel.js';
import { resnapFoliage, floatingFoliage } from './foliageBrush.js';
import * as B from './foliageBudget.js';

const { assets, bundle } = await loadTestAssets();
const json = JSON.parse(readFileSync(new URL('../../content/editor/foliage.json', import.meta.url), 'utf8'));
const fileId = 'world/world_m1';
const ROCK = 'quaternius/Rock_Medium_1', TREE = 'quaternius/CommonTree_1';
const fresh = () => { const doc = createDoc(assets, bundle), f = doc.files.get(fileId); f.def = structuredClone(f.def); f.meta = structuredClone(f.meta); f.def.structures = []; return { doc, f }; };

// ---- meter equals a hand sum on a fixture ----
{
  const m1 = assets.mesh(ROCK), m2 = assets.mesh(json.palettes.forest_edge.place[1].mesh);
  const items = [
    { id: 'a', mesh: ROCK, origin: { x: 10, y: 10, z: 0 } }, { id: 'b', mesh: ROCK, origin: { x: 20, y: 30, z: 0 } },
    { id: 'c', mesh: json.palettes.forest_edge.place[1].mesh, origin: { x: 100, y: 5, z: 0 } },
    { id: 'd', mesh: ROCK, origin: { x: 200, y: 5, z: 0 } }, // other zone
  ];
  const st = B.zoneStats(items, assets, { cx: 0, cy: 0 }, { baseBytes: 1000 });
  const hand = { meshes: 3, tris: 2 * m1.triCount + m2.triCount, colliderBytes: 2 * m1.collider.byteLength + m2.collider.byteLength };
  assert.equal(st.meshes, hand.meshes); assert.equal(st.tris, hand.tris); assert.equal(st.colliderBytes, hand.colliderBytes);
  assert.equal(st.bytes, 1000 + hand.colliderBytes);
  assert.equal(B.zoneStats(items, assets, { cx: 1, cy: 0 }).meshes, 1);
  assert.ok(/MB/.test(B.meterText(st)) && B.meterFill(st) > 0 && B.meterFill(st) < 1);
}
// ---- levels ----
const L = (bytes, tris = 0) => B.meterLevel({ bytes, tris });
assert.equal(L(1 * B.MB), 'green'); assert.equal(L(B.BUNDLE_TARGET_BYTES), 'amber'); assert.equal(L(5 * B.MB), 'amber');
assert.equal(L(B.BUNDLE_HARD_BYTES), 'red'); assert.equal(L(0, B.FOLIAGE_TRI_CAP), 'red'); assert.equal(L(0, B.FOLIAGE_TRI_TARGET), 'amber');
assert.equal(B.FOLIAGE_TRI_CAP, 1.5e6);

// ---- checkBudget + hard-cap refusal through the controller ----
const flat = { structureAt: () => null, sectorAt: () => null, floorAt: () => 0 };
{
  const { doc, f } = fresh(), stack = createStack(), msgs = [], commits = [];
  let base = 0;
  const commit = rec => { applyEdit(doc, rec); stack.push(rec); commits.push(rec); };
  const host = { doc, fileId, assets, json, getWorld: () => flat, commit, flash: m => msgs.push(m),
    budget: items => B.checkBudget(f.def.structures, assets, items, () => base) };
  const st = createFoliageState(json); st.palette = 'rock_field'; st.density = 20; st.radius = 8;
  const ctl = createFoliageController(host, st);
  ctl.start({ x: 500, y: 500 }); ctl.move({ x: 508, y: 500 });
  assert.ok(ctl.end().rec, 'under the cap: committed'); assert.equal(commits.length, 1);
  const n = f.def.structures.length;
  base = B.BUNDLE_HARD_BYTES - 10; // zone already at the hard cap: any proxy bytes push it over
  ctl.start({ x: 600, y: 500 }); ctl.move({ x: 608, y: 500 });
  const r = ctl.end();
  assert.equal(r.rec, null); assert.ok(r.budget && !r.budget.ok); assert.equal(commits.length, 1, 'refused stroke commits nothing');
  assert.equal(f.def.structures.length, n); assert.ok(/refused/.test(msgs.at(-1)) && /MB/.test(msgs.at(-1)), msgs.at(-1));
  // triangle cap alone (bytes fine): fake a mesh registry with huge triCount
  const big = { mesh: () => ({ triCount: B.FOLIAGE_TRI_CAP, collider: new Float32Array(9) }) };
  const c = B.checkBudget([{ id: 'x', mesh: 'm', origin: { x: 1, y: 1, z: 0 } }], big, [{ id: 'y', mesh: 'm', origin: { x: 2, y: 2, z: 0 } }]);
  assert.ok(!c.ok && /triangles/.test(c.reason));
  assert.ok(B.checkBudget([], assets, []).ok);
}

// ---- measureZone uses the injected BandBakeJob + bundleBytes ----
{
  let args; const BandBakeJob = { create: (...a) => { args = a; return { step() {}, bundle: () => ({ b: 1 }) }; } };
  assert.equal(B.measureZone('W', { cx: 3, cy: 2 }, { BandBakeJob, bundleBytes: b => (b.b ? 4242 : 0) }), 4242);
  assert.deepEqual(args.slice(0, 3), ['W', 3, 2]);
}

// ---- terrain edit re-snap: paint + terrain edit + undo, 0 floating fol_ ----
{
  const { doc, f } = fresh(), stack = createStack();
  let bump = 0; // terrain edit: raises x in 495..520 by `bump`
  const world = { structureAt: () => null, sectorAt: () => null, floorAt: (x) => (x >= 495 && x <= 520 ? bump : 0) };
  const commit = rec => { applyEdit(doc, rec); stack.push(rec); };
  const ctx = { doc, fileId, assets, world };
  const st = createFoliageState(json); st.palette = 'rock_field'; st.density = 20; st.radius = 10;
  const ctl = createFoliageController({ doc, fileId, assets, json, getWorld: () => world, commit }, st);
  ctl.start({ x: 500, y: 500 }); ctl.move({ x: 510, y: 500 }); ctl.end();
  const n = f.def.structures.length; assert.ok(n > 10);
  assert.equal(floatingFoliage(ctx).length, 0, 'fresh paint: nothing floats');
  const before = structuredClone(f.def.structures);
  // terrain stroke raises the ground; without re-snap the rocks sink/float
  bump = 3;
  assert.ok(floatingFoliage(ctx).length > 0, 'sanity: a terrain edit alone leaves foliage off the floor');
  const terrainRec = { kind: 'terrain', label: 'terrain raise', foliage: resnapFoliage(ctx, [490, 480, 525, 520]) };
  assert.ok(terrainRec.foliage && terrainRec.foliage.batch.length > 0);
  assert.equal(terrainRec.foliage.batch[0].label, 'resnap');
  applyEdit(doc, terrainRec.foliage);
  assert.equal(floatingFoliage(ctx).length, 0, 'after re-snap: floating 0');
  assert.ok(f.def.structures.some(s => s.origin.z >= 3 - 0.5), 'z moved up with the floor');
  assert.equal(resnapFoliage(ctx, [490, 480, 525, 520]), null, 'idempotent');
  // undo restores both: terrain back to 0 and z back to the painted values
  applyEdit(doc, invert(terrainRec.foliage)); bump = 0;
  assert.deepEqual(f.def.structures, before, 'undo restores z byte-identical');
  assert.equal(floatingFoliage(ctx).length, 0, 'after undo: floating 0');
  applyEdit(doc, terrainRec.foliage); bump = 3;
  assert.equal(floatingFoliage(ctx).length, 0, 'redo: floating 0');
  // non-fol_ placements are never re-snapped; outside the rect untouched
  f.def.structures.push({ id: 'mesh_999', mesh: ROCK, origin: { x: 510, y: 510, z: 0 }, yawDeg: 0 });
  bump = 6; const rr = resnapFoliage(ctx, [490, 480, 525, 520]);
  assert.ok(rr.batch.every(r => r.id.startsWith('fol_')));
  assert.equal(resnapFoliage(ctx, [0, 0, 10, 10]), null, 'far rect: nothing');
}
console.log('foliageBudget.test.mjs OK');
