// US-068b2 (38.19): host words of the ortho mode. Ortho -> projMode 2 in every raster block (word offsets differ per block; BASE's shares RASTER's
// `origin.x`), terrain block 2; perspective/shear -> 0 (byte-identical to before). Run: node engine/render/gpu/wg/passRaster.ortho.test.js
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { StaticMeshBuilder } from '../../../mesh/MeshData.js';
import { DRAW_STATIC, DRAW_VOXEL, DRAW_INSTANCED, DRAW_CLOTH } from '../../../mesh/DrawList.js';
import { WgRasterPass } from './passRaster.js';
import { RASTER_BLOCK, RASTER_BASE_BLOCK, RASTER_MASK_BLOCK, RASTER_INSTANCED_MASK_BLOCK } from '../wgsl/raster.wgsl.js';

const mock = makeMockGpuDevice(), d = mock.device;
const pass = new WgRasterPass(d), draws = [];
d.beginPass = () => {};
d.draw = (count, first, instances) => draws.push({ cloth: pass.clothPipe === d._activePipeline, pipe: pass.instancePipe === d._activePipeline ? 'inst' : 'base', u: new Uint32Array(d._lastBind.uniforms.buffer, 0, d._lastBind.uniforms.length).slice() });
const b = new StaticMeshBuilder('q');
b.addQuad([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], 0, 0, 1, 0xf0000001, 9 | (5 << 8) | (3 << 16), [0, 0, 0, 0, 0, 0, 0, 0]);
const mesh = b.build(); mesh.ranges = [{ start: 0, count: 2 }];
const si = pass.list.push(); si.type = DRAW_STATIC; si.mesh = mesh; si.rangeCount = 2; si.matrix.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 4, 5, 6]);
const ii = pass.list.push(); ii.type = DRAW_INSTANCED; ii.mesh = mesh; ii.instBuf = { f32: new Float32Array(32) }; ii.instCount = 2; ii.partMatrices.set(si.matrix); ii.partFlags[0] = 1;
const P_BASE = RASTER_BASE_BLOCK.field('projMode').word, P_RASTER = RASTER_BLOCK.field('projMode').word, ORIGIN = RASTER_BLOCK.field('origin').word;
const ci = pass.list.push(); ci.type = DRAW_CLOTH; ci.mesh = { id: 'cl', matId: 3 }; ci.rangeCount = 2; ci.rangeFirst = 0; ci.matrix.set(si.matrix);
pass.buffers.getCloth = () => ({ vertexBuffer: {}, uvBuffer: {}, indexBuffer: {} });
// 068b2 fix: projMode is ONE shared prefix word in every raster block (no per-block overlap with origin.x)
for (const B of [RASTER_BASE_BLOCK, RASTER_MASK_BLOCK, RASTER_INSTANCED_MASK_BLOCK]) assert.equal(B.field('projMode').word, RASTER_BLOCK.field('projMode').word);
const p = { _t: { targetRaster: {}, targetVmDepth: {} }, stats: {} };
pass.prepare = () => {};

for (const [name, mode] of [['persp', 0], ['ortho', 2]]) {
  pass.ortho = mode === 2; pass.ox = 32; pass.oy = 48; pass.u[ORIGIN] = 32; pass.bits[P_RASTER] = mode;
  draws.length = 0; pass.run(p);
  const base = draws.find(x => x.pipe === 'base'), inst = draws.find(x => x.pipe === 'inst');
  assert.equal(base.u[P_BASE], mode, `${name}: BASE projMode`);
  assert.equal(inst.u[P_RASTER], mode, `${name}: RASTER projMode`);
  assert.equal(new Float32Array(inst.u.buffer)[ORIGIN], 32, `${name}: instanced origin.x intact`);
  assert.ok(draws.length >= 3, `${name}: base + instanced + cloth draws issued (${draws.length})`);
  for (const x of draws) assert.equal(x.u[P_RASTER], mode, `${name}: every draw (${x.pipe}) carries projMode ${mode}`);
  assert.equal(draws.filter(x => x.cloth).length, 1, `${name}: the cloth draw ran`);
}
// real prepare(): projMode + pitch terms (halfW/halfH in the tanHalf slots)
const real = new WgRasterPass(d);
const mk = (projection) => ({ _cam: { x: 10, y: 20, z: 30, yawDeg: 45, pitchDeg: -35.264, projection, orthoHalfH: 8, focusX: 10, focusY: 20, focusZ: 0 }, _world: { terrain: null, structures: [], wind: null }, cols: 80, rows: 30, rt: { pxCellW: 1, pxCellH: 2 }, terrainEnabled: false, _fb: { timeSec: 0 }, _instances: null, _voxelPool: null, _viewModel: null, stats: {} });
for (const [proj, mode] of [['ortho', 2], ['pitched', 1], ['shear', 0]]) {
  real.prepare(mk(proj));
  assert.equal(real.projMode, mode, proj + ' projMode'); assert.equal(real.ortho, mode === 2); assert.equal(real.pitched, mode > 0);
  assert.equal(real.bits[P_RASTER], mode === 2 ? 2 : 0);
  if (mode === 2) { assert.equal(real.pitch.halfH, 8); assert.equal(real.pitch.tanHalfY, 8); assert.ok(Math.abs(real.pitch.tanHalfX - real.pitch.halfW) < 1e-12); }
}

// S8-B2-10c: with occlusion ON the cull kernel gets the camera eye (world space), not null (occNear measures depth from it)
{
  const oc = new WgRasterPass(d, { occl: true }); let got = null;
  oc.cull.begin = (f) => { got = f.eye; }; oc.cull.add = () => ({}); oc.cull.run = () => {};
  oc.gpuN = 1; oc.gpuGroups[0] = {}; oc.gpuM0[0] = null; oc.gpuM1[0] = null; oc.view.fill(0);
  oc._cullRun({ rows: 30, _cam: { x: 12.5, y: -3, z: 1.7 }, _t: { subCols: 8, subRows: 8 } });
  assert.deepEqual({ ...got }, { x: 12.5, y: -3, z: 1.7 }, 'cull eye = camera eye');
}
console.log('passRaster.ortho.test: OK');
