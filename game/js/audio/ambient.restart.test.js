// game/js/audio/ambient.restart.test.js (US-020b)
//
// Plain Node ESM, no framework, no build step (matches sfx.gain.test.js's
// pattern). Run with:
//
//   node game/js/audio/ambient.restart.test.js
//
// Two things this proves:
//   1. The burner/breach positions ambient.js computes come from the REAL
//      level data (design/levels/tower.js's lights/markers/triggers),
//      loaded through the real engine World - not a hand-typed literal.
//   2. A restart (resetAmbientAudio, called from sfx.js's resetGameAudio on
//      every 'world:loaded', including R) tears down every node the two
//      ambient beds built and the next build creates a fresh set of the
//      same size - never a doubled/leaked set. Verified with a mock
//      AudioContext that tracks exactly which nodes are still "live"
//      (created but not yet stopped+disconnected), driving the REAL
//      build/teardown code in ambient.js (not a re-implementation).
import { World, AssetRegistry } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import towerMod from '../../../design/levels/tower.js';
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
paletteMod; towerMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; // classic scripts: side effects on globalThis.ASSETS

import {
  resetAmbientAudio, __test_build, __test_teardown, __test_liveNodeCount, __test_resolvePositions,
  brazierGainFor, windGainFor,
} from './ambient.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// ---------------------------------------------------------------------------
// 1. Level-data derivation: real tower level, no origin offset (adhoc bare
//    world), so the resolved world-space positions must equal the raw
//    design/levels/tower.js values exactly.
// ---------------------------------------------------------------------------
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
const towerDef = assets.level('tower');
const world = World.load({
  name: 'adhoc_ambient_test', terrain: null,
  structures: [{ id: 'tower', level: 'tower', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }],
  entities: [{ id: 'player', type: 'player', spawn: { structure: 'tower', from: 'start' } }],
  state: {},
}, assets, {});

const rawBrazier = towerDef.lights.find((l) => l.id === 'brazier');
const rawBreach = towerDef.markers.breach;
const rawHintExit = towerDef.triggers.find((t) => t.id === 'hintExit');

const { brazierPos, breachPos, summitZMin } = __test_resolvePositions(world);

ok('brazier position resolves', !!brazierPos);
ok('brazier position == design/levels/tower.js lights.brazier (no origin offset)',
  brazierPos.x === rawBrazier.x && brazierPos.y === rawBrazier.y && brazierPos.z === rawBrazier.z,
  JSON.stringify({ brazierPos, rawBrazier }));
ok('breach position resolves', !!breachPos);
ok('breach position == design/levels/tower.js markers.breach',
  breachPos.x === rawBreach.x && breachPos.y === rawBreach.y && breachPos.z === rawBreach.z,
  JSON.stringify({ breachPos, rawBreach }));
ok('summit zMin == the hintExit trigger\'s own zMin (level data, not a hardcoded fallback)',
  summitZMin === rawHintExit.zMin, `summitZMin=${summitZMin}, rawHintExit.zMin=${rawHintExit.zMin}`);

// Placed at a non-zero origin: positions must shift by exactly that origin
// (proves the +s.origin math, not just a pass-through of the raw level data).
const worldOffset = World.load({
  name: 'adhoc_ambient_test_offset', terrain: null,
  structures: [{ id: 'tower', level: 'tower', origin: { x: 100, y: 200, z: 5 }, yawSteps: 0 }],
  entities: [{ id: 'player', type: 'player', spawn: { structure: 'tower', from: 'start' } }],
  state: {},
}, assets, {});
const resolvedOffset = __test_resolvePositions(worldOffset);
ok('brazier position shifts by the structure origin', resolvedOffset.brazierPos.x === rawBrazier.x + 100 && resolvedOffset.brazierPos.y === rawBrazier.y + 200 && resolvedOffset.brazierPos.z === rawBrazier.z + 5);
ok('breach position shifts by the structure origin', resolvedOffset.breachPos.x === rawBreach.x + 100 && resolvedOffset.breachPos.y === rawBreach.y + 200 && resolvedOffset.breachPos.z === rawBreach.z + 5);
ok('summit zMin shifts by the structure\'s own z origin', resolvedOffset.summitZMin === rawHintExit.zMin + 5);

// ---------------------------------------------------------------------------
// 1b. Distance-gain curves (pure functions - the exact math stepAmbientAudio
//    feeds into setTargetAtTime each fixed step).
// ---------------------------------------------------------------------------
ok('brazier: full gain at 0 m', brazierGainFor(0) === 1);
ok('brazier: full gain at exactly 2 m (<=2m AC)', brazierGainFor(2) === 1);
ok('brazier: silent at exactly 12 m (>=12m AC)', brazierGainFor(12) === 0);
ok('brazier: silent well past 12 m', brazierGainFor(50) === 0);
ok('brazier: partial gain at 7 m is strictly between 0 and 1 (smoothed, not a step)', brazierGainFor(7) > 0 && brazierGainFor(7) < 1, String(brazierGainFor(7)));
ok('brazier: monotonically non-increasing with distance', brazierGainFor(3) > brazierGainFor(6) && brazierGainFor(6) > brazierGainFor(9));

