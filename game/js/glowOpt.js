// EMIS-03/04 (38.12): quality preset -> WgCellPipeline `glow` option. Low/Medium: no bleed+halo pass (derived lights only); High/Ultra:
// the pass (GLOW_LEVELS). `?emissive=off|derived|full` overrides (full = High params on any level, Ultra params on ultra). Every
// `?gpucompare=` mode forces it off so the existing rows stay byte-identical (D-039); the new `glow` row builds its own.
import { GLOW_LEVELS } from '../../engine/index.js';

/** @param {URLSearchParams} params @param {string} [levelName] @returns {null|{radius:number,gain:number,haloBg:number,haloMin:number}} */
export function parseGlow(params, levelName) {
  const gc = params.get('gpucompare');
  if (gc && gc !== 'emissive') return null;
  const v = params.get('emissive');
  if (v === 'off' || v === 'derived' || v === '0') return null;
  if (v === 'full') return GLOW_LEVELS[levelName === 'ultra' ? 'ultra' : 'high'];
  if (gc === 'emissive') return GLOW_LEVELS.high;
  return GLOW_LEVELS[levelName] || null;
}
