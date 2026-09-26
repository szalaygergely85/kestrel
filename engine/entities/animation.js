// engine/entities/animation.js (US-011, docs/architecture.md 10.1 / 7.5
// item 3). Clip compilation + the fixed-step animation player.
// `components.sprite` is the only state (D-006); a clip is compiled once
// per `model.animations[name]` def (cached on the def itself via a
// non-enumerable `_clip`, so it never leaks into `serialize`/JSON) and
// reused by every entity that plays it.
//
// @typedef {Object} AnimClip
// @property {Float32Array} durMs   per-frame duration (ms); unused when fps0
// @property {boolean} loop
// @property {(string|null)[]} tagCodes   frame index -> event name, or null
// @property {boolean} fps0   `fps: 0` (README 4 / boulder.roll, lever gear): gameplay-driven, never advanced here
// @property {number} count

// Guards a malformed/zero-duration clip from looping forever inside one
// `stepAnimations` call for one entity (still allocation-free: a plain
// counter, no array).
const MAX_STEPS_PER_CALL = 64;

/** Compiles (and caches on `anim`, never serialized) the clip for one `model.animations[name]`. */
export function compileClip(anim) {
  if (anim._clip) return anim._clip;
  const frames = anim.frames || [];
  const count = frames.length;
  const fps0 = anim.fps === 0;
  const durMs = new Float32Array(count);
  if (!fps0) {
    if (anim.durations) {
      for (let i = 0; i < count; i++) durMs[i] = anim.durations[i % anim.durations.length];
    } else {
      const d = 1000 / (anim.fps || 10);
      durMs.fill(d);
    }
  }
  const tagCodes = new Array(count).fill(null);
  if (anim.events) {
    for (const tag of Object.keys(anim.events)) {
      const v = anim.events[tag];
      for (const idx of Array.isArray(v) ? v : [v]) tagCodes[idx] = tag;
    }
  }
  const clip = { durMs, loop: !!anim.loop, tagCodes, fps0, count };
  Object.defineProperty(anim, '_clip', { value: clip, enumerable: false, configurable: true });
  return clip;
}

/**
 * `sprite.model`/`sprite.anim` -> the compiled clip, resolved through
 * `world.assets` (set by `World.load`). Null when unresolvable (unknown
 * model/anim, or a bare `World` with no assets) - callers warn, never throw
 * (a render/step tick must never crash the game over stale/test data).
 * `isVoxel` (US-041a, 15.3 item 1): when true, resolves `animName` through
 * `model.voxel.animations` (a VoxelClipDef - rot/pos keyframes, not sprite
 * frames) instead of `model.animations`, via `compileVoxelClip` below.
 */
export function clipFor(world, modelKey, animName, isVoxel) {
  if (!world.assets || !world.assets.has('model', modelKey)) return null;
  const model = world.assets.model(modelKey);
  if (isVoxel) {
    const anim = model.voxel && model.voxel.animations && model.voxel.animations[animName];
    return anim ? compileVoxelClip(anim) : null;
  }
  const anim = model.animations && model.animations[animName];
  return anim ? compileClip(anim) : null;
}

/**
 * US-041a (15.3 item 1/4): compiles (and caches on the VoxelClipDef itself,
 * never serialized - same pattern as `compileClip`) an AnimClip-shaped
 * object from a `model.voxel.animations[name]` def, so `stepAnimations`
 * below can drive `components.voxel` with the EXACT same frame/t stepping
 * loop it already uses for `components.sprite` - `voxel.frame`/`voxel.t`
 * feed `computeVoxelPose`'s `inst.frame`/`inst.tMs` directly (voxelPose.js's
 * `samplePose` linearly interpolates frame -> frame+1 using `tMs /
 * durMs[frame]`, which is exactly the invariant this stepper maintains: `t`
 * is always < `durMs[frame]` after stepping). Independent of
 * `voxelPack.js`'s own `pm.clips` (which `VoxelPool` feeds to
 * `computeVoxelPose` for POSE sampling) - this is only for the animation
 * PLAYER's frame/t bookkeeping and `animEnd`/tag events, same job
 * `compileClip` does for sprites.
 */
