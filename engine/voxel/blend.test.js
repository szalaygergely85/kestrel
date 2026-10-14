// engine/voxel/blend.test.js - ANIM-BLEND-01a (architecture.md 38.68): def.blend validator + pack, pose layers (inst.layers).
//   node --expose-gc engine/voxel/blend.test.js
import { allocProbe } from '../../tools/allocProbe.mjs';
import { createRequire } from 'node:module';
import { validateVoxelModel, MAX_VOX_PARTS, PART_STRIDE } from './VoxelModel.js';
import { packVoxelModel } from './voxelPack.js';
import { computeVoxelPose, FORWARD } from './voxelPose.js';
import { VoxelPool } from '../render/voxelPool.js';
import quadruped12 from './fixtures/quadruped12.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const req = createRequire(import.meta.url);
const boar = req('../../design/models/voxel_beast.js').boarPlaceholder;
const bear = req('../../design/models/voxel_bear.js').bear;
const out = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
const snap = (pm, inst) => { computeVoxelPose(pm, inst, out); return [Float64Array.from(FORWARD.subarray(0, pm.partCount * 12)), Float64Array.from(out.subarray(0, pm.partCount * PART_STRIDE))]; };
const same = (a, b) => a[0].every((v, i) => Object.is(v, b[0][i])) && a[1].every((v, i) => Object.is(v, b[1][i]));
const near = (a, b, e = 1e-9) => a[0].every((v, i) => Math.abs(v - b[0][i]) < e) && a[1].every((v, i) => Math.abs(v - b[1][i]) < e);
const base = (extra) => Object.assign({ x: 1, y: 2, z: 3, yawDeg: 20, clip: -1, frame: 0, tMs: 0, scale: 1 }, extra);
// AnimLayers: [on, clip,frame,tMs, clip2,frame2,tMs2, w2, fClip,fFrame,fTMs, fClip2,fFrame2,fTMs2, fW2, fromW, addIdx,addFrame,addTMs,addW]
const layers = (o = {}) => Float64Array.from([1, o.c ?? -1, o.f ?? 0, o.t ?? 0, o.c2 ?? -1, o.f2 ?? 0, o.t2 ?? 0, o.w2 ?? 0,
  o.fc ?? -1, o.ff ?? 0, o.ft ?? 0, o.fc2 ?? -1, o.ff2 ?? 0, o.ft2 ?? 0, o.fw2 ?? 0, o.fromW ?? 0, o.ai ?? -1, o.af ?? 0, o.at ?? 0, o.aw ?? 0]);

// ---- 1. shipped models: layers null / absent / "plain" are byte-identical to the clip fields ----
for (const [name, def] of [['boar', boar.voxel || boar], ['bear', bear.voxel || bear], ['dummy', quadruped12]]) {
  const pm = packVoxelModel(def, () => 1);
  ok(`${name}: pm.blend is null without def.blend`, pm.blend === null);
  let allSame = true;
  for (let c = 0; c < pm.clips.length; c++) {
    for (const f of [0, pm.clips[c].n - 1]) {
      const ref = snap(pm, base({ clip: c, frame: f, tMs: 17 }));
      allSame = allSame && same(ref, snap(pm, base({ clip: c, frame: f, tMs: 17, layers: null })))
        && same(ref, snap(pm, base({ clip: c, frame: f, tMs: 17, layers: Float64Array.from(layers({ c, f, t: 17 }).fill(0, 0, 1)) })))
        && same(ref, snap(pm, base({ clip: c, frame: f, tMs: 17, layers: layers({ c, f, t: 17 }) })));
    }
  }
  ok(`${name}: null / off / plain-source layers are byte-identical to the clip fields`, allSame);
}

