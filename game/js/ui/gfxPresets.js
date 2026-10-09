// GFX-01a: boot-time data/resolution only. B1 wires the resolved knobs into main.js.
import { GRID_VALUES } from '../settings/options.js';

export const QUALITY_NAMES = Object.freeze(['low', 'medium', 'high', 'ultra']);
export const QUALITY_CHOICES = Object.freeze([...QUALITY_NAMES, 'auto']);
export const SHADOW_CHOICES = Object.freeze(['off', 'low', 'mid', 'high']);
const KNOBS = ['grid', 'rays', 'shadowQuality', 'scatter', 'lodScale'];
let presets = null;

function validKnob(key, value) {
  if (key === 'grid') return GRID_VALUES.includes(value);
  if (key === 'rays') return [1, 2, 4].includes(value);
  if (key === 'shadowQuality') return SHADOW_CHOICES.includes(value);
  if (key === 'scatter') return Number.isFinite(value) && value >= 0 && value <= 1;
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
    next[name] = Object.freeze({ ...knobs });
  }
  presets = Object.freeze(next);
  return presets;
}

export function knobsFor(name) {
  if (!presets) throw new Error('gfx presets: call loadPresets first');
  if (!QUALITY_NAMES.includes(name)) throw new Error(`gfx presets: unknown ${name}`);
  return { ...presets[name] };
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
    if (!params.has(key)) continue;
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
    adapter.save({ quality: name });
    return { name, saved: adapter.load().quality === name };
  } catch { return { name, saved: false }; }
}
