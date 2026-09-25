// game/js/quest/beacon.js (US-022, D-006/D-008, D-011 reskin: "wake the
// relay" - was "light the beacon"). Real body of `beacon.light`, named by
// `design/levels/tower.js`'s interactable `{ id: 'beacon', prop:
// 'beaconBowl', interact: 'beacon.light', requires: 'tower.lantern.taken',
// light: 'beacon' }`. No literal coordinate here (US-010 tech note 1 rule).
//
// Tech notes (architect, 2026-09-24, docs/architecture.md 7.5 item 5):
// `relay.wake` plays the model's `wake` clip; at `model.wakeLightFrame` (a
// plain model field, `design/models/relay.js`) the point light switches on
// and starts the palette `lights.relay.grow` ramp (`design/palette.js`);
// glow anchor `mounts.glow`. The interaction ctx
// (`engine/world/interaction.js` `fireInteraction`) only ever hands a
// behaviour `{world, engine, def, entity, actor}` - no `structId` (unlike
// `fireTrigger`, which end.js's `questEnd` reads) and no reference to the
// runtime `LightSet` (that lives as `main.js`'s own module-level `lightSet`
// variable, rebuilt on every `'world:loaded'`, per architecture.md 7.4's
// "module-level game variables reset only in the world:loaded handler"
// rule). So `beaconLight` only records what it can see (which prop, which
// light id, a start-of-wake timer) into `world.state` - the actual per-frame
// light ramp runs in `stepBeacon` below, called from `main.js`'s fixed step
// with its own `lightSet` reference (same split as `end.js`'s
// `questEnd`/`stepEnd`).
//
// structId: `World.spawn`'s own convention is `entId = '${structId}.${id}'`
// (`engine/world/World.js` prop spawn), so the prop entity's `id` already
// encodes it; `ctx.def.prop` is the `id` part (`design/levels/tower.js`'s
// `prop: 'beaconBowl'`), so `structId = entity.id` with that suffix (and the
// separating dot) stripped - no hard-coded structId string, works for any
// level that reuses this behaviour.
//
// Sprint-2 note (docs/sprints/sprint-2.md row 3): "adds a relay hum to #2 if
// cheap" - `playRelayHum` (game/js/audio/sfx.js, built on US-020a's
// synth.js) is a one-shot swelling two-tone sine, no new engine hook, no
// sustained node graph to manage across a restart.
import { playRelayHum } from '../audio/sfx.js';

// BUG-PERF-001a fix (docs/backlog.md row 25w): `stepBeacon` used to
// `.find()` `world.structures` AND `struct.level.def.lights` (two closures,
// two O(n) scans) on EVERY fixed step from the moment the relay's wake
// timer starts, and - since nothing ever stopped it - forever after too,
// including the entire rest of the run once the relay is lit (the wake ->
// awake clip-switch check right above it is the only part of this function
// that legitimately needs to keep running every step past that point, and
// it is already O(1) - two `getComponent` reads, no scan). Allocation rule
// 9 (docs/architecture.md 7.6 item 9 / this file's own header) says a
// per-step function must not allocate or scan - so the (structId, lightId)
// -> growDur/targetIntensity lookup is now done ONCE (cached here by key,
// invalidated only if the key OR the `World` instance changes - a restart
// swaps in a brand-new `World`, so the cache still rebuilds itself exactly
// once per run, never per step).
let beaconCache = null; // { key: "<structId>.<lightId>", world, growDur, targetIntensity } - built once per key, never per step

export function beaconLight(ctx) {
  const { world, def, entity } = ctx;
  if (entity) entity.play('wake');
  playRelayHum();

  // This quest's own record of the beat (7.4 "used flags" note: separate
  // from the engine's `used.<structId>.<id>` flag, which the generic
  // `once`/`requires` handling in `updateInteraction` already writes).
  // `tower.beacon.lit` is also the exact state key `design/models/title.js`'s
  // end-card `altWhen` reads (US-017) - setting it here, once, right when
  // the player commits to the interaction, is what makes the one-way rule
  // and the end-card variant agree with no extra wiring.
  world.state['tower.beacon.lit'] = true;
  world.state['tower.beacon.wakeT'] = 0; // stepBeacon's per-step timer, from press

  if (entity && def && def.prop && entity.id && entity.id.length > def.prop.length) {
    world.state['tower.beacon.structId'] = entity.id.slice(0, entity.id.length - def.prop.length - 1);
  }
  world.state['tower.beacon.lightId'] = (def && def.light) || null;
  world.state['tower.beacon.propId'] = entity ? entity.id : null;
  // Cleared so `stepBeacon` re-resolves the handle against the CURRENT
  // `LightSet` (a fresh one every world load/restart - stale numeric handles
  // from a previous `LightSet` are never valid on a new one).
  world.state['tower.beacon.lightHandle'] = null;

  return true;
}

