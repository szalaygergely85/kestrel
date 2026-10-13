// R6c part 2: card bucket + mesh-side band, the REAL WGSL kernels (cs_card from impostor.wgsl.js, impMeshBits from cull.wgsl.js) evaluated in JS by wgslProbe
// against the CPU twin (instances.js compactGroup, impM > 0), on a seeded instance set; impM = 0 is the old path; WgCardPass host shape on the device mock.
import assert from 'node:assert/strict';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { IMP_CULL_WGSL, IMP_BLOCK } from '../wgsl/impostor.wgsl.js';
import { CULL_WGSL } from '../wgsl/cull.wgsl.js';
import { compileFn } from '../wgsl/wgslProbe.js';
import { InstanceGroups, makeInstanceGroup, compactGroup, createInstanceBuffer, writeUnitInstance, INSTANCE_STRIDE } from '../../../mesh/instances.js';
import { enableGroupImpostor } from '../../../mesh/impostorCard.js';
import { WgCardPass, CARD_ATLAS_MAX_BYTES } from './WgCardPass.js';

let seed = 0x9e3779b9;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const V4 = (x = 0, y = 0, z = 0, w = 0) => ({ x, y, z, w });

const N = 1500, impM = 50, maxDist = 400, eye = { x: 7, y: -3, z: 2 };
const imp = { bytes: new Uint8Array(1344 * 8 * 8), radius: 4, vMin: -1, vMax: 11 };
const g = makeInstanceGroup('t', N);
enableGroupImpostor(g, imp, impM, createInstanceBuffer);
g.maxDistM = maxDist; g.count = N;
for (let i = 0; i < N; i++) writeUnitInstance(g.ib, i, (rnd() - 0.5) * 900, (rnd() - 0.5) * 900, rnd() * 30, 0, 1000 + i, 0);
const srcU = g.ib.u32, srcF = g.ib.f32;
const flagsOf = new Map(); for (let i = 0; i < N; i++) flagsOf.set(srcU[i * INSTANCE_STRIDE + 12], srcU[i * INSTANCE_STRIDE + 13]);
compactGroup(g, null, 5, null, 0, 0, eye); // CPU oracle: cards -> g.cardIb, meshes (lodCells 0) -> g.drawIb[0]

// ---- cs_card (the real kernel text) == the CPU card bucket: count, set, flags
const nonePlanes = [0, 1, 2, 3, 4, 5].map(() => V4(0, 0, 0, 1));
const cardU = { planes: nonePlanes, eye: V4(eye.x, eye.y, eye.z, maxDist * maxDist), params: V4(5), imp: V4(impM, imp.radius, imp.vMin, imp.vMax), count: N, slot: 0, swayPad: 0 };
const cardDst = new Uint32Array(N * INSTANCE_STRIDE), cardArgs = new Uint32Array(5);
{
  const code = IMP_CULL_WGSL.replace(/atomicAdd\(&args\[([^\]]+)\], 1u\)/g, 'atomicAdd(args, $1, 1u)');
  const ctx = { u: cardU, src: srcU, dst: cardDst, args: cardArgs, STRIDE: INSTANCE_STRIDE, IMP_BAND_M: 8, atomicAdd: (a, i, v) => { const o = a[i]; a[i] = o + v; return o; } };
  const fns = {};
  for (const n of ['aabbOutside', 'impBandBits']) fns[n] = compileFn(code, n, { ...ctx, ...fns });
  const cs = compileFn(code, 'cs_card', { ...ctx, ...fns });
  for (let i = 0; i < N; i++) cs({ x: i });
}
assert.ok(g.cardCount > 200, 'fixture has cards: ' + g.cardCount);
assert.equal(cardArgs[1], g.cardCount, 'LOD-3 (card) count == compactGroup card bucket');
{
  const want = new Map(), got = new Map();
  for (let i = 0; i < g.cardCount; i++) want.set(g.cardIb.u32[i * INSTANCE_STRIDE + 12], g.cardIb.u32[i * INSTANCE_STRIDE + 13]);
  for (let i = 0; i < cardArgs[1]; i++) got.set(cardDst[i * INSTANCE_STRIDE + 12], cardDst[i * INSTANCE_STRIDE + 13]);
  assert.equal(got.size, want.size);
  let band = 0;
  for (const [k, v] of want) { assert.equal(got.get(k), v, 'card flags ' + k); if (v !== flagsOf.get(k)) band++; }
  assert.ok(band > 5, 'fixture has band instances: ' + band);
}

