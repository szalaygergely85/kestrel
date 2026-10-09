// ANIM-STATE-01b (US-083): resolve animState states to real model clips and drive an entity.
// Engine-neutral: no clip names live here; the game passes its own map (e.g. the boar map, see animClips.test.js).

/** Clip names of a model (voxel clips first, else sprite animations). */
export function modelClipNames(model) {
  const a = model && ((model.voxel && model.voxel.animations) || model.animations);
  return a ? Object.keys(a) : [];
}

/**
 * Bind map {state: clipName} to `animState`; throws naming the first state/clip that is missing.
 * Every state the def defines must be mapped. Sets animState.clips (state -> clip).
 */
export function bindClips(animState, model, map) {
  const names = modelClipNames(model);
  const clips = {};
  for (const st of Object.keys(animState.def.states)) {
    const c = map && map[st];
    if (!c) throw new Error(`bindClips: state "${st}" has no clip in the map`);
    if (names.indexOf(c) < 0) throw new Error(`bindClips: clip "${c}" (state "${st}") not in model (has: ${names.join(', ')})`);
    clips[st] = c;
  }
  animState.clips = clips;
  return animState;
}

/**
 * Advance `animState` by dtMs and sync the entity's animated component (sprite ?? voxel).
 * On a clip change it restarts the clip (anim/loop/frame/t/playing) and records the previous clip in
 * comp.blendFrom; comp.blend = cross-fade weight 0..1 of the new clip (BLEND_MS, view-only).
 * Frame stepping stays with stepAnimations. onEvent(eventName, stateName) is passed through.
 * Allocation-free in steady state.
 */
export function applyAnimState(entity, animState, dtMs, onEvent) {
  const comp = entity.components && (entity.components.sprite || entity.components.voxel);
  if (!comp || !animState.clips) return false;
  animState.update(dtMs, onEvent);
  const name = animState.name, clip = animState.clips[name];
  if (comp.anim !== clip) {
    comp.blendFrom = comp.anim === undefined ? clip : comp.anim;
    comp.anim = clip; comp.frame = 0; comp.t = 0; comp.playing = true;
    comp.loop = !!animState.def.states[name].loop;
  }
  comp.blend = animState.blend();
  return true;
}
