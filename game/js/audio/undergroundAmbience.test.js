// node game/js/audio/undergroundAmbience.test.js (UNDER-08): mock AudioContext, drive the real module.
import { makeOk } from '../../../engine/test/assert.js';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
let created = 0, tNow = 0;
const gains = [];
const param = () => ({ value: 0, calls: [], setTargetAtTime(v) { this.calls.push(v); }, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
const node = (extra = {}) => { created++; return { connect() {}, disconnect() {}, start() {}, stop() {}, ...extra }; };
class FakeCtx {
  constructor() { this.sampleRate = 8000; this.state = 'running'; this.destination = {}; }
  get currentTime() { return tNow; }
  resume() { return Promise.resolve(); }
  createBuffer(c, n) { const d = new Float32Array(n); return { getChannelData: () => d }; }
  createBufferSource() { return node({ loop: false }); }
  createBiquadFilter() { return node({ frequency: param(), Q: param() }); }
  createGain() { const n = node({ gain: param() }); gains.push(n); return n; }
  createOscillator() { return node({ frequency: param() }); }
  createStereoPanner() { return node({ pan: param() }); }
}
const handlers = {};
globalThis.window = { AudioContext: FakeCtx, addEventListener: (e, f) => { handlers[e] = f; }, removeEventListener() {} };
globalThis.document = { hidden: false };
const synth = await import('./synth.js');
const ug = await import('./undergroundAmbience.js');
const fa = await import('./forestAmbience.js');
synth.initAudio(); handlers.keydown();

let scene = 'exterior', amb = null, hour = 12;
const wire = () => ug.setUndergroundSources({ anchors: [{ x: 100, y: 100 }], sceneOf: () => scene, ambienceAt: () => amb, hour: () => hour });
wire();
fa.setForestAmbienceSources({ biomeAt: () => 2, hour: () => hour });
const player = { transform: { x: 500, y: 500, z: 0 } };
ug.resetUndergroundAmbience(); fa.resetForestAmbience();

ug.stepUndergroundAmbience(player);
ok('built, far from anchor: bed 0', ug.__test_state().built && ug.__test_state().bed === 0);
player.transform.x = 120; player.transform.y = 110; ug.stepUndergroundAmbience(player);
ok('near cemetery anchor: bed 1', ug.__test_state().bed === 1);
player.transform.x = 141; player.transform.y = 100; ug.stepUndergroundAmbience(player);
ok('41 m away: off', ug.__test_state().bed === 0);
ug.setUndergroundSources({ sceneOf: () => 'exterior', ambienceAt: () => null });
ok('default anchor fallback', ug.pickBed({ x: 1644, y: 1372, z: 0 }) === 1 && ug.pickBed({ x: 0, y: 0, z: 0 }) === 0);
wire();

player.transform.x = 500; scene = 'interior'; amb = null; ug.stepUndergroundAmbience(player);
ok('interior without ambience: none', ug.__test_state().bed === 0);
amb = 'cave'; ug.stepUndergroundAmbience(player);
ok('interior+cave: underground bed', ug.__test_state().bed === 2);
amb = 'crypt'; ug.stepUndergroundAmbience(player);
ok('interior+crypt: bed 3', ug.__test_state().bed === 3);
scene = 'exterior'; ug.stepUndergroundAmbience(player);
ok('exterior with ambience field: off', ug.__test_state().bed === 0);

// crossfade: forest suppressed underground, restored outside
scene = 'exterior'; amb = null; ug.stepUndergroundAmbience(player); fa.stepForestAmbience(player); // forest on first
scene = 'interior'; amb = 'cave'; ug.stepUndergroundAmbience(player); fa.stepForestAmbience(player);
const forestWind = gains.find((n) => n.gain.calls.includes(fa.FOREST_WIND_PEAK));
ok('forest bed faded while underground', forestWind.gain.calls[forestWind.gain.calls.length - 1] === 0);
const toneG = gains.find((n) => n.gain.calls.includes(ug.TONE_PEAK));
ok('room tone ramped in via setTargetAtTime', toneG.gain.calls[toneG.gain.calls.length - 1] === ug.TONE_PEAK);
scene = 'exterior'; ug.stepUndergroundAmbience(player); fa.stepForestAmbience(player);
ok('forest bed back outside', forestWind.gain.calls[forestWind.gain.calls.length - 1] === fa.FOREST_WIND_PEAK);
ok('room tone ramped out', toneG.gain.calls[toneG.gain.calls.length - 1] === 0);

// drips 1..5 s, no nodes per frame
scene = 'interior'; amb = 'crypt'; ug.stepUndergroundAmbience(player);
const gaps = []; let last = ug.__test_state().nextDrip;
for (let i = 0; i < 40; i++) { tNow = last; ug.stepUndergroundAmbience(player); const n = ug.__test_state().nextDrip; gaps.push(n - last); last = n; }
ok('drips scheduled within 1..5 s', gaps.every((d) => d >= 1 && d <= 5));
tNow = last - 0.5; const c1 = created;
for (let i = 0; i < 300; i++) ug.stepUndergroundAmbience(player);
ok('no nodes per frame after warm-up', created === c1);

// cemetery night bell 20..40 s
scene = 'exterior'; player.transform.x = 100; player.transform.y = 100; hour = 23; tNow += 1; ug.stepUndergroundAmbience(player);
const b0 = ug.__test_state().nextBell;
ok('bell due in 20..40 s', b0 - tNow >= 20 && b0 - tNow <= 40);
tNow = b0; const c2 = created; ug.stepUndergroundAmbience(player);
ok('bell fired at night + rescheduled', created > c2 && ug.__test_state().nextBell - b0 >= 20);

// mute
synth.setMuted(true); scene = 'interior'; tNow += 100; const c3 = created; ug.stepUndergroundAmbience(player);
ok('muted: no one-shots', created === c3);
ug.resetUndergroundAmbience(); ok('reset clears graph', !ug.__test_state().built);
console.log(`undergroundAmbience: ${pass} pass, ${fail} fail`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
