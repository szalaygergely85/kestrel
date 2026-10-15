// GFX-01a: boot-time data/resolution only. B1 wires the resolved knobs into main.js.
import { GRID_VALUES } from '../settings/options.js';

export const QUALITY_NAMES = Object.freeze(['low', 'medium', 'high', 'ultra', 'extreme']);
export const HIDDEN_QUALITIES = Object.freeze(['extreme']); // HIDE-EXTREME-01 (D-107): URL-only until measured <= 8 ms RTX
export const QUALITY_CHOICES = Object.freeze([...QUALITY_NAMES.filter(n => !HIDDEN_QUALITIES.includes(n)), 'auto']);
export const SHADOW_CHOICES = Object.freeze(['off', 'low', 'mid', 'high', 'ultra']);
const KNOBS = ['grid', 'rays', 'shadowQuality', 'scatter', 'lodScale', 'pointShadows', 'carpet', 'impM', 'impMaxDistM', 'occl', 'decorDensity'];
let presets = null;

function validKnob(key, value) {
  if (key === 'grid') return GRID_VALUES.includes(value);
  if (key === 'rays') return [1, 2, 4].includes(value);
  if (key === 'shadowQuality') return SHADOW_CHOICES.includes(value);
  if (key === 'scatter') return Number.isFinite(value) && value >= 0 && value <= 1;
  if (key === 'pointShadows') return typeof value === 'boolean'; // AUD-44: preset default for point-light shadows (?pointshadows= still wins)
  if (key === 'carpet') return !!value && typeof value === 'object' && typeof value.on === 'boolean' && Number.isFinite(value.radiusScale) && value.radiusScale >= 0.25 && value.radiusScale <= 2 && Number.isFinite(value.densScale) && value.densScale >= 0 && value.densScale <= 2; // OB-103b: grass carpet {on, radiusScale, densScale} (World.setCarpetQuality)
  // R6d (38.60, D-075 step 5): tree card impostors. impM = metres where cards start (0 = off), impMaxDistM = card draw cut (> impM + 8 when on).
  // occl = R3 HZB occlusion switch slot: null = unchanged (R3 decides later), else boolean.
  if (key === 'impM') return Number.isFinite(value) && value >= 0 && value <= 500;
  if (key === 'impMaxDistM') return Number.isFinite(value) && value >= 0 && value <= 2000;
  if (key === 'decorDensity') return Number.isFinite(value) && value >= 0 && value <= 1; // ENV-01 GPU decor: fraction of the layer keep probability
  if (key === 'occl') return value === null || typeof value === 'boolean';
  return key === 'lodScale' && Number.isFinite(value) && value >= 0.25 && value <= 4;
}

/** Load once before resolving. Tests/embeds may provide the parsed data directly. */
export async function loadPresets(data = null, fetcher = globalThis.fetch) {
  if (!data) {
    const response = await fetcher(new URL('../../../content/settings/gfx-presets.json', import.meta.url));
    if (!response.ok) throw new Error(`gfx presets: HTTP ${response.status}`);
    data = await response.json();
  }
  if (data.version !== 1 || !data.presets || Object.keys(data.presets).length !== QUALITY_NAMES.length) throw new Error('gfx presets: invalid version or names');
  const next = {};
  for (const name of QUALITY_NAMES) {
    const knobs = data.presets[name];
    if (!knobs || Object.keys(knobs).length !== KNOBS.length || KNOBS.some(key => !validKnob(key, knobs[key]))) throw new Error(`gfx presets: invalid ${name}`);
    if ((knobs.impM > 0) !== (knobs.impMaxDistM > 0) || (knobs.impM > 0 && knobs.impMaxDistM <= knobs.impM + 8)) throw new Error(`gfx presets: invalid ${name} (impM/impMaxDistM)`);
    next[name] = Object.freeze({ ...knobs, carpet: Object.freeze({ ...knobs.carpet }) });
  }
  presets = Object.freeze(next);
  return presets;
}

export function knobsFor(name) {
  if (!presets) throw new Error('gfx presets: call loadPresets first');
  if (!QUALITY_NAMES.includes(name)) throw new Error(`gfx presets: unknown ${name}`);
  return { ...presets[name], carpet: { ...presets[name].carpet } };
}

function choice(value) { return typeof value === 'string' ? value.toLowerCase() : value; }

