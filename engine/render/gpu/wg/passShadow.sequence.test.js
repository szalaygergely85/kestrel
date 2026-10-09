// ME-16c: the sun pass draw sequence (pass opens, pipelines, counts, first, instances, uniform bytes) is pinned by one FNV hash, so the
// renderCasters refactor (shared with wg/passPointShadow.js) stays byte-identical. Re-pin only on an intended sun-map change.
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { DrawList, LevelMeshCache, addStructures } from '../../../mesh/DrawList.js';
import { dirFromAzEl } from '../../../core/transform.js';
import { WgShadowPass } from './passShadow.js';

const EXPECT = process.env.SEQ_PRINT ? null : 3781722539;
function fakeLevel(name) {
  const legend = { f: { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, start: true } };
  return { name, width: 1, height: 1, legend, sectorAt(x, y) { return (x >= 0 && x < 1 && y >= 0 && y < 1) ? legend.f : null; } };
}
const struct = (i, x, y) => ({ id: `s${i}`, level: fakeLevel(`l${i}`), origin: { x, y, z: 0 }, bbox: { x0: x, y0: y, x1: x + 1, y1: y + 1 }, structSeq: i & 7, packed: { version: 1 } });
const mock = makeMockGpuDevice(), d = mock.device;
let h = 0x811c9dc5 | 0; const mix = (v) => { h = Math.imul(h ^ (v | 0), 0x01000193); };
let sh = null;
d.beginPass = (t, o) => { mix(0xb0); mix(o && o.clear ? 1 : 0); mix(t === sh.target ? 7 : 9); };
d.draw = (count, first, instances) => {
  mix(sh.pipes.indexOf(d._activePipeline)); mix(count); mix(first); mix(instances);
  const u = d._lastBind.uniforms; const w = new Int32Array(u.buffer, u.byteOffset, u.length); for (let i = 0; i < w.length; i++) mix(w[i]);
};
sh = new WgShadowPass(d, { shadows: { res: 256 } });
const cam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 };
const world = { structures: [struct(0, 0, -20), struct(1, 0, 30), struct(2, 300, 0)], structVersion: 1, terrain: null };
const levelCache = new LevelMeshCache();
const camList = new DrawList(16); camList.begin(); addStructures(camList, world, cam, levelCache, 2000);
const raster = { list: camList, levelCache, meshCache: null, strictMatIdFor: null };
const sun = { on: true, dir: dirFromAzEl(135, 40, new Float64Array(3)) };
const p = { _light: { sun }, _cam: cam, _world: world, _table: null, _palette: null, _voxelPool: null, _instances: null, terrainEnabled: false };
assert.equal(sh.run(p, raster), true);
assert.ok(sh.draws >= 2);
const got = h >>> 0;
if (EXPECT === null) console.log('SEQ', got);
else assert.equal(got, EXPECT, 'sun draw sequence changed');
sh.dispose();
console.log('passShadow.sequence.test.js: all checks passed');
