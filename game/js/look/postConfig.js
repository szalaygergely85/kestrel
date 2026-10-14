// POST-STACK-01c: quality preset + scene -> PostConfig (engine/render/post.js) for the composePost/postCells chain.
// `?post=0` -> null (today's frames). Bloom = the EMIS glow option exactly as parseGlow resolves it (`?emissive=`, gpucompare forcing kept).
// Every `?gpucompare=` mode except `emissive` forces post null so the existing rows stay byte-identical (D-039).
import { validatePost } from '../../../engine/index.js';
import { parseGlow } from '../glowOpt.js';

const LEVELS = ['low', 'medium', 'high', 'ultra'];

/** @param {object} look design/look/post.js default export @param {URLSearchParams} params @param {string} [levelName] @param {string} [scene] 'outdoor'|'interior' */
export function resolvePost(look, params, levelName, scene = 'outdoor') {
  if (params.get('post') === '0') return null;
  const gc = params.get('gpucompare');
  if (gc && gc !== 'emissive') return null;
  const lv = LEVELS.includes(levelName) ? levelName : levelName === 'extreme' ? 'ultra' : 'medium';
  const pre = look.presets[lv], sc = (look.scenes && look.scenes[scene]) || {};
  const on = (k) => !!pre[k] && sc[k] !== false;
  const b = look.base;
  const cfg = {
    bloom: on('bloom') ? parseGlow(params, lv) : (params.get('emissive') === 'full' || gc === 'emissive' ? parseGlow(params, lv) : null),
    grade: on('grade') ? b.grade : null,
    vignette: on('vignette') ? b.vignette : null,
    mist: on('mist') ? b.mist : null,
  };
  return validatePost(cfg);
}