export function compileVoxelClip(anim) {
  if (anim._clip) return anim._clip;
  const frames = anim.frames || [];
  const count = frames.length;
  const durMs = new Float32Array(count);
  if (anim.durations) {
    for (let i = 0; i < count; i++) durMs[i] = anim.durations[i % anim.durations.length];
  } else {
    const d = 1000 / (anim.fps || 10);
    durMs.fill(d);
  }
  const tagCodes = new Array(count).fill(null);
  if (anim.events) {
    for (const tag of Object.keys(anim.events)) {
      const v = anim.events[tag];
      for (const idx of Array.isArray(v) ? v : [v]) tagCodes[idx] = tag;
    }
  }
  const clip = { durMs, loop: !!anim.loop, tagCodes, fps0: false, count };
  Object.defineProperty(anim, '_clip', { value: clip, enumerable: false, configurable: true });
  return clip;
}

/**
 * US-041a (15.3 item 1): `sprite ?? voxel` - the single animated component
 * of an entity, whichever it has (an entity never has both - `World.spawn`
 * throws on that). Used by `EntityHandle.play`/`stop` and `stepAnimations`
 * so neither needs its own `sprite || voxel` check.
 */
export function animComponent(e) {
  const c = e.components;
  if (!c) return null;
  return c.sprite || c.voxel || null;
}

const warnedUnknownAnim = new Set();
/** `console.error` once per (model, anim) pair - EntityHandle.play's "unknown anim" rule (10.1 table). */
export function warnUnknownAnimOnce(modelKey, animName) {
  const k = `${modelKey}.${animName}`;
  if (warnedUnknownAnim.has(k)) return;
  warnedUnknownAnim.add(k);
  console.error(`animation: unknown animation "${animName}" on model "${modelKey}"`);
}

/**
 * Advances every entity's `components.sprite` by `dtMs` (fixed 60 Hz step,
 * after `stepRollers` - architecture.md 7.5 item 3). Allocation-free (the
 * warn Set above is the only thing that can grow, and only on bad data).
 * `fps: 0` clips (boulder roll, lever gear - driven by gameplay, not time)
 * are never advanced here. Events queue through `world._emit`, flushed by
 * `world.flushEvents()` after the sim step (10.1).
 */
// BUG-PERF-001 (b): `stepAnimations` used to pass a fresh `(e, id) => {...}`
// arrow literal to `world.forEachEntity` every fixed step, forever - the
// same per-step-closure class of bug fixed in `engine/physics/roller.js`
// (`stepRollers`/`resolveBodyContacts`) and BUG-PERF-001 (a)'s `stepBeacon`.
// This module's own header already claims "allocation-free" - the callback
// is now a single module-level function, created once, reading `world`/
// `dtMs` off this reused context instead of capturing them fresh per call.
const _animCtx = { world: null, dtMs: 0 };

function stepOneEntityAnim(e, id) {
  const { world, dtMs } = _animCtx;
  const comps = e.components;
  if (!comps) return;
  // US-041a (15.3 item 1): `sprite ?? voxel` - an entity never has both
  // (World.spawn throws on that), so this alone tells us which shape
  // `anim.model`/`anim.anim` resolve through (clipFor's `isVoxel`).
  const sprite = comps.sprite, voxel = comps.voxel;
  const anim = sprite || voxel;
  if (!anim || !anim.playing) return;
  const clip = clipFor(world, anim.model, anim.anim, !sprite);
  if (!clip || clip.fps0 || clip.count === 0) return;
  anim.t += dtMs * (anim.speed || 1);
  let steps = 0;
  while (anim.t >= clip.durMs[anim.frame] && steps++ < MAX_STEPS_PER_CALL) {
    anim.t -= clip.durMs[anim.frame];
    anim.frame++;
    if (anim.frame >= clip.count) {
      // `anim.loop` (set by `play()`/the spawn) is the serialized state; a
      // hand-built component without it falls back to the clip's own flag.
      if (anim.loop !== undefined ? anim.loop : clip.loop) {
        anim.frame = 0;
      } else {
        anim.frame = clip.count - 1;
        anim.t = 0;
        anim.playing = false;
        world._emit(id, 'animEnd', anim.anim);
        break;
      }
    }
    const tag = clip.tagCodes[anim.frame];
    if (tag) world._emit(id, tag, undefined);
  }
}

export function stepAnimations(world, dtMs) {
  _animCtx.world = world;
  _animCtx.dtMs = dtMs;
  world.forEachEntity(stepOneEntityAnim);
}
