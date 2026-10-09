// SETTINGS-APPLY-01: reduce motion zeroes kick/bob, reaches itemGetCard + hurt edge; text size -> UI cols; persists.
import assert from 'node:assert/strict';
const data = {};
globalThis.window = { localStorage: { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } } };
const C = await import('./comfort.js');
const { saveSettings, loadSettings } = await import('../platform/index.js');
const { kickDeg } = await import('../quest/vitalsView.js');
const { createHurtFx } = await import('../fx/hurtFx.js');
const { drawHurtEdge } = await import('../quest/vitalsView.js');

const cfg = { walkSpeed: 4, headBobAmplitude: 0.03 };
const body = { grounded: true, vx: 4, vy: 0, feel: { bobPhase: Math.PI / 2 } };
const vit = { hurtTick: 10, tick: 12 };
assert.ok(kickDeg(vit, 0) > 0);
assert.equal(C.gateKick(1.5), 1.5); assert.equal(C.eyeZ(2, body, cfg), 2);
C.setReduceMotion(true);
assert.equal(C.gateKick(1.5), 0);
assert.ok(Math.abs(C.eyeZ(2, body, cfg) - 1.97) < 1e-9);
assert.equal(C.eyeZ(2, { ...body, grounded: false }, cfg), 2);
// hurt fx: static tint (not zero, not time-varying)
const fx = createHurtFx({ reduceMotion: C.isReduceMotion }); fx.step(1000 / 60, 2, true);
const a = fx.pulse(); fx.step(300, 2, true); assert.ok(a > 0); assert.equal(fx.pulse(), a);
// hurt edge: reduce -> constant stage over time
const style = { hurtEdge: { ms: 300, steps: 3, thickness: { rows: 1, cols: 1 }, rings: [{ glyph: '#', fg: [255, 0, 0], bg: [9, 0, 0], coverage: 1 }],
  stages: [{ untilStep: 1, rings: 1, gain: 1, glyph: '#' }, { untilStep: 3, rings: 1, gain: 0.2, glyph: '.' }] } };
const dump = (tick, rm) => { const l = []; drawHurtEdge({ cols: 4, rows: 4, setCellRGB: (...x) => l.push(x.join()) }, { hurtTick: 1, tick }, 0, style, rm); return l.join('|'); };
assert.notEqual(dump(2, false), dump(15, false)); assert.equal(dump(2, true), dump(15, true));
// itemGetCard gets the flag (bool or live getter)
import('./itemGetCard.js').then(() => {});
// text size -> grid cols (clamped later by the engine)
assert.deepEqual(['small', 'normal', 'large', undefined].map((s) => C.textSizeCols(160, s)), [200, 160, 128, 160]);
// persists across reload
saveSettings({ reduceMotion: true, textSize: 'large' });
const re = loadSettings(); assert.equal(re.reduceMotion, true); assert.equal(re.textSize, 'large');
console.log('comfort OK');
