// POST-STACK-01c: quality preset + scene -> PostConfig (engine/render/post.js) for the composePost/postCells chain.
// `?post=0` -> null (today's frames). Bloom = the EMIS glow option exactly as parseGlow resolves it (`?emissive=`, gpucompare forcing kept).
// Every `?gpucompare=` mode except `emissive` forces post null so the existing rows stay byte-identical (D-039).
import { validatePost } from '../../../engine/index.js';
import { parseGlow } from '../glowOpt.js';

const LEVELS = ['low', 'medium', 'high', 'ultra'];

/** @param {object} look design/look/post.js default export @param {URLSearchParams} params @param {string} [levelName] @param {string} [scene] 'outdoor'|'interior'|'underwater'|'underground'
 *  @param {ArrayLike<number>|null} [ambientRgb] VISQA-11: 'underground' mist colour (level ambient, 0..1); null -> base.mist.rgb */
export function resolvePost(look, params, levelName, scene = 'outdoor', ambientRgb = null) {
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
    mist: on('mist') ? (scene === 'underground' && b.mistUnder ? underMist(b, ambientRgb) : b.mist) : null,
  };
  return validatePost(cfg);
}

/** VISQA-11: dark short mist for buried sites, coloured by the level ambient (clamped 0..1). Allocates (scene change only). */
function underMist(b, rgb) {
  const u = b.mistUnder, c = rgb && rgb.length >= 3 ? rgb : b.mist.rgb, cl = (v) => Math.min(1, Math.max(0, +v || 0));
  return { rgb: [cl(c[0]), cl(c[1]), cl(c[2])], density: u.density, start: u.start, heightK: u.heightK || 0 };
}