// ---- mesh side (impMeshBits of cull.wgsl.js) == the CPU mesh bucket; impM = 0 -> 0 for every row (old path)
{
  const meshU = { impM, eye: V4(eye.x, eye.y, eye.z, maxDist * maxDist) };
  const bits = compileFn(CULL_WGSL, 'impMeshBits', { u: meshU, src: srcU, IMP_BAND_M: 8 });
  const bits0 = compileFn(CULL_WGSL, 'impMeshBits', { u: { ...meshU, impM: 0 }, src: srcU, IMP_BAND_M: 8 });
  const want = new Map(); for (let i = 0; i < g.drawCount[0]; i++) want.set(g.drawIb[0].u32[i * INSTANCE_STRIDE + 12], g.drawIb[0].u32[i * INSTANCE_STRIDE + 13]);
  const md2 = maxDist * maxDist; let kept = 0, dropped = 0, banded = 0;
  for (let i = 0; i < N; i++) {
    const o = i * INSTANCE_STRIDE, dx = srcF[o + 3] - eye.x, dy = srcF[o + 7] - eye.y, dz = srcF[o + 11] - eye.z;
    assert.equal(bits0(o), 0, 'impM = 0: no change');
    if (dx * dx + dy * dy + dz * dz > md2) continue; // distance cut runs first (both kernels)
    const id = srcU[o + 12], mb = bits(o);
    if (mb === 0xFFFFFFFF) { dropped++; assert.ok(!want.has(id), 'card only: no mesh copy ' + id); continue; }
    kept++; if (mb) banded++;
    assert.equal((srcU[o + 13] | mb) >>> 0, want.get(id), 'mesh flags ' + id);
  }
  assert.equal(kept, g.drawCount[0], 'mesh count == compactGroup');
  assert.ok(dropped > 100 && banded > 5, `fixture covers drop/band: ${dropped}/${banded}`);
}

