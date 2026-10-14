// node tools/gait-a.test.mjs - ANIM-A-01 (D-101 option A): the shipped walk / trot clips of boar, otter, tortoise, cub, rabbit keep their feet planted.
// Measures the sole of every leg during its stance (pose FK of the model def, tools/gait-lib.mjs) at the keys and at 4 interpolated samples per key:
// worst |z| <= 12 mm (the preview's check). Also: the shipped clip == what tools/gen-gait.mjs generates now (no hand edits), same parts, loop flag.
import assert from 'node:assert';
import { CONFIGS, defOf } from './gait-configs.mjs';
import { genGait, plantedError } from './gait-lib.mjs';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };
const up = (l) => (typeof l === 'object' ? l.upper : l);   // ANIM-B-01b knee legs: the upper part carries the swing + lift
for (const cfg of CONFIGS) {
  const def = defOf(cfg), clip = def.animations[cfg.clip];
  test(`${cfg.id}: clip present, loops, one duration per key, only the model's parts`, () => {
    assert.ok(clip, 'clip missing');
    assert.strictEqual(clip.loop, true);
    assert.strictEqual(clip.durations.length, clip.frames.length);
    for (const f of clip.frames) for (const n of Object.keys(f)) assert.ok(def.parts[n], 'unknown part ' + n);
    assert.ok(def.meshOnly || Object.keys(def.parts).length <= 8, 'part count');
  });
  test(`${cfg.id}: planted-foot error <= 12 mm (keys + interpolated)`, () => {
    const k = plantedError(def, cfg, clip, 1) * 1000, s = plantedError(def, cfg, clip, 4) * 1000;
    console.log(`   keys ${k.toFixed(2)} mm, interpolated ${s.toFixed(2)} mm`);
    assert.ok(k <= 12 && s <= 12, `${k} / ${s} mm`);
  });
  test(`${cfg.id}: legs swing and the feet lift`, () => {
    const rots = clip.frames.map((f) => f[up(cfg.legs[cfg.gait === 'biped' ? 'HL' : 'FL'])].rot[0]);
    assert.ok(Math.max(...rots) - Math.min(...rots) > 10, 'front-left leg barely swings');
    const lifts = clip.frames.map((f) => f[up(cfg.legs.HR)].pos[2]);
    assert.ok(Math.max(...lifts) - Math.min(...lifts) > 0.3, 'no foot lift');
  });
  test(`${cfg.id}: shipped clip equals the generator output (re-run node tools/gen-gait.mjs if this fails)`, () => {
    const pick = (c) => (cfg.only ? { frames: c.frames.map((f) => Object.fromEntries(cfg.only.map((n) => [n, f[n]]))) } : c);   // goblin (B-01d): only body + legs are generated
    assert.deepStrictEqual(JSON.parse(JSON.stringify(pick(clip))), JSON.parse(JSON.stringify(pick(genGait(def, cfg).clip))));
  });
}
console.log(`${passed} passed`);