// ---- 2. synthetic model: lerp maths against a reference clip ----
const R = (a, b, c) => ({ rot: [a, b, c] });
const synth = () => {
  const d = JSON.parse(JSON.stringify(quadruped12));
  const one = (hr, br, bp) => ({ durations: [100], loop: true, frames: [{ head: { rot: hr }, legFL: { rot: [br, 0, 0] }, body: { pos: bp } }] });
  d.animations = {
    A: one([10, 20, 30], 40, [0, 0, 1]),
    B: one([-30, 50, 0], -20, [1, 0, 0]),
    F: one([5, -5, 15], 10, [0, 2, 0]),
    C: one([10 + (-30 - 10) * 0.3, 20 + (50 - 20) * 0.3, 30 + (0 - 30) * 0.3], 40 + (-20 - 40) * 0.3, [0.3, 0, 0.7]),
    D: one([0, 0, 0], 0, [0, 0, 0]),
    H: { durations: [100, 100], loop: false, frames: [{ head: { rot: [4, 0, 0] }, legFR: { rot: [3, 0, 0] } }, { head: { rot: [24, 8, 0] }, legFR: { rot: [30, 0, 0] }, body: { pos: [0, 0, 2] } }] },
  };
  return d;
};
{
  const d = synth();
  const pm = packVoxelModel(d, () => 1);
  const ci = pm.clipIndex;
  // w2: layers A->B @ 0.3 equals the reference clip C
  ok('w2 0.3 equals the reference lerp clip', near(snap(pm, base({ clip: ci.C })), snap(pm, base({ layers: layers({ c: ci.A, c2: ci.B, w2: 0.3 }) }))));
  ok('w2 0 equals clip A exactly', same(snap(pm, base({ clip: ci.A })), snap(pm, base({ layers: layers({ c: ci.A, c2: ci.B, w2: 0 }) }))));
  ok('w2 1 equals clip B', near(snap(pm, base({ clip: ci.B })), snap(pm, base({ layers: layers({ c: ci.A, c2: ci.B, w2: 1 }) }))));
  // fromW: current A, from F at 0.3 equals the old-style crossfade, and equals the layered version
  const old = snap(pm, base({ clip: ci.A, fromClip: ci.F, fromFrame: 0, fromTMs: 0, fromW: 0.3 }));
  ok('fromW 0.3 layered equals the WILD-01 crossfade', near(old, snap(pm, base({ layers: layers({ c: ci.A, fc: ci.F, fromW: 0.3 }) }))));
  ok('fromW 0 ignores the from source', same(snap(pm, base({ clip: ci.A })), snap(pm, base({ layers: layers({ c: ci.A, fc: ci.F, fromW: 0 }) }))));
  // from source is itself a blend: (A..B @0.3) as the from pose at fromW 1 equals clip C
  ok('from source with fW2 = parameter blend', near(snap(pm, base({ clip: ci.C })), snap(pm, base({ layers: layers({ c: ci.D, fc: ci.A, fc2: ci.B, fw2: 0.3, fromW: 1 }) }))));
  ok('fromW 1 + w2 mix is the lerp of two blended sources', near(snap(pm, base({ clip: ci.C })), snap(pm, base({ layers: layers({ c: ci.A, c2: ci.B, w2: 0.3, fc: ci.F, fromW: 0 }) }))));
}