// ---- WgCardPass host shape (device mock): guard, species slot/atlas, one dispatch + one drawIndirect per species, off = nothing
{
  const mock = makeMockGpuDevice(), d = mock.device;
  const calls = []; d.dispatch = (p, desc) => calls.push(['dispatch', desc.uniforms.length]); d.drawIndirect = (b, o) => calls.push(['drawIndirect', o]);
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  const argsBuffer = d.createBuffer({ usage: 'indirect', bytes: 4096 });
  let next = 10;
  const cull = { argsBuffer, argsCpu: new Uint32Array(1024), _allocSlots: () => next++, batches: new Map([[g, { cap: N, src: d.createBuffer({ usage: 'storage', bytes: 64 }) }]]), frame: { planes: null, eye, maxDistM: 0 } };
  const off = new WgCardPass(Object.assign(Object.create(d), { caps: { maxStorageBuffersInVertexStage: 0 } }), cull);
  assert.equal(off.on, false); assert.equal(warned, 1, 'guard logs once');
  assert.equal(off.ensure(g), null); assert.equal(g._cardOk, false);
  const pass = new WgCardPass(d, cull);
  assert.equal(pass.on, true);
  const sp = pass.ensure(g);
  assert.ok(sp && g._cardOk === true && sp.slot === 10 && cull.argsCpu[50] === 6, 'species slot + vertexCount 6');
  const fr = { w: 100, h: 50, ox: 0, oy: 0, viewRel: new Float32Array(16), vaoOn: false };
  pass.dispatch([g], 1, fr);
  assert.equal(pass.draw(), 1);
  assert.deepEqual(calls.map((c) => c[0]), ['dispatch', 'drawIndirect']);
  assert.equal(calls[1][1], 10 * 20, 'drawIndirect at the species record');
  assert.equal(calls[0][1] * 4, IMP_BLOCK.sizeBytes);
  assert.equal(sp.uu[IMP_BLOCK.field('atlasBase').word], 0);
  // an oversized atlas is skipped (+ logged) and the group falls back to the mesh cut
  const g2 = makeInstanceGroup('big', 4); enableGroupImpostor(g2, { bytes: new Uint8Array(CARD_ATLAS_MAX_BYTES), radius: 1, vMin: 0, vMax: 1 }, 40, createInstanceBuffer);
  assert.equal(pass.ensure(g2), null); assert.equal(g2._cardOk, false);
  // a group without imp / impM = 0 never registers
  const g3 = makeInstanceGroup('plain', 4); assert.equal(pass.ensure(g3), null);
  // atlas ranges: one per bake
  {
    const wb = []; const dw = d.writeBuffer; d.writeBuffer = (b, data, off, n) => wb.push([off, n]);
    const used = pass.atlasUsed, base0 = sp.baseBytes;
    sp.bytes = null; pass.ensure(g); // same bake re-upload: same range, no new space, no rewrite
    assert.equal(sp.baseBytes, base0); assert.equal(pass.atlasUsed, used); assert.equal(wb.length, 0);
    const nb = new Uint8Array(1344 * 8 * 4); g.imp.bytes = nb; pass.ensure(g); // different-size re-bake: new range
    assert.equal(sp.baseBytes, used); assert.equal(pass.atlasUsed, used + nb.byteLength); assert.deepEqual(wb[0], [used, nb.byteLength]);
    // a dropped + re-created group (same bake) reuses its range: no atlas growth
    const usedNow = pass.atlasUsed; pass._drop(g); const sp2 = pass.ensure(g);
    assert.equal(pass.atlasUsed, usedNow); assert.equal(sp2.baseBytes, used);
    // over the cap: re-bake skipped (kept old range), not retried every frame
    g.imp.bytes = new Uint8Array(CARD_ATLAS_MAX_BYTES); const wn = wb.length; pass.ensure(g); pass.ensure(g);
    assert.equal(sp2.baseBytes, used); assert.equal(wb.length, wn); assert.equal(pass.atlasUsed, usedNow);
    d.writeBuffer = dw;
  }
  console.warn = warn;
}
// ---- R6e: 10 band swaps x 3 species -> GPU buffer count constant, destroyed only on final removal; JS cardIb pool does not leak
{
  const mock = makeMockGpuDevice(), d = mock.device; const set = new Set(); let created = 0, live = 0;
  const cb = d.createBuffer.bind(d), db = d.dispose.bind(d);
  d.createBuffer = (o) => { const b = cb(o); set.add(b); live = set.size; created++; return b; }; d.dispose = (b) => { set.delete(b); live = set.size; return db(b); };
  const cull = { argsBuffer: d.createBuffer({ usage: 'indirect', bytes: 4096 }), argsCpu: new Uint32Array(1024), _allocSlots: () => next++, batches: new Map(), frame: { planes: null, eye, maxDistM: 0 } };
  let next = 20;
  const pass = new WgCardPass(d, cull);
  const baked = [0, 1, 2].map(() => new Uint8Array(1344 * 8));
  const mk = (k) => ({ ib: { capacity: 16 }, imp: { bytes: baked[k], radius: 1, vMin: 0, vMax: 2 }, impM: 40, count: 0, maxDistM: 0 });
  let gs = [0, 1, 2].map(mk); gs.forEach((g) => pass.ensure(g));
  const base = live, slots0 = next;
  for (let swap = 0; swap < 10; swap++) { gs.forEach((g) => pass._drop(g)); gs = [0, 1, 2].map(mk); gs.forEach((g) => assert.ok(pass.ensure(g))); assert.equal(live, base, 'no buffer growth at swap ' + swap); }
  assert.equal(next, slots0, 'args slots reused'); assert.equal(created, base, 'no createBuffer after the first build');
  pass.dispose(); assert.equal(live, 1, 'only the test-owned args buffer is left after final removal (dst + atlas + pipelines destroyed)');
}
{
  const groups = new InstanceGroups(); let made = 0;
  const create = (c) => { made++; return createInstanceBuffer(c); };
  const imp = { bytes: new Uint8Array(8), radius: 1, vMin: 0, vMax: 1 };
  for (let k = 0; k < 10; k++) {
    const gg = [0, 1, 2].map((i) => { const g = makeInstanceGroup('s' + i, 8); groups.groups.push(g); enableGroupImpostor(g, imp, 40, create); return g; });
    gg.forEach((g) => groups.remove(g)); assert.equal(g0(gg), null);
  }
  assert.equal(made, 3, 'cardIb reused across re-created groups (3 species -> 3 buffers total)');
}
function g0(gg) { return gg[0].cardIb; }
console.log('passCull.imp.test.js OK: cs_card count/set/flags == compactGroup card bucket, mesh band bits == compactGroup, impM=0 old path, WgCardPass host shape');
