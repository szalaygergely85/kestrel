// engine/mesh/pointShadowJS.test.js (ME-16f, note 38.22): JS twin of the point-light shadow pass.
// Run: node engine/mesh/pointShadowJS.test.js   (node --expose-gc ... also checks steady-state heap)
import { DRAW_STATIC } from './DrawList.js';
import { StaticMeshBuilder, packFlat1, AO_NONE } from './MeshData.js';
import { KIND_FLOOR, FACE_U } from '../render/GBuffer.js';
import { createPointShadowTwin, updatePointShadowTwin } from './pointShadowJS.js';
import { resolvePointShadowOptions, pointDepthEncode, pointShadowTaps, createShadowLightState, selectShadowLights } from '../render/shadowPoint.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function quad(id, p12) {
  const b = new StaticMeshBuilder(id);
  b.addQuad(p12, [0, 0, 1, 0, 1, 1, 0, 1], 0, 0, 1, 0, packFlat1(KIND_FLOOR, FACE_U, b.matIndex('floor')), [0, AO_NONE, 0, 0, 0, 0, 0, 0]);
  return b.build();
}
const wall = quad('wallX3', [3, -2, -2, 3, 2, -2, 3, 2, 2, 3, -2, 2]); // plane x = 3, y,z in [-2,2]
let casters = 0;
const build = (list) => { list.begin(); list.push(wall, DRAW_STATIC).rangeCount = wall.triCount; casters++; };

const mkLights = (pos) => { // pos: [[x,y,z,r,intensity], ...]
  const n = pos.length, L = { count: n, on: new Uint8Array(n).fill(1), pos: new Float32Array(n * 4), col: new Float32Array(n * 4), defX: new Float32Array(n), defY: new Float32Array(n), defZ: new Float32Array(n), entity: new Uint8Array(n) };
  pos.forEach((p, i) => { L.pos.set([p[0], p[1], p[2], p[3]], i * 4); L.col.set([p[4], p[4], p[4], 1], i * 4); L.defX[i] = p[0]; L.defY[i] = p[1]; L.defZ[i] = p[2]; });
  return L;
};
const opts = resolvePointShadowOptions({ n: 2, res: 64 }, 'low');
const cam = { x: 0, y: 0, z: 0 };

{ // known box at a known texel
  const tw = createPointShadowTwin(), L = mkLights([[0, 0, 0, 10, 1]]);
  const st = updatePointShadowTwin(tw, L, cam, opts, build);
  ok('state published, light 0 -> slot 1', st && st.slot[0] === 1 && st.res === 64 && st.O[3] === 10 && st.opts === opts);
  const res = 64, at = (face, tx, ty) => st.depth[(0 * 6 + face) * res * res + ty * res + tx];
  const want = Math.fround(pointDepthEncode(3, 10));
  ok('+X face centre texel == encoded depth of the wall at 3 m', Math.abs(at(0, 32, 32) - want) < 2e-6, `${at(0, 32, 32)} vs ${want}`);
  ok('+X face corner texel (outside the 4x4 m wall) cleared to 1', at(0, 1, 1) === 1 && at(0, 62, 62) === 1);
  ok('-X face empty (cleared)', at(1, 32, 32) === 1);
  // wall spans |y/x| <= 2/3 -> texels 32 +- 0.667*32 = [10.7, 53.3]
  ok('wall edge: inside 12 hit, outside 8 clear', at(0, 12, 32) < 1 && at(0, 8, 32) === 1);
  const O = [0, 0, 0], N = [-1, 0, 0], P = [3, 0, 0], B = [6, 0, 0];
  ok('receiver on the wall lit (4 taps)', pointShadowTaps(st.depth, 64, 0, O, 10, P, N, opts) === 4);
  ok('receiver behind the wall shadowed (0 taps)', pointShadowTaps(st.depth, 64, 0, O, 10, B, N, opts) === 0);
  ok('receiver beside the wall (y=5) lit', pointShadowTaps(st.depth, 64, 0, O, 10, [6, 5, 0], N, opts) === 4);
}

{ // selection == selectShadowLights; unchanged key -> no re-render, no rebuild effect on depth
  const tw = createPointShadowTwin(), L = mkLights([[0, 0, 0, 10, 1], [0, 8, 0, 10, 0.2], [30, 0, 0, 10, 1], [1, 1, 0, 6, 0.9]]);
  const st = updatePointShadowTwin(tw, L, cam, opts, build);
  const ref = createShadowLightState(), occ = selectShadowLights(L, cam, 2, ref);
  let same = occ === 2;
  for (let s = 0; s < 2; s++) { if (ref.slots[s] < 0 || st.slot[ref.slots[s]] !== s + 1) same = false; }
  let tot = 0; for (let i = 0; i < L.count; i++) if (st.slot[i]) tot++;
  ok('slot map == selectShadowLights top-2', same && tot === 2, Array.from(st.slot.slice(0, 4)).join());
  ok('first call renders both slots', tw.stats.rendered === 2 && tw.stats.skipped === 0);
  const snap = st.depth.slice();
  updatePointShadowTwin(tw, L, cam, opts, build);
  ok('unchanged key: skipped, depth untouched', tw.stats.rendered === 0 && tw.stats.skipped === 2 && st.depth.every((v, i) => v === snap[i]));
  L.defX[0] += 0.004; // flicker-sized jitter < 1/128 m quantum
  updatePointShadowTwin(tw, L, cam, opts, build);
  ok('sub-quantum origin jitter does not re-render', tw.stats.rendered === 0);
  L.defX[0] += 0.5;
  updatePointShadowTwin(tw, L, cam, opts, build);
  ok('moved light re-renders its slot only', tw.stats.rendered === 1);
}

{ // off path + zero alloc steady state
  const tw = createPointShadowTwin(), L = mkLights([[0, 0, 0, 10, 1]]);
  ok('n = 0 -> null (off)', updatePointShadowTwin(tw, L, cam, { ...opts, n: 0 }, build) === null);
  updatePointShadowTwin(tw, L, cam, opts, build);
  if (typeof global.gc === 'function') {
    for (let i = 0; i < 50; i++) updatePointShadowTwin(tw, L, cam, opts, build);
    global.gc(); const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 2000; i++) updatePointShadowTwin(tw, L, cam, opts, build);
    global.gc(); const grew = process.memoryUsage().heapUsed - h0;
    ok('2000 unchanged-key updates: no heap growth', grew < 256 * 1024, `grew ${grew}`);
  } else console.log('(run with --expose-gc for the alloc check)');
}

console.log(`pointShadowJS: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