// ---- 3. additive: delta at frame 0 = 0, mask, maths vs reference ----
{
  const d = synth();
  d.blend = { sets: { walk: { param: 'speed', clips: [{ clip: 'A', at: 0.5 }, { clip: 'B', at: 2 }] } }, fades: { default: 120, into: { A: 60 }, pairs: { 'A>B': 200 } },
    additive: { hit: { clip: 'H', parts: ['head'], inMs: 40, outMs: 160, gain: 0.5 } } };
  ok('blend def validates', validateVoxelModel(d).errors.length === 0, validateVoxelModel(d).errors.join('|'));
  const pm = packVoxelModel(d, () => 1);
  const b = pm.blend, ci = pm.clipIndex;
  ok('pack: tables', b.setNames[0] === 'walk' && b.setClip[0] === ci.A && b.setClip[1] === ci.B && b.setAt[1] === 2 && b.setOf[ci.A] === 0 && b.setOf[ci.D] === -1
    && b.fadeDefault === 120 && b.fadeInto[ci.A] === 60 && b.fadeInto[ci.B] === 0xFFFF && b.fadePair[ci.A * pm.clips.length + ci.B] === 200);
  ok('pack: additive mask / gain / timing', b.addMask[0] === (1 << pm.partIndex.head) && b.addGain[0] === 0.5 && b.addIn[0] === 40 && b.addOut[0] === 160);
  const dk = b.addClips[0].keys, st = pm.partCount * 6;
  ok('delta keys at frame 0 are exactly 0', dk.subarray(0, st).every((v) => v === 0));
  const baseS = snap(pm, base({ layers: layers({ c: ci.A }) }));
  ok('additive at frame 0 adds exactly 0 (byte-identical)', same(baseS, snap(pm, base({ layers: layers({ c: ci.A, ai: 0, af: 0, at: 0, aw: 1 }) }))));
  ok('addW 0 is byte-identical', same(baseS, snap(pm, base({ layers: layers({ c: ci.A, ai: 0, af: 1, at: 0, aw: 0 }) }))));
  // reference: clip E = A + w * (H1 - H0) on head/body only (legFR is NOT in the mask)
  const w = 0.75, e = JSON.parse(JSON.stringify(synth()));
  e.animations.E = { durations: [100], loop: true, frames: [{ head: { rot: [10 + w * 20, 20 + w * 8, 30] }, legFL: { rot: [40, 0, 0] }, body: { pos: [0, 0, 1] } }] };
  const pe = packVoxelModel(e, () => 1);
  ok('additive w 0.75 at frame 1 equals the reference clip (mask = head only)', near(snap(pe, base({ clip: pe.clipIndex.E })), snap(pm, base({ layers: layers({ c: ci.A, ai: 0, af: 1, at: 0, aw: w }) }))));
  // mask: an unmasked part (legFR) is unchanged
  const withAdd = snap(pm, base({ layers: layers({ c: ci.A, ai: 0, af: 1, at: 0, aw: 1 }) }));
  const k = pm.partIndex.legFR, kb = pm.partIndex.body;
  ok('mask: unmasked parts (legFR, body) unchanged', [k, kb].every((q) => withAdd[0].subarray(q * 12, q * 12 + 12).every((v, i) => Object.is(v, baseS[0][q * 12 + i]))));
  ok('mask: masked part transform changed', !withAdd[0].subarray(pm.partIndex.head * 12, pm.partIndex.head * 12 + 12).every((v, i) => Object.is(v, baseS[0][pm.partIndex.head * 12 + i])));
  // validator errors
  const bad = (mut) => { const x = JSON.parse(JSON.stringify(d)); mut(x.blend); return validateVoxelModel(x).errors; };
  ok('validator: unknown key', bad((x) => { x.nope = 1; }).length > 0);
  ok('validator: non-increasing at', bad((x) => { x.sets.walk.clips[1].at = 0.5; }).length > 0);
  ok('validator: 1-clip set', bad((x) => { x.sets.walk.clips.pop(); }).length > 0);
  ok('validator: non-looping set clip', bad((x) => { x.sets.walk.clips[0].clip = 'H'; }).length > 0);
  ok('validator: looping additive clip', bad((x) => { x.additive.hit.clip = 'A'; }).length > 0);
  ok('validator: fade ms > 400', bad((x) => { x.fades.default = 500; }).length > 0);
  ok('validator: bad pair key', bad((x) => { x.fades.pairs = { 'A>Z': 100 }; }).length > 0);
  ok('validator: unknown additive part', bad((x) => { x.additive.hit.parts = ['tail']; }).length > 0);
  ok('validator: clip in two sets', bad((x) => { x.sets.run = { param: 'speed', clips: [{ clip: 'A', at: 1 }, { clip: 'F', at: 2 }] }; }).length > 0);
  // legRig upper/lower part in an additive mask is an error
  const lg = JSON.parse(JSON.stringify(d));
  lg.legRig = { body: 'body', legs: [{ upper: 'legFL', lower: 'legFR', foot: [3, 3, 0] }, { upper: 'legBL', lower: 'legBR', foot: [3, 6, 0] }], gaits: {} };
  lg.blend.additive.hit.parts = ['head', 'legFL'];
  ok('validator: additive on a legRig part', validateVoxelModel(lg).errors.some((s) => s.indexOf('legRig') >= 0));
}

