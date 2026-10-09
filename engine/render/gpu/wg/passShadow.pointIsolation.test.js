// ME-16: sun pass / point pass isolation. The two passes share the caster renderer (+ g.shadowIb via buildShadowList), so the documented order is
// sun.run THEN point.run each frame. The sun pass's draw-sequence FNV hash (same hash as passShadow.sequence.test.js) must equal the
// point-shadows-off frame. RESULT: with an instanced-caster fixture (CPU caster path, gpuCull off) the reverse order is ALSO identical: buildShadowList refills g.shadowIb before every pass, so ordering is NOT required (sun-first stays the documented order, harmless).
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { DrawList, LevelMeshCache, addStructures } from '../../../mesh/DrawList.js';
import { dirFromAzEl } from '../../../core/transform.js';
import { MeshDrawCache } from '../../../mesh/DrawList.js';
import { buildMeshFromTris } from '../../../mesh/gltf.js';
import { InstanceGroups, writeUnitInstance, touchInstances } from '../../../mesh/instances.js';
import { WgShadowPass } from './passShadow.js';
import { WgPointShadowPass } from './passPointShadow.js';

function fakeLevel(name) {
  const legend = { f: { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, start: true } };
  return { name, width: 1, height: 1, legend, sectorAt(x, y) { return (x >= 0 && x < 1 && y >= 0 && y < 1) ? legend.f : null; } };
}
const struct = (i, x, y) => ({ id: `s${i}`, level: fakeLevel(`l${i}`), origin: { x, y, z: 0 }, bbox: { x0: x, y0: y, x1: x + 1, y1: y + 1 }, structSeq: i & 7, packed: { version: 1 } });
const cam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 };
const world = { structures: [struct(0, 0, -20), struct(1, 0, 30), struct(2, 300, 0)], structVersion: 1, terrain: null };
const levelCache = new LevelMeshCache();
const camList = new DrawList(16); camList.begin(); addStructures(camList, world, cam, levelCache, 2000);
// Instanced-caster fixture: a 6-instance kind-9 meshGroup near the torch (0.5,0.5) and inside the sun box. Its casters go through
// buildShadowList -> fillShadowBands -> the shared engine-owned g.shadowIb (the state both passes write).
const instances = new InstanceGroups(); let grp = null;
const unitMesh = buildMeshFromTris([{ p0: [0, 0, 0], p1: [1, 0, 0], p2: [0, 0, 1], normal: [0, -1, 0], matName: 'm', uv0: [0, 0], uv1: [1, 0], uv2: [0, 1] },
  { p0: [1, 0, 0], p1: [1, 0, 1], p2: [0, 0, 1], normal: [0, -1, 0], matName: 'm', uv0: [1, 0], uv1: [1, 1], uv2: [0, 1] }], [{ part: 'p', triStart: 0, triCount: 2 }], 'test/isoTree');
unitMesh.mats = { m: 'm' };
grp = instances.meshGroup(unitMesh, 8);
for (let i = 0; i < 6; i++) writeUnitInstance(grp.ib, i, -2 + i * 1.5, -2 + (i & 1) * 4, 0, i * 30, i + 1, 0);
grp.count = 6; touchInstances(grp.ib);
const raster = { list: camList, levelCache, meshCache: new MeshDrawCache(), strictMatIdFor: () => 5 };
const sun = { on: true, dir: dirFromAzEl(135, 40, new Float64Array(3)) };
const lights = () => {
  const L = { sun, count: 1, on: new Uint8Array(8).fill(1), pos: new Float32Array(32), col: new Float32Array(32).fill(1), defX: new Float32Array(8), defY: new Float32Array(8), defZ: new Float32Array(8), entity: new Uint8Array(8) };
  L.defX[0] = 0.5; L.defY[0] = 0.5; L.defZ[0] = 1.5; L.pos[3] = 8; L.col[0] = 4; return L;
};
const frameP = (L) => ({ _light: L, _cam: cam, _world: world, _table: null, _palette: null, _voxelPool: null, _instances: instances, terrainEnabled: false });

/** One frame in the given order; returns the FNV hash of the SUN pass's draws only (point-pass draws are not mixed in). */
function runFrame(order) {
  const d = makeMockGpuDevice().device;
  let h = 0x811c9dc5 | 0, rec = false, sh = null;
  const mix = (v) => { h = Math.imul(h ^ (v | 0), 0x01000193); };
  d.beginPass = (t, o) => { if (rec) { mix(0xb0); mix(o && o.clear ? 1 : 0); mix(t === sh.target ? 7 : 9); } };
  d.draw = (count, first, instances) => {
    if (!rec) return;
    mix(sh.pipes.indexOf(d._activePipeline)); mix(count); mix(first); mix(instances);
    if (instances) { const n = grp.shadowCount[0] * 16, w = grp.shadowIb[0].u32; for (let i = 0; i < n; i++) mix(w[i]); } // shared g.shadowIb contents at sun draw time
    const u = d._lastBind.uniforms; const w = new Int32Array(u.buffer, u.byteOffset, u.length); for (let i = 0; i < w.length; i++) mix(w[i]);
  };
  sh = new WgShadowPass(d, { shadows: { res: 256 }, gpuCull: false });
  const ps = order === 'sun-only' ? null : new WgPointShadowPass(d, { level: 'medium', casters: sh });
  const p = frameP(lights());
  let sunDraws = 0; const runSun = () => { rec = true; assert.equal(sh.run(p, raster), true); rec = false; sunDraws = sh.draws; }; // sh.draws is a shared per-call counter: read right after the sun pass
  if (order === 'sun-only') runSun();
  else if (order === 'sun-then-point') { runSun(); ps.run(p, raster); assert.ok(ps.stats.faces > 0, 'point pass rendered'); }
  else { ps.run(p, raster); assert.ok(ps.stats.faces > 0); runSun(); }
  const out = { hash: h >>> 0, draws: sunDraws, items: sh.list.count };
  if (ps) ps.dispose(); sh.dispose();
  return out;
}

const off = runFrame('sun-only'), ok = runFrame('sun-then-point');
assert.ok(off.draws >= 2);
assert.ok(grp.shadowCount[0] + grp.shadowCount[1] > 0, 'fixture: instanced casters reached g.shadowIb');
assert.deepEqual(ok, off, 'sun pass identical with point shadows on (documented order: sun first)');
const rev = runFrame('point-then-sun');
// Result (ME-16): shadowIb is rebuilt per pass (sun buildShadowList and the point _build both refill it before drawing), so the sun pass is
// order-independent: point-before-sun gives the SAME sun draw sequence (incl. the g.shadowIb rows read at draw time). The ordering is not required.
assert.deepEqual(rev, off, 'point-before-sun leaves the sun draw sequence unchanged (shadowIb rebuilt per pass; ordering not required)');
console.log('passShadow.pointIsolation.test.js: all checks passed');
