// BUG-GPU-005: JS twin of terrain.frag.js's close-band feature-slot loop, run on the
// REAL packed TLOOK of overworld_far, must pick the same glyph/colour as terrainShade.js.
import { Terrain } from '../../world/Terrain.js';
import terrainDef from '../../../design/levels/overworld_far.js';
import palette from '../../../design/palette.js';
import { packTerrainTextures, TLOOK_WIDTH, MAX_FEATURES_PER_TYPE } from './TerrainTextures.js';
import { buildFeatures, hashFast01, terrainFogF } from '../terrainShade.js';
import { EDGE_FRAG_SRC } from './glsl/edge.frag.js';

globalThis.window = globalThis.window || globalThis;
terrainDef;
const recipe = globalThis.ASSETS.levels.overworld_far;
const pal = globalThis.ASSETS.palette || palette;
let fail = 0;
const t = new Terrain(recipe);
t.bakeFarSync();
const packed = packTerrainTextures(t, pal);
const feats = buildFeatures(recipe, pal);
const W = TLOOK_WIDTH;
const tl = packed.tlook;

// GLSL twin: slot loop over TLOOK texels 8+2s / 9+2s of row `type`.
function glslPick(type, cx, cy) {
  const base = type * W * 4;
  for (let s = 0; s < MAX_FEATURES_PER_TYPE; s++) {
    const a = base + (8 + s * 2) * 4;
    if (tl[a] <= 0) continue;
    const fi = tl[a + 3] | 0;
    const fh = hashFast01(cx, cy, 20 + fi);
    if (fh >= tl[a]) continue;
    const code = fh < tl[a] * 0.5 ? tl[a + 1] : tl[a + 2];
    const b = base + (9 + s * 2) * 4;
    return { code, fg: [tl[b] * 255, tl[b + 1] * 255, tl[b + 2] * 255] };
  }
  return null;
}
function jsPick(type, cx, cy) {
  for (let fi = 0; fi < feats.length; fi++) {
    const f = feats[fi];
    if (f.typeId !== type) continue;
    const fh = hashFast01(cx, cy, 20 + fi);
    if (fh >= f.chance) continue;
    return { code: fh < f.chance * 0.5 ? f.code0 : f.code1, fg: f.fg };
  }
  return null;
}
let n = 0, fired = 0;
for (let type = 0; type < packed.tlookHeight; type++) {
  for (let cx = -200; cx < 200; cx++) for (let cy = -20; cy < 20; cy++) {
    const a = glslPick(type, cx, cy), b = jsPick(type, cx, cy);
    n++;
    if (b) fired++;
    const same = (!a && !b) || (a && b && a.code === b.code && a.fg.every((v, i) => Math.abs(v - b.fg[i]) < 1e-3));
    if (!same) { if (fail++ < 5) console.error('MISMATCH', type, cx, cy, a, b); }
  }
}
console.log(`features=${feats.length} cells=${n} fired=${fired} mismatches=${fail}`);
console.log(JSON.stringify(feats.map(f => [f.typeId, f.chance, f.fg])));

// BUG-GPU-005 (actual cause of the outsideNear colour gap): edge-pass fog gate for
// terrain cells. JS stores terrainFogF in gbuf.fogF; the GLSL edge pass must use the
// same terrain fog (not the interior fog) for kind 7, else terrain edges beyond the
// interior fog-full distance vanish on the GPU only.
const F = recipe && pal.fog.far;
const chk = (name, c) => { if (!c) { fail++; console.error('FAIL:', name); } };
chk('terrainFogF(50)==0', terrainFogF(50, F) === 0);
chk('terrainFogF(1500)==1', terrainFogF(1500, F) === 1);
chk('terrainFogF(52) < 0.85 (edge gate open at 52 m)', terrainFogF(52, F) < 0.85);
chk('edge.frag gates kind 7 on terrain fog', /kind == 7u \? terrainFogF\(dist\)/.test(EDGE_FRAG_SRC));
chk('edge.frag declares terrain fog uniforms', /uniform float uTerrainFogStart, uTerrainFogFull, uTerrainFogCurve;/.test(EDGE_FRAG_SRC));
if (fail) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
