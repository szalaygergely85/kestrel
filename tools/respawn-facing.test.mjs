// BUG-RESPAWN-001: production respawn -> PlayerLook -> controls -> integrate regression.
// Run: node tools/respawn-facing.test.mjs
import { World, loadLevel, integrate, PHYSICS } from '../engine/index.js';
import { PlayerLook, Events } from '../engine/dev.js';
import { makeOk } from '../engine/test/assert.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { createVitals } from '../game/js/quest/sim/vitals.js';
import { VITALS_DEFAULTS as CFG } from '../game/js/quest/sim/vitalsConfig.js';
import { createTargeting } from '../game/js/quest/targeting.js';

const { assets } = await loadTestAssets();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function playerEntity(x, y, z) {
  return { id: 'player', type: 'player', x, y, z,
    components: { body: { vx: 0, vy: 0, vz: 0, grounded: true, landed: false, fallDistance: 0, eyeH: 1.6 } } };
}
function buildWorld(entities) {
  return World.load({ name: 'respawnFacing', terrain: null, structures: [], entities, state: {} }, assets, {});
}
function killAndRespawn(vitals, player) {
  player.components.health.hp = 1;
  player.components.body.landed = true;
  player.components.body.fallDistance = CFG.fallThreshold10m + 1;
  vitals.step(player, false);
  player.components.body.landed = false;
  for (let i = 0; i < CFG.sinkSteps + CFG.fadeSteps; i++) vitals.step(player, false);
  vitals.step(player, true);
}

// BUG-RESPAWN-001: real look -> controls -> integrate after default/saved respawn, with/without target lock.
// Respawn still leaves transform pitch unchanged; syncing it does not add a new saved-pitch rule.
// ---------------------------------------------------------------------------------------------------------------
for (const saved of [false, true]) for (const locked of [false, true]) {
  const label = `${saved ? 'saved' : 'default'} respawn, ${locked ? 'target locked' : 'free look'}`;
  const world = buildWorld([playerEntity(3, 3, 0), {
    id: 'target', type: 'beast', x: 3, y: 1, z: 0,
    components: { targetable: { radius: 0.45, height: 0.7 } },
  }]);
  const flat = loadLevel({ name: 'respawnFlat', rows: ['......', '......', '......', '......', '......', '......'],
    legend: { '.': { floorH: 0, ceilH: 'sky', solid: false, floorMat: 'floor', ceilMat: 'sky', wallMat: 'stone' } },
    start: { x: 3, y: 3, facingDeg: 40 } });
  world.sectorAt = (x, y) => flat.sectorAt(x, y);
  world.outsideSector = (x, y) => flat.sectorAt(x, y) || flat.outsideSector(x, y);
  const player = world.get('player').data;
  player.transform.yawDeg = 40;
  player.transform.pitchDeg = -12;
  if (saved) {
    world.state['save.x'] = 3; world.state['save.y'] = 3; world.state['save.z'] = 0;
    world.state['save.yaw'] = 90;
  }
  const previousDocument = globalThis.document;
  globalThis.document = new EventTarget();
  const canvas = new EventTarget();
  const input = { consumeMouseDelta: () => ({ dx: 0, dy: 0 }), isDown: () => false };
  const look = new PlayerLook(canvas, input, 0, -12);
  const events = new Events();
  const targeting = createTargeting(world, events, {});
  let syncCalls = 0, clearedBeforeSync = false;
  const vitals = createVitals(world, events, CFG, {
    targeting,
    syncFacing(t) {
      syncCalls++;
      clearedBeforeSync = targeting.targetId === null && !look.lockActive;
      look.clearLock();
      look.yawDeg = t.yawDeg; look.pitchDeg = t.pitchDeg;
    },
  });
  vitals.step(player, false);
  if (locked) {
    targeting.step(PHYSICS.fixedDt, true, 0, player, look);
    ok(`${label}: fixture acquires the real target lock`, targeting.targetId === 'target' && look.lockActive);
  }
  look.yawDeg = player.transform.yawDeg = 210;
  look.pitchDeg = player.transform.pitchDeg = 17;
  killAndRespawn(vitals, player);
  const yaw = saved ? 90 : 40;
  ok(`${label}: sync sees restored facing after target clear`, syncCalls === 1 && clearedBeforeSync
    && look.yawDeg === yaw && look.pitchDeg === 17);
  ok(`${label}: real target lock is cleared`, targeting.targetId === null && !look.lockActive);
  const controls = { forward: 0, strafe: 0, jump: false, run: false, yawDeg: 0, pitchDeg: 0 };
  let stable = true;
  for (let i = 0; i < 5; i++) {
    targeting.step(PHYSICS.fixedDt, false, 0, player, look);
    look.update(PHYSICS.fixedDt);
    controls.yawDeg = look.yawDeg; controls.pitchDeg = look.pitchDeg;
    integrate(player, PHYSICS.fixedDt, controls, world, PHYSICS);
    vitals.step(player, false);
    stable &&= player.transform.yawDeg === yaw && player.transform.pitchDeg === 17
      && look.yawDeg === yaw && look.pitchDeg === 17 && !look.lockActive;
  }
  ok(`${label}: camera/body facing survives five real fixed steps`, stable, JSON.stringify(player.transform));
  vitals.dispose(); targeting.dispose(); look.dispose();
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}

// ---------------------------------------------------------------------------------------------------------------
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
