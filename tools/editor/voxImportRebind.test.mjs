// Regression (owner bug 2026-10-01): "Import .vox" added the model to the
// AssetRegistry but VoxelPool (bound once at load) never packed it, so a
// placed instance rendered nothing. doImportVox now re-binds the pool.
import { VoxelPool, validateVoxelModel } from '../../engine/index.js';
import { parseVox, buildVoxelModel, usedPaletteEntries } from '../voxParse.js';
import { autoMapColors } from '../voxAutoMap.js';
import { makeVoxCube } from './voxImportFixture.mjs';
import paletteMod from '../../design/palette.js';
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
// S8-C-20a: exercise the same parse/map/build/rebind path as the editor,
// including a file that exceeds the old voxel axis/cell limits.
pool.renderer='mesh';
for (const size of [16,40]) {
  const parsed=parseVox(makeVoxCube(size));
  const map=autoMapColors(usedPaletteEntries(parsed.voxels,parsed.palette),paletteMod);
  const def=buildVoxelModel(parsed,map,0.05,null,{parts:false});
  ok(`${size}: imported model validates`,validateVoxelModel(def).errors.length===0);
  ok(`${size}: meshOnly flag`,!!def.meshOnly===(size===40));
  const key=`cube${size}`;
  reg.add('model',key,{name:key,voxel:def});
  ok(`${size}: new runtime model waits for rebind`,!pool.models.has(key));
  pool.bind(reg,table);
  ok(`${size}: mesh renderer packs imported model`,pool.models.has(key));
}
console.log(fail ? `${fail} FAILED` : 'voxImportRebind: all passed');
process.exit(fail ? 1 : 0);
