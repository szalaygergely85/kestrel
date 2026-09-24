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
 */
export function clipFor(world, modelKey, animName) {
  if (!world.assets || !world.assets.has('model', modelKey)) return null;
  const model = world.assets.model(modelKey);
  const anim = model.animations && model.animations[animName];
  return anim ? compileClip(anim) : null;
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
export function stepAnimations(world, dtMs) {
  world.forEachEntity((e, id) => {
    const sprite = e.components && e.components.sprite;
    if (!sprite || !sprite.playing) return;
    const clip = clipFor(world, sprite.model, sprite.anim);
    if (!clip || clip.fps0 || clip.count === 0) return;
    sprite.t += dtMs * (sprite.speed || 1);
    let steps = 0;
    while (sprite.t >= clip.durMs[sprite.frame] && steps++ < MAX_STEPS_PER_CALL) {
      sprite.t -= clip.durMs[sprite.frame];
      sprite.frame++;
      if (sprite.frame >= clip.count) {
        // `sprite.loop` (set by `play()`/the spawn) is the serialized state; a
        // hand-built sprite without it falls back to the clip's own flag.
        if (sprite.loop !== undefined ? sprite.loop : clip.loop) {
          sprite.frame = 0;
        } else {
          sprite.frame = clip.count - 1;
          sprite.t = 0;
          sprite.playing = false;
          world._emit(id, 'animEnd', sprite.anim);
          break;
        }
      }
      const tag = clip.tagCodes[sprite.frame];
      if (tag) world._emit(id, tag, undefined);
    }
  });
}