/** URL knobs override individual fields; source describes the selected preset. */
export function resolveQuality({ param = new URLSearchParams(), saved = null, auto = null, warn = console.warn } = {}) {
  const params = typeof param === 'string' ? new URLSearchParams(param) : param;
  const savedName = typeof saved === 'string' ? saved : saved?.quality;
  const autoName = typeof auto === 'string' ? auto : auto?.name;
  let name = choice(params.get('quality') ?? savedName ?? autoName ?? 'high');
  let source = params.has('quality') ? 'param' : savedName != null ? 'saved' : autoName != null ? 'auto' : 'default';
  if (name === 'auto') { name = choice(autoName ?? 'high'); source = autoName != null ? 'auto' : 'default'; }
  if (name === 'extreme' && source !== 'param') name = 'ultra'; // HIDE-EXTREME-01: saved/auto never yields hidden extreme
  if (!QUALITY_NAMES.includes(name)) { warn(`Unknown quality ${String(name)}; using high`); name = 'high'; }
  const knobs = knobsFor(name), knobSources = Object.fromEntries(KNOBS.map(key => [key, source]));
  const savedShadow = typeof saved === 'object' && saved?.shadowQuality;
  if (savedShadow) {
    if (validKnob('shadowQuality', savedShadow)) { knobs.shadowQuality = savedShadow; knobSources.shadowQuality = 'saved'; }
    else warn(`Invalid saved shadowQuality ${String(savedShadow)}; using preset`);
  }
  const savedLod = typeof saved === 'object' && saved?.lodScale; // SETTINGS-MOUNT-01: saved LOD distance (next launch)
  if (savedLod !== undefined && savedLod !== false && savedLod !== null) {
    if (validKnob('lodScale', savedLod)) { knobs.lodScale = savedLod; knobSources.lodScale = 'saved'; }
    else warn(`Invalid saved lodScale ${String(savedLod)}; using preset`);
  }
  for (const key of KNOBS) {
    if (!params.has(key) || key === 'pointShadows' || key === 'carpet' || key === 'impM' || key === 'impMaxDistM' || key === 'occl') continue; // pointShadows: lowercase ?pointshadows= handled by parsePointShadows; carpet: ?carpet=0|1 is a force switch (carpetQualityFor)
    const raw = params.get(key);
    const value = ['grid', 'shadowQuality'].includes(key) ? raw : raw.trim() ? Number(raw) : NaN;
    if (validKnob(key, value)) { knobs[key] = value; knobSources[key] = 'param'; }
    else warn(`Invalid ${key} ${String(raw)}; using resolved value`);
  }
  return { name, source, knobs, knobSources };
}

/** Adapter uses the existing settings blob. Read-back refuses a silently dropped field. */
export function saveQuality(name, adapter) {
  name = choice(name);
  if (!QUALITY_CHOICES.includes(name)) throw new Error(`Unknown quality ${String(name)}`);
  try {
    // QUALITY-STALE-01: a preset pick owns all its knobs; per-knob overrides only count if set after it
    adapter.save({ quality: name, shadowQuality: undefined, lodScale: undefined, gfxOverrides: undefined });
    return { name, saved: adapter.load().quality === name };
  } catch { return { name, saved: false }; }
}

/**
 * QUALITY-STALE-01 migration: a save with a quality but no `gfxOverrides` marker holds shadow/LOD values of unknown age;
 * drop them (owner prefers the preset). Returns the settings to use for boot.
 */
export function dropStaleOverrides(settings, adapter) {
  if (!settings || settings.quality === undefined || settings.gfxOverrides) return settings;
  if (settings.shadowQuality === undefined && settings.lodScale === undefined) return settings;
  try { adapter.save({ shadowQuality: undefined, lodScale: undefined }); } catch { /* keep going: boot just ignores them below */ }
  const { shadowQuality, lodScale, ...rest } = settings;
  return rest;
}

/**
 * OB-103b (D-075 G1): the World.setCarpetQuality() argument for a preset's carpet knob and the `?carpet=` force switch.
 * `force` '0' = off, '1' = on (preset radius/density kept); anything else = the preset decides. Pure; no preset (knobs null) = `{on: force === '1'}`
 * so capture/bench pages without ?quality= stay carpet-free exactly as before.
 * @returns {{on:boolean, radiusScale:number, densScale:number}}
 */
export function carpetQualityFor(knobs, force = null) {
  const c = knobs && knobs.carpet, f = force === null || force === undefined ? '' : String(force).trim();
  const on = f === '0' ? false : f === '1' ? true : c ? c.on : false;
  return { on, radiusScale: c ? c.radiusScale : 1, densScale: c ? c.densScale : 1 };
}

/** Whether main.js must build the carpet data at world load: any preset (so Settings can switch it on live) unless `?carpet=0`; no preset only with `?carpet=1`. */
export function carpetBuildFor(hasPreset, force = null) {
  const f = force === null || force === undefined ? '' : String(force).trim();
  return f === '0' ? false : f === '1' ? true : !!hasPreset;
}

/** OB-103b: Settings quality change -> running world, live (setCarpetQuality is read per frame by both twins; no reload). `?carpet=0|1` in the page URL still forces. Returns the applied quality or null. */
export function applyCarpetPreset(name, world, search = (globalThis.location && globalThis.location.search) || '') {
  if (!world || typeof world.setCarpetQuality !== 'function') return null;
  const q = carpetQualityFor(knobsFor(name), new URLSearchParams(search).get('carpet'));
  world.setCarpetQuality(q);
  return q;
}