ok('wind: silent below the summit floor even standing right on the breach marker (z too low)', windGainFor(0, 0, 5.9) === 0);
ok('wind: full at the breach itself, once on the summit', windGainFor(6.0, 0, 5.9) === 1);
ok('wind: silent at/after the fade radius, on the summit', windGainFor(6.0, 6.0, 5.9) === 0);
ok('wind: rises on the last stretch (closer = louder)', windGainFor(6.0, 5.0, 5.9) < windGainFor(6.0, 2.0, 5.9));
ok('wind: exactly at the summit floor (z == zMin) counts as "on the summit"', windGainFor(5.9, 3.0, 5.9) > 0);

// ---------------------------------------------------------------------------
// 2. Node-count / restart: a mock WebAudio surface that tracks live nodes,
//    driving the real build (__test_build) / teardown (__test_teardown)
//    logic in ambient.js.
// ---------------------------------------------------------------------------
let liveMockNodes = 0;

function makeMockNode(extra = {}) {
  liveMockNodes++;
  let alive = true;
  return {
    connect() {},
    disconnect() { if (alive) { alive = false; liveMockNodes--; } },
    stop() { if (alive) { alive = false; liveMockNodes--; } },
    ...extra,
  };
}

function makeMockGainParam() {
  return { value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
}

const mockCtx = {
  sampleRate: 44100,
  currentTime: 0,
  createBuffer(channels, length) { return { duration: length / 44100, getChannelData: () => new Float32Array(length) }; },
  createBufferSource() { return makeMockNode({ buffer: null, loop: false, start() {} }); },
  createBiquadFilter() { return makeMockNode({ type: 'lowpass', frequency: { value: 0 }, Q: { value: 0 } }); },
  createGain() { return makeMockNode({ gain: makeMockGainParam() }); },
  createOscillator() { return makeMockNode({ type: 'sine', frequency: { value: 0 }, start() {} }); },
};
const mockMaster = makeMockNode();
liveMockNodes = 0; // mockMaster itself is never torn down by ambient.js (it's the destination, owned by synth.js) - don't count it as part of the 9 tracked ambient nodes

// Real WebAudio node objects that appear as "live" once __test_build runs are
// hiss={source,filter,gain} (3) + wind={source,filter,distGain,gustGain,
// gustLfo,gustDepth} (6) = 9 tracked node references (matches __test_liveNodeCount()).
ok('nothing built yet: 0 live nodes', __test_liveNodeCount() === 0 && liveMockNodes === 0);

__test_build(mockCtx, mockMaster);
ok('first build: __test_liveNodeCount() reports 9 tracked node refs', __test_liveNodeCount() === 9, String(__test_liveNodeCount()));
ok('first build: mock WebAudio surface also has 9 live (not yet stopped/disconnected) nodes', liveMockNodes === 9, String(liveMockNodes));

// Calling build again with nodes already up (e.g. two stepAmbientAudio calls
// in a row before any restart) must NOT create a second set - this is the
// "no doubled loops" guard even without a restart in between.
__test_build(mockCtx, mockMaster);
ok('build is idempotent while already built: still 9 live nodes, not 18', __test_liveNodeCount() === 9 && liveMockNodes === 9, `tracked=${__test_liveNodeCount()}, mockLive=${liveMockNodes}`);

// Simulated restart (R): resetAmbientAudio's teardown must stop+disconnect
// every node the build created.
__test_teardown();
ok('teardown: 0 tracked node refs', __test_liveNodeCount() === 0, String(__test_liveNodeCount()));
ok('teardown: 0 live nodes on the mock WebAudio surface (every source .stop()+.disconnect() called)', liveMockNodes === 0, String(liveMockNodes));

// Rebuild after the simulated restart: must land on exactly 9 live nodes
// again, not 9 old (already-dead, still counted) + 9 new = 18 - i.e. no
// doubled loops after R.
__test_build(mockCtx, mockMaster);
ok('rebuild after restart: exactly 9 live nodes (no doubling)', __test_liveNodeCount() === 9 && liveMockNodes === 9, `tracked=${__test_liveNodeCount()}, mockLive=${liveMockNodes}`);
__test_teardown(); // leave the module in a torn-down state for any test run after this one in the same process

// resetAmbientAudio itself (the function main.js's 'world:loaded' path
// actually calls, via sfx.js) must tear down without throwing even before
// anything was ever built (first load, AudioContext not armed yet).
let threw = false;
try { resetAmbientAudio(null); } catch (e) { threw = true; }
ok('resetAmbientAudio(null) (no world yet) does not throw', !threw);

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
