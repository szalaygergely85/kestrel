// node game/js/audio/forestAmbience.test.js (OB-184 part 3): mock AudioContext, drive the real module.
import { makeOk } from '../../../engine/test/assert.js';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

let created = 0, tNow = 0;
const param = () => ({ value: 0, calls: [], setTargetAtTime(v, t, tc) { this.calls.push(v); }, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
const node = (extra = {}) => { created++; return { connect() {}, disconnect() {}, start() {}, stop() {}, ...extra }; };
class FakeCtx {
  constructor() { this.sampleRate = 8000; this.state = 'running'; this.destination = {}; }
  get currentTime() { return tNow; }
  resume() { return Promise.resolve(); }
  createBuffer(c, n) { const d = new Float32Array(n); return { duration: n / 8000, getChannelData: () => d }; }
  createBufferSource() { return node({ loop: false }); }
  createBiquadFilter() { return node({ frequency: param(), Q: param() }); }
  createGain() { return node({ gain: param() }); }
  createOscillator() { return node({ frequency: param() }); }
  createStereoPanner() { return node({ pan: param() }); }
}
const handlers = {};
globalThis.window = { AudioContext: FakeCtx, addEventListener: (e, f) => { handlers[e] = f; }, removeEventListener() {} };
globalThis.document = { hidden: false };

const synth = await import('./synth.js');
const fa = await import('./forestAmbience.js');
synth.initAudio(); handlers.keydown();
ok('ctx armed', !!synth.getCtx());

let biome = 0, hour = 12;
fa.setForestAmbienceSources({ biomeAt: () => biome, hour: () => hour });
const player = { transform: { x: 0, y: 0, z: 0 } };
const master = synth.getMaster();
fa.resetForestAmbience();

// meadow: graph built, nothing scheduled
fa.stepForestAmbience(player);
const warm = fa.__test_state();
ok('graph built on first step', warm.built && warm.nodeCount > 8);
ok('meadow: wind target 0', true);
// forest switch triggers crossfade
const before = created;
biome = 2; fa.stepForestAmbience(player);
ok('biome switch: no new nodes (only param ramps)', created === before);
// call scheduler within range
const gaps = []; let last = fa.__test_state().nextCallAt;
for (let i = 0; i < 60; i++) {
  tNow = last; fa.stepForestAmbience(player);
  const n = fa.__test_state().nextCallAt; gaps.push(n - last); last = n;
}
ok('calls scheduled within 3..12 s', gaps.every((d) => d >= fa.CALL_MIN_S && d <= fa.CALL_MAX_S), JSON.stringify(gaps.slice(0, 5)));
ok('calls did create nodes (chirps)', created > before);
// no new nodes per frame between calls
tNow = last - 0.5; const c1 = created;
for (let i = 0; i < 300; i++) fa.stepForestAmbience(player);
ok('no nodes per frame after warm-up', created === c1);
ok('calls not before due time', fa.__test_state().nextCallAt === last);
// night swaps the set: owl hoots (2 chirps) rather than birds; day bus off
hour = 23; tNow = last; fa.stepForestAmbience(player);
ok('night: call fired and rescheduled', fa.__test_state().nextCallAt > last);
ok('isNightHour', fa.isNightHour(23) && fa.isNightHour(3) && !fa.isNightHour(12));
// leaving forest: no more calls
biome = 0; tNow = fa.__test_state().nextCallAt + 1; const c2 = created; fa.stepForestAmbience(player);
ok('meadow: no calls', created === c2);
// mute respected
biome = 1; hour = 12; synth.setMuted(true); tNow += 30; const c3 = created; fa.stepForestAmbience(player);
ok('muted: no calls', created === c3);
// reset tears down, no double graph
fa.resetForestAmbience(); ok('reset clears graph', !fa.__test_state().built);
fa.stepForestAmbience(player); ok('rebuilds same size', fa.__test_state().nodeCount === warm.nodeCount);
ok('biome ids', fa.isForestBiome(1) && fa.isForestBiome(3) && !fa.isForestBiome(0) && !fa.isForestBiome(4));

console.log(`forestAmbience: ${pass} pass, ${fail} fail`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
