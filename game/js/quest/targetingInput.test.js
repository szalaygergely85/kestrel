// US-087: blocked inputs and targeting clocks, with the production targeting sim.
import { makeOk } from '../../../engine/test/assert.js';
import { createTargeting } from './targeting.js';
import { stepTargetingInput } from './targetingInput.js';
import { isPaused } from '../ui/pause.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, m => failures.push(m));
const DT = 1 / 60;

function fixture(withTargets = true, cfg = {}) {
  const player = { transform: { x: 0, y: 0, z: 0 }, components: { body: { eyeH: 1.6 } } };
  const target = (id, x) => ({ id, transform: { x, y: -5, z: 0 },
    components: { targetable: { radius: 0.45, height: 0.7 } } });
  const entities = withTargets ? [target('centre', 0), target('right', 1), target('left', -1)] : [];
  const sector = { solid: false, floorH: -1000, ceilH: 1000 };
  const world = {
    forEachEntity(fn) { for (const entity of entities) fn(entity); },
    get(id) { const data = entities.find(e => e.id === id); return data ? { data } : null; },
    structureAt() { return null; },
    outsideSector() { return sector; },
  };
  const look = { yawDeg: 0, pitchDeg: 0, locked: false, setCalls: 0, clearCalls: 0,
    setLockPoint() { this.setCalls++; }, clearLock() { this.clearCalls++; } };
  const targeting = createTargeting(world, { on() { return () => {}; } }, cfg);
  const pressed = new Set(), down = new Set();
  const input = {
    wheel: 0, drains: 0,
    pressed(code) { return pressed.has(code); }, isDown(code) { return down.has(code); },
    consumeWheel() { const value = this.wheel; this.wheel = 0; this.drains++; return value; },
    endFrame() { pressed.clear(); },
  };
  function step(blocked = false) { return stepTargetingInput(targeting, DT, input, player, look, blocked); }
  function press(code, shift = '') {
    pressed.clear(); down.clear(); pressed.add(code); if (shift) down.add(shift);
  }
  function lock() { press('KeyQ'); step(); input.endFrame(); }
  return { input, look, targeting, sector, press, step, lock };
}

// Each caller gate must freeze both lock/unlock and all cycle directions.
for (const gate of ['pause', 'Settings', 'map', 'death', 'wake', 'end']) {
  const f = fixture();
  f.press('KeyQ');
  ok(`${gate}: blocked Q cannot lock`, !f.step(true) && !f.targeting.locked);
  f.input.endFrame(); f.step();
  ok(`${gate}: Q edge is not replayed on resume`, !f.targeting.locked);
  f.lock();
  ok(`${gate}: active Q locks normally`, f.targeting.targetId === 'centre');
  const calls = f.look.setCalls;
  f.press('KeyQ'); f.step(true);
  ok(`${gate}: blocked Q cannot unlock`, f.targeting.targetId === 'centre');
  f.input.endFrame();
  for (const shift of ['', 'ShiftLeft', 'ShiftRight']) {
    f.press('Tab', shift); f.step(true); f.input.endFrame();
    ok(`${gate}: blocked ${shift || 'forward'} Tab cannot cycle`, f.targeting.targetId === 'centre');
  }
  for (const direction of [-1, 1]) {
    f.input.wheel = direction; f.step(true);
    ok(`${gate}: blocked wheel ${direction} drained without cycling`,
      f.input.wheel === 0 && f.targeting.targetId === 'centre');
  }
  ok(`${gate}: blocked steps never refresh the camera lock`, f.look.setCalls === calls);
  f.step();
  ok(`${gate}: resume does not replay wheel`, f.targeting.targetId === 'centre');
  f.press('Tab'); f.step(); f.input.endFrame();
  ok(`${gate}: new forward Tab works after resume`, f.targeting.targetId === 'right');
  f.press('Tab', 'ShiftRight'); f.step(); f.input.endFrame();
  ok(`${gate}: new reverse Tab works after resume`, f.targeting.targetId === 'centre');
  f.input.wheel = -1; f.step();
  ok(`${gate}: new reverse wheel works after resume`, f.targeting.targetId === 'left');
  f.input.wheel = 1; f.step();
  ok(`${gate}: new forward wheel works after resume`, f.targeting.targetId === 'centre');
}

{
  const f = fixture();
  f.lock(); f.press('Tab'); f.input.wheel = 1;
  const paused = isPaused({ ending: false, look: f.look, isMapOpen: () => false });
  f.step(paused); f.input.endFrame();
  ok('real pause gate with unlocked pointer blocks Tab/wheel cycle', paused && f.targeting.targetId === 'centre');
  f.look.locked = true;
  f.step(isPaused({ ending: false, look: f.look, isMapOpen: () => false }));
  ok('pointer-lock resume leaves discarded pause wheel behind', f.targeting.targetId === 'centre');
}
{
  const f = fixture(false);
  f.lock();
  const timer = f.targeting.noTargetT;
  for (let i = 0; i < 120; i++) f.step(true);
  ok('no-target tick freezes through blocked updates', timer > 0 && f.targeting.noTargetT === timer);
  f.step();
  ok('no-target tick resumes by one sim step', f.targeting.noTargetT === timer - 1);
}
{
  const f = fixture();
  f.lock(); f.press('KeyQ'); f.step(); f.input.endFrame();
  const timer = f.targeting.fadeT;
  for (let i = 0; i < 120; i++) f.step(true);
  ok('unlock fade freezes through blocked updates', timer > 0 && f.targeting.fadeT === timer);
  f.step();
  ok('unlock fade resumes by one sim step', f.targeting.fadeT === timer - 1);
}
{
  const f = fixture(true, { losEvery: 1, losLostSec: 3 * DT });
  f.lock(); f.sector.solid = true; f.step();
  const paused = isPaused({ ending: false, look: f.look, isMapOpen: () => false });
  for (let i = 0; i < 120; i++) f.step(paused);
  ok('LOS lost state freezes while paused with unlocked pointer',
    !f.look.locked && f.targeting.targetId === 'centre');
  f.step();
  ok('existing lost state survives resume (second hidden step)', f.targeting.targetId === 'centre');
  f.step();
  ok('LOS breaks at third active hidden step only', !f.targeting.locked);
}
{
  const f = fixture();
  f.input.wheel = 1;
  ok('absent targeting still drains wheel',
    !stepTargetingInput(null, DT, f.input, null, null, false) && f.input.wheel === 0);
}

for (const message of failures) console.error(`FAIL: ${message}`);
console.log(`targetingInput.test.js: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
