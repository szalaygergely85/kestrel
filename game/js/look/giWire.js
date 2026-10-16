// GI-PROBE-06 (arch 38.72): game wiring of the baked probe field. Pure helpers; engine does the sampling/upload.
// `?gi=0` = never created (today's frames); `?gi=1` forces on; gpucompare modes = off (rows carry their own fields).
import { createGIState, mixGIState } from '../../../engine/index.js';

/** Preset data (owner look decides later): off at low, on at medium and up. No preset (unknown name) = off unless ?gi=1. */
export const GI_PRESET = { low: false, medium: true, high: true, ultra: true, extreme: true };
export const GI_DEFAULTS = { emisK: 1, skyFloor: 0.15 };

/** -> null (feature off) or {emisK, skyFloor}. */
export function resolveGI(params, quality, wgActive = true) {
  if (!wgActive) return null; // GI-PROBE-06-FIX: WebGPU only; the JS twin (+3.3 ms at 240x90) is oracle-only, so Canvas2D/WebGL2 keep today's ambient
  const f = params.get('gi');
  if (f === '0' || params.get('gpucompare')) return null;
  const on = f === '1' ? true : quality && GI_PRESET[quality] === true;
  return on ? { ...GI_DEFAULTS } : null;
}

/**
 * Binds one GI state to the world/LightSet. `clock(hour, moon)` is called on hour change (clock driver step, ~1/s),
 * `sync()` per frame is a pointer compare only. LightSet.gi stays null until a field exists (missing files = old path).
 */
export function createGIWire(cfg, world, lights) {
  const st = createGIState(); st.on = true; let hour = 12, moon = false, ready = false;
  const sky = [0, 0, 0], sun = [0, 0, 0];
  const mix = () => {
    for (let i = 0; i < 3; i++) { sky[i] = lights.ambient[i]; sun[i] = lights.sun.col[i]; }
    mixGIState(st, hour, sky, sun, { night: moon, emisK: cfg.emisK, skyFloor: cfg.skyFloor });
  };
  return {
    st,
    clock(h, isMoon) { hour = h; moon = !!isMoon; ready = true; if (st.field) mix(); },
    sync() {
      const f = world.giField || null;
      if (f === st.field) return;
      st.field = f; lights.gi = f ? st : null;
      if (f && ready) mix();
    },
  };
}

/**
 * GI-PROBE-07: loader options for World.loadGI. Fetches content/gi/manifest.json {zone: inputHash} once; missing/bad = {} (no hash check, quiet).
 * A zone whose baked file does not match its manifest hash is ignored by the loader (one plain console note, field stays null).
 */
export async function giLoadOptions(fetchText, url = 'content/gi/manifest.json') {
  let m = null;
  try { const t = await fetchText(url); m = t ? JSON.parse(t) : null; } catch { m = null; }
  if (!m || typeof m !== 'object') return {};
  return { expectHash: (id) => (typeof m[id] === 'string' ? m[id] : null) };
}
