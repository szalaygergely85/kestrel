// game/js/quest/particleHooks.test.js (US-053c). Run: node game/js/quest/particleHooks.test.js
// Headless Node ESM, no framework - same precedent as practiceTarget.test.js.
import { World, createParticles, createEntityEmitters } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import particlesMod from '../../../design/models/particles.js';
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import swordMod from '../../../design/models/sword.js';
import m3PropsMod from '../../../design/models/m3_props.js';
import farTowerMod from '../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../design/models/ferrum_lights.js';
import boarMod from '../../../design/models/voxel_beast.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import { createParticleHooks, applyPropEmitters } from './particleHooks.js';

paletteMod; detailPassMod; particlesMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod;
relayMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod; boarMod; // classic scripts: side effects on globalThis.ASSETS
const { assets } = await loadTestAssets();
const PS = globalThis.ASSETS.particles; // design/models/particles.js
// US-079b: copy boarFx's corpseDust/scrapeDust/hurtBristle presets into ASSETS.particles.presets, same as main.js
// does before its own defineEmitter loop (boarFx.attach() is the one place those presets enter the particle table).
globalThis.ASSETS.boarFx.attach();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const worldM1 = assets.world('world_m1');
function freshWorld() {
  return World.load(worldM1, assets, {});
}
function makeEvents() {
  const listeners = new Map();
  return {
    on(name, fn) {
      let s = listeners.get(name); if (!s) { s = new Set(); listeners.set(name, s); } s.add(fn);
      return () => s.delete(fn);
    },
    emit(name, payload) { const s = listeners.get(name); if (!s) return; for (const fn of Array.from(s)) fn(payload); },
  };
}
function defineAllPresets(p) {
  const ids = {};
  for (const k of Object.keys(PS.presets)) ids[k] = p.defineEmitter(k, PS.toEmitterDef(k, assets.palette.rgb));
  return ids;
}

// ---------------------------------------------------------------------------
// AC2: every preset (flame, smoke, sparks, dust) validates and defines without throwing.
// ---------------------------------------------------------------------------
{
  const errs = PS.validate(assets.palette.rgb);
  ok('design/models/particles.js validate() reports no errors against the real palette', errs.length === 0, errs.join('; '));
  const p = createParticles();
  let threw = null;
  try { defineAllPresets(p); } catch (e) { threw = e; }
  ok('flame/smoke/sparks/dust all defineEmitter without throwing', threw === null, threw && threw.message);
  ok('exactly 4 presets defined', ['flame', 'smoke', 'sparks', 'dust'].every((k) => p.defIdOf(k) >= 0));
}

// ---------------------------------------------------------------------------
// AC3: applyPropEmitters maps content `emitters` (tower.level.json's `brazier` prop) onto
// `components.emitters`, and entityEmitters.sync() (engine/world/entityEmitters.js, already
// generic) can discover it with no further engine change.
// ---------------------------------------------------------------------------
{
  const world = freshWorld();
  const handle = world.get('tower.brazier');
  ok('World.load does not map `emitters` itself (stays game-side, same as targetable)', !handle.data.components.emitters);
  applyPropEmitters(world);
  const list = handle.data.components.emitters;
  ok('applyPropEmitters adds components.emitters', Array.isArray(list) && list.length === 2);
  ok('embers then smoke, both on', list[0].preset === 'embers' && list[1].preset === 'smoke' && list[0].on && list[1].on);
  ok('embers and smoke start above the fire body', list[0].offset.up === 1.0 && list[1].offset.up === 1.5);
  const fire = world.get('tower.burnerFire');
  ok('burnerFire loads at the grate without collision', !!fire && fire.data.transform.x === handle.data.transform.x && fire.data.transform.y === handle.data.transform.y && fire.data.transform.z === 1.05 && !fire.data.components.body);
  const model = assets.model('burnerFire');
  ok('burnerFire resolves the resized animated body', model.world.h === 0.75 && model.world.w === 0.5 && model.animations.burn.frames.length === 8);
  ok('burnerFire content selects burn animation', fire.data.components.sprite.model === 'burnerFire' && fire.data.components.sprite.anim === 'burn' && fire.data.components.sprite.loop);
  ok('the old burnerFlame billboard prop is gone (removed, not hidden)', !world.get('tower.burnerFlame'));
}
{
  // Idempotent / safe to call twice (main.js calls it once per world:loaded, every load/restart).
  const world = freshWorld();
  applyPropEmitters(world);
  applyPropEmitters(world);
  ok('calling applyPropEmitters twice is harmless', world.get('tower.brazier').data.components.emitters.length === 2);
}
{
  // A prop with no `emitters` key is left untouched.
  const world = freshWorld();
  applyPropEmitters(world);
  ok('a prop with no emitters key gets no components.emitters', !world.get('tower.sword').data.components.emitters);
}

// ---------------------------------------------------------------------------
// Full pipeline (AC1/AC3 end-to-end): applyPropEmitters + the engine's own createEntityEmitters
// (engine/world/entityEmitters.js, unmodified) discover the burner's emitters with no further
// engine change - confirms "World.js already supports components.emitters generically".
// ---------------------------------------------------------------------------
{
  const world = freshWorld();
  const particles = createParticles();
  const ids = defineAllPresets(particles);
  applyPropEmitters(world);
  const ee = createEntityEmitters(world, particles, null, (key) => particles.defIdOf(key));
  ee.sync();
  ok('entityEmitters discovers both burner emitters with no engine change', ee.count === 2, ee.count);
  for (let i = 0; i < 5; i++) particles.step();
  ok('the embers emitter is live (spawning) after a few steps', particles.stats.spawned > 0, particles.stats.spawned);
  ee.dispose();
}