// ---- 4. RIG-00 rigged fixture works (same pack/validate path) ----
{
  const parts = { root: { box: [0, 0, 0, 2, 2, 2], pivot: [1, 1, 0] }, arm: { box: [2, 0, 0, 3, 2, 2], pivot: [2, 1, 1], parent: 'root' } };
  const rigDef = (blend) => ({ version: 1, cellM: 0.1, size: [4, 2, 2], anchor: [1, 1, 0], parts,
    rig: { quads: 2, ranges: [{ start: 0, count: 1 }, { start: 1, count: 1 }], pos: new Float32Array(24), nrm: new Float32Array(24), mat: new Uint8Array([1, 1]), matKeys: ['m'] },
    animations: { idle: { durations: [100], loop: true, frames: [{ arm: { rot: [0, 0, 0] } }] }, walk: { durations: [100], loop: true, frames: [{ arm: { rot: [30, 0, 0] } }] },
      hit: { durations: [50, 50], loop: false, frames: [{ arm: { rot: [0, 0, 0] } }, { arm: { rot: [20, 0, 0] }, root: { pos: [0, 0, 1] } }] } },
    ...(blend ? { blend } : {}) });
  const pm0 = packVoxelModel(rigDef(null), () => 1);
  ok('rigged: pm.blend null without def.blend', pm0.blend === null && !!pm0.rig);
  const pm = packVoxelModel(rigDef({ sets: { g: { param: 'speed', clips: [{ clip: 'idle', at: 0 }, { clip: 'walk', at: 1 }] } }, additive: { hit: { clip: 'hit', parts: ['arm'], inMs: 30, outMs: 90 } } }), () => 1);
  const ci = pm.clipIndex;
  ok('rigged: blend packed', !!pm.blend && pm.blend.addMask[0] === 2 && pm.blend.setClip.length === 2);
  const pw = snap(pm, base({ clip: ci.walk })), mid = snap(pm, base({ layers: layers({ c: ci.idle, c2: ci.walk, w2: 1 }) }));
  ok('rigged: w2 1 equals walk', near(pw, mid));
  ok('rigged: additive (mask arm only) moves arm not root', (() => { const a = snap(pm, base({ layers: layers({ c: ci.idle, ai: 0, af: 1, aw: 1 }) })); return !same(a, snap(pm, base({ layers: layers({ c: ci.idle }) }))) && a[0].subarray(0, 12).every((v, i) => Object.is(v, snap(pm, base({ layers: layers({ c: ci.idle }) }))[0][i])); })());
  let msg = '';
  try { packVoxelModel(rigDef({ sets: { g: { param: 'speed', clips: [{ clip: 'idle', at: 1 }, { clip: 'walk', at: 0 }] } } }), () => 1); } catch (e) { msg = e.message; }
  ok('rigged: invalid blend throws', msg.indexOf('increasing') >= 0, msg);
}

// ---- 5. pool: components.voxel.animLayers + layerInstance, both projection copies ----
{
  const d = synth();
  const registry = { keys: (k) => (k === 'model' ? ['synth'] : []), model: () => ({ voxel: d }) };
  const pool = new VoxelPool();
  pool.bind(registry, { idFor: () => 1 });
  const pm = pool.models.get('synth'), ci = pm.clipIndex;
  const L = layers({ c: ci.A, c2: ci.B, w2: 0.3 });
  const ent = { id: 7, transform: { x: 1, y: 2, z: 3, yawDeg: 20, scale: 1 }, components: { voxel: { model: 'synth', anim: 'D', animLayers: L } } };
  pool._rawCount = 0; pool._queueEntity(ent);
  ok('_queueEntity reads components.voxel.animLayers', pool.raw[0].layers === L);
  pool._rawCount = 0; pool._queueEntity({ ...ent, components: { voxel: { model: 'synth', anim: 'D' } } });
  ok('_queueEntity without animLayers -> layers null (slot reused)', pool.raw[0].layers === null);
  pool._rawCount = 0;
  const i = pool.pushInstance('synth', 1, 2, 3, 20, -1, 0, 0);
  pool.layerInstance(i, L);
  ok('layerInstance sets the slot', pool.raw[i].layers === L);
  const n = pool.projectShadow();
  ok('projectShadow copies layers', n === 1 && pool.shadowList[0].layers === L);
  pool.layerInstance(i, null);
  ok('layerInstance(null) clears', pool.raw[i].layers === null);
  // 0 alloc through the pose + pool path
  if (global.gc) {
    const inst = base({ layers: layers({ c: ci.A, c2: ci.B, w2: 0.4, fc: ci.F, fromW: 0.5, ai: 0, af: 1, aw: 0.6 }) });
    const d2 = JSON.parse(JSON.stringify(d)); d2.blend = { additive: { hit: { clip: 'H', parts: ['head'], inMs: 30, outMs: 90 } } };
    const pm2 = packVoxelModel(d2, () => 1);
    const Lr = inst.layers;
    const run = (n2) => { for (let k = 0; k < n2; k++) { Lr[7] = (k & 7) / 8; Lr[15] = (k & 3) / 4; Lr[19] = (k & 1) * 0.5; computeVoxelPose(pm2, inst, out); } };
    const r = allocProbe(run, { n: 20000 });
    ok('layered pose: 0 B/call', r.perCall < 1, `${r.perCall} B/call`);
  } else console.log('(run with --expose-gc for the allocation check)');
}

console.log(`blend.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('FAIL ' + f); process.exit(1); }
