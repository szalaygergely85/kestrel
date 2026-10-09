// GFX-01w: pure mapping from the resolved quality preset + URL params to the boot options of main.js
// (grid, rays, shadow options, gfx knobs). No DOM, no engine import: the shadow-level resolver is injected.
// Precedence per knob: explicit URL knob > ?quality= > saved > auto > 'high' (resolveQuality owns the preset part).
// `resolved` = null means "presets failed to load": boot exactly as before GFX-01w (no preset).

const GRID_RE = /^(\d+)x(\d+)$/i;
export const LEGACY_GRID = '240x90'; // the pre-preset saved/default grid (settings DEFAULT_SETTINGS.grid)
const LEGACY_INST_CAST_M = 32; // main.js default before GFX-01w (D-043); 'high' keeps it so the default look is unchanged

function numParam(params, key) {
  if (!params.has(key)) return undefined;
  const raw = params.get(key);
  if (!raw || !raw.trim()) return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * @param {object} o
 * @param {URLSearchParams} o.params
 * @param {object|null} o.resolved  resolveQuality() result or null (no presets)
 * @param {object} o.savedSettings  loadSettings() blob (uses .grid for the legacy path)
 * @param {boolean} o.captureLike   ?bench / ?voxelbench / ?gpucompare / ?cinematic / waterfall preview: stay comparable
 * @param {boolean} o.geometryCompare  ?gpucompare=1 forces 160x60 and rays 1
 * @param {number} o.defaultCols    GRID_DEFAULT_COLS
 * @param {(level:string)=>object} o.shadowLevel  resolveShadowLevel
 * @param {(msg:string)=>void} [o.warn]
 */
export function resolveBootOptions({ params, resolved, savedSettings = {}, captureLike = false, geometryCompare = false, defaultCols, shadowLevel, warn = console.warn }) {
  // Capture/bench pages without an explicit ?quality= keep today's options (comparable across runs).
  const preset = resolved && (!captureLike || params.has('quality')) ? resolved : null;
  const sources = {};

  // ---- grid ----
  let reqCols = defaultCols, reqRows, gridSource = 'default';
  let gridStr = null;
  const gridParam = params.get('grid');
  if (gridParam) {
    const m = GRID_RE.exec(gridParam.trim());
    if (m) { reqCols = Number(m[1]); reqRows = Number(m[2]); gridSource = 'param'; }
    else warn(`[grid] ?grid=${gridParam} not "WxH" - using the default ${defaultCols}`);
  }
  if (gridSource === 'default') {
    if (preset) {
      gridStr = preset.knobs.grid; gridSource = preset.knobSources.grid;
      // A non-default grid saved by the old Settings Grid row stays honoured until a quality is chosen/saved.
      if (preset.source === 'default' && savedSettings.grid && savedSettings.grid !== LEGACY_GRID) { gridStr = savedSettings.grid; gridSource = 'saved'; }
    } else if (!captureLike) { gridStr = savedSettings.grid; gridSource = 'saved'; }
    const gm = gridStr && GRID_RE.exec(gridStr);
    if (gm) { reqCols = Number(gm[1]); reqRows = Number(gm[2]); }
  }
  if (geometryCompare) {
    reqCols = 160; reqRows = 60;
    const rg = GRID_RE.exec((params.get('refgrid') || '').trim()); // dev only (BUG-WHITE-PIXELS-02): &refgrid=480x180 runs gpucompare at the owner grid; default unchanged
    if (rg) { reqCols = Number(rg[1]); reqRows = Number(rg[2]); }
  }
  sources.grid = gridSource;

  // ---- rays ----
  const rayParam = numParam(params, 'rays');
  let rays = 2, raysSource = 'default';
  if (rayParam !== undefined && rayParam >= 1 && rayParam <= 4) { rays = Math.round(rayParam); raysSource = 'param'; }
  else if (preset) { rays = preset.knobs.rays; raysSource = preset.knobSources.rays; }
  if (geometryCompare) rays = 1;
  sources.rays = raysSource;

  // ---- shadows ----
  const shadowParam = params.get('shadows');
  let level = null;
  const shadowOpts = {};
  if (preset) {
    level = preset.knobs.shadowQuality; sources.shadowQuality = preset.knobSources.shadowQuality;
    Object.assign(shadowOpts, shadowLevel(level));
    if (level === 'high') shadowOpts.instCastM = LEGACY_INST_CAST_M;
  } else {
    Object.assign(shadowOpts, { sun: 'map', instCastM: LEGACY_INST_CAST_M });
  }
  if (shadowParam === 'dda' || shadowParam === 'off' || shadowParam === 'map') shadowOpts.sun = shadowParam;
  else if (!preset) shadowOpts.sun = 'map';
  const inst = numParam(params, 'shadowinst'); if (inst !== undefined) shadowOpts.instCastM = inst;
  if (params.get('shadowres')) shadowOpts.res = Number(params.get('shadowres'));
  if (params.get('shadowcast')) shadowOpts.meshCastM = Number(params.get('shadowcast'));
  // Keep the sanity rule resolveSunShadowOptions enforces (0 < meshLod0M <= instCastM) when ?shadowinst lowers the distance.
  if (shadowOpts.meshLod0M !== undefined && shadowOpts.instCastM < shadowOpts.meshLod0M) shadowOpts.meshLod0M = shadowOpts.instCastM;

  // ---- gfx knobs (scatter density, LOD scale): preset (incl. ?scatter / ?lodScale URL knobs via resolveQuality) ----
  const gfx = preset ? { scatterDensity: preset.knobs.scatter, lodScale: preset.knobs.lodScale } : undefined;
  if (preset) { sources.scatter = preset.knobSources.scatter; sources.lodScale = preset.knobSources.lodScale; }

  return {
    reqCols, reqRows, rays, shadowOpts, gfx, gridParam, sources,
    quality: preset ? { name: preset.name, source: preset.source } : null,
    shadowLevel: level,
  };
}

/** One F3 line: `quality: high (default)  grid 400x150  rays 2  shadows high  scatter 1  lodScale 1`. */
export function describeQuality(opts, cols, rows, rays) {
  const q = opts.quality ? `${opts.quality.name} (${opts.quality.source}${opts.quality.source === 'auto' ? `: ${opts.quality.reason || 'adapter tier, benchmarking'}${opts.quality.note ? '; ' + opts.quality.note : ''}` : ''})` : 'none (presets unavailable or capture page)';
  const sun = opts.shadowOpts.sun;
  const sh = opts.shadowLevel ? (sun !== 'map' && sun !== opts.shadowLevel ? `${opts.shadowLevel}/${sun}` : opts.shadowLevel) : sun;
  const g = opts.gfx;
  return `quality: ${q}  grid ${cols}x${rows}  rays ${rays}  shadows ${sh}` + (g ? `  scatter ${g.scatterDensity}  lodScale ${g.lodScale}` : '');
}
