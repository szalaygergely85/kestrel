// Regression (owner bug 2026-10-01): "Import .vox" added the model to the
// AssetRegistry but VoxelPool (bound once at load) never packed it, so a
// placed instance rendered nothing. doImportVox now re-binds the pool.
import { VoxelPool } from '../../engine/index.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
const quadruped12 = (voxelPropsMod.lantern || voxelPropsMod.models?.lantern).voxel;

let fail = 0;
const ok = (n, c) => { if (!c) { fail++; console.log('FAIL ' + n); } };
// Minimal registry stand-in with the same keys/model/add surface bind() uses.
const store = new Map();
const reg = { keys: () => [...store.keys()], model: (k) => store.get(k), add: (_kind, k, d) => store.set(k, d) };
const ids = new Map();
const table = { idFor: (k) => { if (!ids.has(k)) ids.set(k, ids.size + 1); return ids.get(k); } };
const pool = new VoxelPool();
pool.bind(reg, table);
reg.add('model', 'imp', { name: 'imp', voxel: quadruped12 });
ok('runtime add is NOT in the pool before re-bind (the bug)', !pool.models.has('imp'));
const v0 = pool.atlas.version;
pool.bind(reg, table);
ok('after re-bind the imported model is packed', pool.models.has('imp'));
ok('re-bind bumps atlas.version (GPU re-upload)', pool.atlas.version > v0);
const big = { ...quadruped12, meshOnly: true };
reg.add('model', 'impBig', { name: 'impBig', voxel: big });
pool.bind(reg, table);
ok('meshOnly import is packed but kept out of the DDA atlas', pool.models.get('impBig').meshOnly && pool._modelIndexByKey.impBig === undefined);
console.log(fail ? `${fail} FAILED` : 'voxImportRebind: all passed');
process.exit(fail ? 1 : 0);