/**
 * Per fixed step (`main.js`, right after `updateInteraction` - same slot
 * `stepEnd` uses for its own "advance while a state key is a number" timer),
 * while `world.state['tower.beacon.wakeT']` is a number: advances the wake
 * timer, switches the relay prop's clip from the (non-looping) `wake` to the
 * looping `awake` once it ends, and turns the point light on + ramps its
 * intensity once the wake clip reaches `model.wakeLightFrame`. A
 * complete no-op (as cheap as a `typeof` check) every step before the relay
 * is woken and every step after its own ramp is done, same as `stepEnd`'s
 * `endT < 0` guard.
 * @param {import('../../../engine/index.js').World} world
 * @param {import('../../../engine/render/lighting.js').LightSet|null} lights - `main.js`'s own `lightSet` (may not exist yet, e.g. `?lights=0`)
 * @param {number} dt - seconds
 * @param {Object} [palette] - `ASSETS.palette` (`lights[lightId]`'s hue/radius/grow duration)
 */
export function stepBeacon(world, lights, dt, palette) {
  const wakeT = world.state['tower.beacon.wakeT'];
  if (typeof wakeT !== 'number') return;
  const t = wakeT + dt;
  world.state['tower.beacon.wakeT'] = t;

  const propId = world.state['tower.beacon.propId'];
  const entity = propId ? world.get(propId) : null;
  if (entity) {
    const comp = entity.getComponent('sprite') || entity.getComponent('voxel');
    if (comp && comp.anim === 'wake' && comp.playing === false) entity.play('awake');
  }

  if (!lights) return;
  const lightId = world.state['tower.beacon.lightId'];
  const structId = world.state['tower.beacon.structId'];
  if (!lightId || !structId) return;

  let handle = world.state['tower.beacon.lightHandle'];
  const key = `${structId}.${lightId}`;
  if (typeof handle !== 'number' || handle < 0 || handle >= lights.count || lights.key[handle] !== key) {
    handle = lights.key.indexOf(key);
    world.state['tower.beacon.lightHandle'] = handle;
  }
  if (handle < 0) return;

  // `model.wakeLightFrame` / the wake clip's own fps (`design/models/relay.js`)
  // is when the sprite's own glow starts reading as "on" - the point light
  // starts its independent 1.0 s grow (palette `lights[lightId].grow.duration`)
  // from that moment, not from press (README/backlog AC: "grows in over 1.0 s
  // from mounts.glow" describes the SPRITE; the light ramp is its own timer).
  let startT = 0;
  const comp = entity && (entity.getComponent('sprite') || entity.getComponent('voxel'));
  const modelKey = comp && comp.model;
  const model = modelKey && world.assets && world.assets.has('model', modelKey) ? world.assets.model(modelKey) : null;
  const wakeAnim = model && model.animations && model.animations.wake;
  if (model && wakeAnim && typeof model.wakeLightFrame === 'number' && wakeAnim.fps) {
    startT = model.wakeLightFrame / wakeAnim.fps;
  }
  if (t < startT) return;

  // `lightId` (`def.light`, e.g. "beacon") is the LEVEL's light id
  // (`design/levels/tower.js` `lights: [{id: 'beacon', preset: 'relay', ...}]`),
  // not a palette preset name - resolve the preset the same way
  // `buildLightSet` did (`engine/render/lighting.js`), through the
  // structure's own `def.lights` entry, so this reads the SAME preset
  // (`relay`: aether teal, D-011) that gave the light its hue at load time,
  // never the legacy orange `palette.lights.beacon` fire preset the id
  // happens to share a name with.
  //
  // BUG-PERF-001a: this used to `.find()` `world.structures` and
  // `struct.level.def.lights` (two closures) right here, EVERY step -
  // cached by `key` instead (built once, first time this key is seen).
  // Invalidated by `world` identity too (not just `key`): a dev-only
  // `?level=` swap could reuse the same structId/lightId strings against a
  // DIFFERENT world's structures - restart (deserialize) keeps the same
  // `World` instance's structures array reference is NOT guaranteed either,
  // so `world` itself (not `world.structures`) is the safe invalidation key.
  if (!beaconCache || beaconCache.key !== key || beaconCache.world !== world) {
    const struct = world.structures.find((s) => s.id === structId);
    const lightDef = struct && struct.level && struct.level.def && struct.level.def.lights
      && struct.level.def.lights.find((l) => l.id === lightId);
    const preset = palette && palette.lights && lightDef && palette.lights[lightDef.preset];
    const growDur = (preset && preset.grow && typeof preset.grow.duration === 'number') ? preset.grow.duration : 1.0;
    // `targetIntensity` is resolved ONCE too - `null` (not a number) means
    // "no explicit preset intensity", the same fallback-to-current-value
    // case the old per-step code had (dead in practice: every real preset
    // sets `intensity`, design/palette.js's `relay` preset included).
    const targetIntensity = (preset && typeof preset.intensity === 'number') ? preset.intensity : null;
    beaconCache = { key, world, growDur, targetIntensity };
  }
  const { growDur, targetIntensity } = beaconCache;
  const frac = growDur > 0 ? Math.min(1, (t - startT) / growDur) : 1;

  // `add()` (`buildLightSet`, level load) already gave this handle its final
  // `radius` from the palette preset - only intensity ramps here. Ramping
  // radius too would need forcing `computeVisGrid` to re-run every frame of
  // the ramp (its cache key is cell + structVersion, not radius), a real
  // per-frame cost for a cosmetic difference the AC doesn't ask for (the AC's
  // "radius 12 m target, minimum 8 m" is the FINAL, perf-tuned budget value,
  // not something that grows in).
  lights.setOn(handle, true);
  const target = targetIntensity !== null ? targetIntensity : lights.baseIntensity[handle];
  lights.baseIntensity[handle] = target * frac;
}