// ---------------------------------------------------------------------------
// createParticleHooks: sword sparks on combat:hit (AC4) - deterministic args, no RNG of its own.
// ---------------------------------------------------------------------------
{
  const world = freshWorld();
  const events = makeEvents();
  const particles = createParticles();
  const ids = defineAllPresets(particles);
  const origRandom = Math.random;
  let randomCalled = false;
  Math.random = () => { randomCalled = true; return origRandom(); };
  const hooks = createParticleHooks(world, events, particles, PS, 20);

  events.emit('combat:hit', { source: 'beast', target: 'player', damage: 1, heavy: 0, dirX: 1, dirY: 0, px: 1, py: 2, pz: 3 });
  ok('a hit NOT from the player (beast -> player) does not spark', particles.stats.spawned === 0, particles.stats.spawned);

  events.emit('combat:hit', { source: 'player', target: 'tower.sword', damage: 1, heavy: 0, dirX: 0.6, dirY: 0.8, px: 10, py: 11, pz: 1.2 });
  particles.step(); // burstAt's pending count spawns on the next step()
  ok('a player sword hit sparks (light: 10)', particles.stats.spawned === 10, particles.stats.spawned);

  events.emit('combat:hit', { source: 'player', target: 'tower.sword', damage: 2, heavy: 1, dirX: 0, dirY: 1, px: 5, py: 5, pz: 1 });
  particles.step();
  ok('a heavy sword hit sparks more (10 + 14 = 24)', particles.stats.spawned === 24, particles.stats.spawned);
  ok('createParticleHooks never calls Math.random itself (burstAt/step draw from the sim RNG, not here)', !randomCalled);

  Math.random = origRandom;
  hooks.dispose();
  events.emit('combat:hit', { source: 'player', target: 'tower.sword', damage: 1, px: 0, py: 0, pz: 0 });
  particles.step();
  ok('dispose() drops the listener - a hit after dispose sparks nothing new', particles.stats.spawned === 24);
}

// ---------------------------------------------------------------------------
// createParticleHooks.step: landing dust (AC5) - above LANDING_DUST_SPEED (6 m/s) only.
// speed = sqrt(2 * gravity * fallDistance); gravity 20 (engine/physics/config.js default) ->
// fallDistance 0.9 m is the 6 m/s threshold (36 / 40).
// ---------------------------------------------------------------------------
{
  const world = freshWorld();
  const events = makeEvents();
  const particles = createParticles();
  defineAllPresets(particles);
  const hooks = createParticleHooks(world, events, particles, PS, 20);

  const below = { transform: { x: 1, y: 2, z: 0 }, components: { body: { landed: true, fallDistance: 0.5 } } }; // v ~ 4.47 m/s
  hooks.step(below);
  particles.step();
  ok('a soft landing (fallDistance 0.5 m, ~4.47 m/s) kicks no dust', particles.stats.spawned === 0, particles.stats.spawned);

  const above = { transform: { x: 1, y: 2, z: 0 }, components: { body: { landed: true, fallDistance: 2.0 } } }; // v ~ 8.94 m/s
  hooks.step(above);
  particles.step();
  ok('a hard landing (fallDistance 2.0 m, ~8.94 m/s) kicks dust (10)', particles.stats.spawned === 10, particles.stats.spawned);

  const notLanded = { transform: { x: 1, y: 2, z: 0 }, components: { body: { landed: false, fallDistance: 5 } } };
  hooks.step(notLanded);
  particles.step();
  ok('landed:false (mid-air) does nothing even with a big fallDistance', particles.stats.spawned === 10);

  const noBody = { transform: { x: 1, y: 2, z: 0 }, components: {} };
  hooks.step(noBody); // must not throw
  ok('no body component: no-op, no throw', particles.stats.spawned === 10);
  hooks.step(null); // must not throw
  ok('null playerData: no-op, no throw', particles.stats.spawned === 10);

  hooks.dispose();
}

// ---------------------------------------------------------------------------
// US-079b: beast:sink -> corpse dust burst (boarFx.death.sink.dust 8 + 6 = 14, collapsed into one burst).
// ---------------------------------------------------------------------------
{
  const world = freshWorld();
  const events = makeEvents();
  const particles = createParticles();
  defineAllPresets(particles);
  const hooks = createParticleHooks(world, events, particles, PS, 20);

  events.emit('beast:sink', { id: 'b1', x: 5, y: 6, z: 0 });
  particles.step(); // burstAt's pending count spawns on the next step()
  ok('a beast:sink bursts the corpse dust (14)', particles.stats.spawned === 14, particles.stats.spawned);

  hooks.dispose();
  events.emit('beast:sink', { id: 'b1', x: 5, y: 6, z: 0 });
  particles.step();
  ok('dispose() drops the beast:sink listener - a sink after dispose spawns nothing new', particles.stats.spawned === 14);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
