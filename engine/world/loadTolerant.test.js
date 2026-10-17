// OB-014/OB-166: World.load tolerates a prop whose model is missing (warn once, skip only that prop);
// opts.strict (validators / content-lint) keeps the throw.
import assert from 'node:assert/strict';
import { World } from './World.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { dynamicTowerAssets } from '../../tools/testing/dynamic-tower.mjs';

import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; farTowerMod; ferrumLightsMod;
const assets = dynamicTowerAssets((await loadTestAssets()).assets);
const def = { terrain: null, structures: [{ id: 'tower', level: 'tower', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }], entities: [] };
const props = (assets.level('tower').def?.props || assets.level('tower').props || []).filter((p) => !p.from && !p.to && typeof p.model === 'string' && !p.model.startsWith('decal:'));
const victim = props[0].model;
const sameModel = props.filter((p) => p.model === victim).length;
const hide = new Proxy(assets, { get(t, k) {
  if (k === 'has') return (kind, key) => !(kind === 'model' && key === victim) && t.has(kind, key);
  const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
} });
const base = World.load(def, assets, {});
const warns = []; const ow = console.warn; console.warn = (m) => warns.push(String(m));
let w; try { w = World.load(def, hide, {}); World.load(def, hide, {}); } finally { console.warn = ow; }
assert.ok(w, 'load succeeds');
assert.equal(warns.filter((m) => m.includes(`"${victim}"`)).length, 1, 'warns once per model id');
const count = (x) => x._entities.size;
assert.equal(count(w), count(base) - sameModel, 'only props with the missing model are skipped');
assert.throws(() => World.load(def, hide, { strict: true }), /unknown model/);
console.log('loadTolerant: ALL PASS');
