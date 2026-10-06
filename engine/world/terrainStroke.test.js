// engine/world/terrainStroke.test.js (ED-TERRAIN-1b, docs/architecture.md 37.12): stroke-end rebuild.
// Run: node engine/world/terrainStroke.test.js
import { World } from './World.js';
import { createEditLayer, editLayerToJSON, applyDab } from './terrainEdits.js';
import { TerrainMeshSet } from '../mesh/terrainMesh.js';
import { makeOk } from '../test/assert.js';
import terrainDef from '../../design/levels/overworld_far.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
terrainDef; paletteMod; detailPassMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; m3PropsMod; farTowerMod; ferrumLightsMod;
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const { assets } = await loadTestAssets();
const files = new Map();
const withEdits = Object.create(assets); withEdits.terrainEdits = (k) => files.get(k) || null;
files.set('overworld_far', editLayerToJSON(createEditLayer(2, 128), 'overworld_far')); // empty layer so the hook is live
const OPTS = { physics: 'mesh', realTrees: true, detail: true };

const w = World.load(withEdits.world('world_m1'), withEdits, OPTS);
const T = w.terrain, layer = T.edits;
ok('world loads with a live edit layer, trees and detail', !!layer && w.scatter && w.scatter.count > 0 && w.detail && w.detail.count > 0, `${w.scatter && w.scatter.count} ${w.detail && w.detail.count}`);
const set = new TerrainMeshSet(T); set.step(1e9);
let rescatter = 0;
w.events = { emit(n) { if (n === 'world:scatter') rescatter++; } };

// a stroke over the densest tree area + around the spawn: 20 dabs along a line
const sx = w.def.spawn ? w.def.spawn.x : 1500, sy = w.def.spawn ? w.def.spawn.y : 1000;
const groundIds = w._groundSnap.map((g) => g.id);
ok('ground-snapped props/entities are tracked', w._groundSnap.length > 0, `${w._groundSnap.length}`);
const gBefore = w._groundSnap.map((g) => w.entity(g.id).transform.z);
const trees0 = w.scatter.count, detail0 = w.detail.count;
const rect = {};
for (let k = 0; k < 20; k++) {
  const g = w._groundSnap[0];
  applyDab(layer, T, 'raise', g.x - 20 + k * 2, g.y, 8, 0.6, rect);
  T.rebakeRect(rect.i0 * 2, rect.j0 * 2, rect.i1 * 2, rect.j1 * 2);
  set.markNearDirty();
}
const info = w.refreshTerrainScatter();
const info2 = w.refreshTerrainScatter(); // steady-state (JIT warm) repeat
console.log(`second run (warm): ${info2.ms.toFixed(1)} ms`);
console.log(`stroke end: ${info.ms.toFixed(1)} ms (trees ${trees0} -> ${info.trees}, detail ${detail0} -> ${info.detail}, snapped ${info.snapped})`);
ok('stroke end <= 150 ms', info.ms <= 150, info.ms.toFixed(1));
ok('world:scatter emitted per refresh', rescatter === 2);
ok('a ground-snapped prop moved with the terrain', info.snapped > 0 && w._groundSnap.some((g, i) => w.entity(g.id).transform.z !== gBefore[i]), `${info.snapped}`);

// oracle: a fresh load from the saved edits file
files.set('overworld_far', editLayerToJSON(layer, 'overworld_far'));
const f = World.load(withEdits.world('world_m1'), withEdits, OPTS);
const sameF64 = (a, b, n) => { for (let i = 0; i < n; i++) if (!Object.is(a[i], b[i])) return false; return true; };
ok('trees == fresh load (count, x, y, z)', w.scatter.count === f.scatter.count && sameF64(w.scatter.x, f.scatter.x, f.scatter.count) && sameF64(w.scatter.y, f.scatter.y, f.scatter.count) && sameF64(w.scatter.z, f.scatter.z, f.scatter.count), `${w.scatter.count} vs ${f.scatter.count}`);
ok('detail == fresh load (count, z)', w.detail.count === f.detail.count && sameF64(w.detail.z, f.detail.z, f.detail.count));
const ids = (x) => x.colliders.map((c) => c.id).sort().join();
ok('collider set == fresh load', ids(w) === ids(f), `${ids(w)} vs ${ids(f)}`);
const trunkTris = (x) => x.colliders.find((c) => c.id === 'scatter:trunks');
ok('trunk collider rebuilt (new object, same triangle count)', trunkTris(w) && trunkTris(f) && trunkTris(w).bvh && trunkTris(w).bvh.triCount === trunkTris(f).bvh.triCount, 'tri count');
ok('ground-snapped z == fresh load', w._groundSnap.every((g) => Object.is(w.entity(g.id).transform.z, f.entity(g.id).transform.z)));
ok('terrain bounds exact == fresh', T.near.minH === f.terrain.near.minH && T.near.maxH === f.terrain.near.maxH && T.farMaxH === f.terrain.farMaxH && T.farMinH === f.terrain.farMinH);
// item 4: a moved ground prop re-snaps at its CURRENT x/y, not the load-time spot
{
  const g = w._groundSnap[0], e = w.entity(g.id);
  e.transform.x = g.x + 30; e.transform.y = g.y + 10;
  const r2 = {};
  applyDab(layer, T, 'raise', e.transform.x, e.transform.y, 8, 2, r2);
  T.rebakeRect(r2.i0 * 2, r2.j0 * 2, r2.i1 * 2, r2.j1 * 2);
  w.refreshTerrainScatter();
  ok('moved ground prop: z follows the new spot', Object.is(e.transform.z, T.groundAt(e.transform.x, e.transform.y)) && !Object.is(e.transform.z, T.groundAt(g.x, g.y)), `${e.transform.z} vs ${T.groundAt(e.transform.x, e.transform.y)}`);
}
void groundIds; void sx; void sy;
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((x) => console.error('FAIL:', x)); process.exit(1); }
console.log('ALL PASS');
