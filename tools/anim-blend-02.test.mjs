// node tools/anim-blend-02.test.mjs - ANIM-BLEND-02 (architecture.md 38.68 step 02): `blend` blocks + `hitAdd` clips of wolf, boar,
// goblin, goblinTorch. Validator passes, hitAdd frame 0 = delta 0, set speeds monotone + equal legRig tunedMps, OB-150 windup rule.
// Player rig (charkit, idle/walk only) and bear (walk only, no run/attack/hurt) have nothing to blend yet: see docs/lanes/pc-b2.md.
import assert from 'node:assert';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_beast.js';
import '../design/models/voxel_wolf.js';
import '../design/models/voxel_goblin.js';
import { validateVoxelModel, packVoxelModel } from '../engine/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };
const M = globalThis.ASSETS.models;
// held = key index of the held/cocked pose (goblin cockedKey 3); sim windup ms (clip time at which the held key must be reached) + the sim's attack/recover clip names
const CASES = {
  wolf:           { windup: 'crouch', held: 2, windupMs: 500, attack: ['leap', 'bite'], recover: ['run', 'walk', 'idle'] },
  boarPlaceholder:{ windup: 'windup', held: 7, windupMs: 500, attack: ['charge'], recover: ['idle', 'walk'] },
  goblin:         { windup: 'attack', held: 3, windupMs: 500, attack: ['attack', 'throw'], recover: ['run', 'walk', 'idle'] },
  goblinTorch:    { windup: 'attack', held: 3, windupMs: 500, attack: ['attack', 'throw'], recover: ['run', 'walk', 'carryTorch', 'idle'] }
};
const sum = (a, n) => a.slice(0, n).reduce((s, v) => s + v, 0);

for (const [name, c] of Object.entries(CASES)) {
  const def = M[name].voxel, B = def.blend, A = def.animations;
  test(`${name}: validateVoxelModel ok + packs blend`, () => {
    assert.deepStrictEqual(validateVoxelModel(def, {}).errors, []);
    assert.ok(B && B.sets && B.fades && B.additive);
    const pm = packVoxelModel(def, () => 1);
    assert.ok(pm.blend && pm.blend.addNames.length === 1);
  });
  test(`${name}: hitAdd frame 0 = rest, delta 0 at frame 0, non-looping, masked parts only`, () => {
    const h = A.hitAdd, pm = packVoxelModel(def, () => 1), add = pm.blend.addClips[0];
    assert.strictEqual(h.loop, false);
    assert.ok(add.keys.slice(0, pm.partCount * 6).every((v) => v === 0), 'frame 0 delta must be exactly 0');
    assert.ok(add.keys.some((v) => v !== 0), 'hit clip must move something');
    assert.deepStrictEqual(h.frames[h.frames.length - 1], h.frames[0], 'returns to rest');
  });
  test(`${name}: set speeds strictly increasing and = legRig tunedMps (when present)`, () => {
    const clips = B.sets.locomotion.clips;
    for (let i = 1; i < clips.length; i++) assert.ok(clips[i].at > clips[i - 1].at);
    if (def.legRig) for (const k of clips) if (def.legRig.gaits[k.clip]) assert.strictEqual(k.at, def.legRig.gaits[k.clip].tunedMps, k.clip);
  });
  test(`${name}: OB-150 windup rule (into[windup] <= 25 %, held key before sim windup ends, into[attack] <= 80, attack>recover >= 150)`, () => {
    const w = A[c.windup], total = sum(w.durations, w.durations.length), into = B.fades.into, pairs = B.fades.pairs;
    assert.ok(into[c.windup] <= 0.25 * total, `into[${c.windup}] ${into[c.windup]} > 25 % of ${total}`);
    assert.ok(sum(w.durations, c.held) <= c.windupMs, 'last key reached after the sim windup');
    for (const a of c.attack) {
      assert.ok(into[a] <= 80, `into[${a}]`);
      for (const r of c.recover) if (pairs[`${a}>${r}`] !== undefined || a !== 'charge') assert.ok(pairs[`${a}>${r}`] >= 150, `${a}>${r}`);
    }
  });
}
console.log(`anim-blend-02: ${passed} passed`);
