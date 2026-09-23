// engine/render/gpu/sprites.test.js (US-030c). Headless Node ESM, no
// framework. Run: node engine/render/gpu/sprites.test.js
//      node --expose-gc engine/render/gpu/sprites.test.js   (also checks project()+drawSprites for heap growth)
// Covers: the pure atlas packer against design/README.md section 4
// (transparent space, emissive flag, colour round-trip, half LOD, normals),
// projection (centre column, scale vs distance, half LOD below 0.75, 3x
// cap, rect placement), the JS reference `drawSprites` (depth test,
// emissive ignores light+fog, non-emissive fogged, bg kept, nearest wins)
// and the sprite shader source rules (14.1 section 5 lexical checks).
import { AssetRegistry } from '../../core/assets.js';
import { CellBuffer } from '../CellBuffer.js';
import { DepthBuffer } from '../DepthBuffer.js';
import { buildSpriteAtlas, NORMAL_CODES } from './spritesAtlas.js';
import { SpritePool, drawSprites, lastSpriteDepth, MAX_SPRITES, SPR_STRIDE } from '../sprites.js';
import { spritesFragSrc } from './glsl/sprites.frag.js';
import paletteMod from '../../../design/palette.js';
import lanternMod from '../../../design/models/lantern.js';
import brazierMod from '../../../design/models/brazier.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; lanternMod; brazierMod;
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
const P = assets.palette;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// ---- atlas packer -------------------------------------------------------------
const atlas = buildSpriteAtlas(assets, P);
ok('atlas has lantern, brazier, beaconFire (billboards)', atlas.models.has('lantern') && atlas.models.has('brazier') && atlas.models.has('beaconFire'));
ok('atlas skips ui models (title)', !atlas.models.has('title'));
ok('atlas data size == width*height*4', atlas.data.length === atlas.width * atlas.height * 4);

function texel(fr, c, r) { const t = ((fr.y + r) * atlas.width + (fr.x + c)) * 4; return atlas.data.subarray(t, t + 4); }
function checkFrame(modelKey, lodKey, animName, fi) {
  const m = assets.model(modelKey);
  const lod = lodKey === 'half' ? m.lods.half : m;
  const entry = atlas.models.get(modelKey)[lodKey];
  const a = entry.anims.get(animName);
  const fr = atlas.frames[a.base + fi];
  const view = lod.animations[animName].frames[fi].S;
  let good = fr.w === lod.size.w && fr.h === lod.size.h;
  for (let r = 0; r < lod.size.h && good; r++) for (let c = 0; c < lod.size.w && good; c++) {
    const g = view.glyphs[r].charAt(c), k = view.fg[r].charAt(c), t = texel(fr, c, r);
    if (g === ' ' || k === ' ') { if (t[3] !== 0) good = false; continue; }
    const def = m.keys[k];
    if (t[3] !== 1) good = false;
    if (t[0] !== g.charCodeAt(0) - 32) good = false;
    if (atlas.palKeys[t[1]] !== def.c) good = false;
    if ((t[2] & 1) !== (def.e ? 1 : 0)) good = false;
    const nCh = view.n && view.n[r] ? view.n[r].charAt(c) : 'f';
    if ((t[2] >> 1) !== (NORMAL_CODES[nCh] ?? 0)) good = false;
  }
  return good;
}
ok('lantern unlit frame 0 packs cell for cell (glyph, colour, emissive, normal, transparency)', checkFrame('lantern', 'full', 'unlit', 0));
ok('lantern unlit frame 1 (glint: emissive W) packs', checkFrame('lantern', 'full', 'unlit', 1));
ok('lantern half LOD lit frame 1 packs', checkFrame('lantern', 'half', 'lit', 1));
ok('brazier burn frame 3 packs (flame all emissive, body lit)', checkFrame('brazier', 'full', 'burn', 3));
ok('brazier half LOD burn frame 5 packs', checkFrame('brazier', 'half', 'burn', 5));
ok('brazier burn has 6 frames', atlas.models.get('brazier').full.anims.get('burn').count === 6);
{
  // palette LUT round-trips rgb
  let good = true;
  for (let i = 0; i < atlas.palKeys.length; i++) {
    const c = P.rgb[atlas.palKeys[i]];
    if (atlas.pal[i * 4] !== c[0] || atlas.pal[i * 4 + 1] !== c[1] || atlas.pal[i * 4 + 2] !== c[2]) good = false;
  }
  ok('palette LUT == P.rgb for every sprite colour key', good);
  // no two frames overlap
  let overlap = false;
  for (let i = 0; i < atlas.frames.length && !overlap; i++) for (let j = i + 1; j < atlas.frames.length && !overlap; j++) {
    const a = atlas.frames[i], b = atlas.frames[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap = true;
  }
  ok('no two atlas frames overlap', !overlap);
}
{
  // a bad fg key throws with a clear message
  const bad = new AssetRegistry({ palette: P, models: { x: { billboard: true, size: { w: 1, h: 1 }, anchor: { x: 0, y: 0 }, world: { w: 1, h: 1 }, keys: {},
    animations: { a: { fps: 1, loop: true, frames: [{ S: { glyphs: ['#'], fg: ['q'] } }] } } } } });
  let msg = '';
  try { buildSpriteAtlas(bad, P); } catch (e) { msg = e.message; }
  ok('unknown fg key throws naming the model/anim/key', /x\.a\[0\].*"q"/.test(msg), msg);
}

// ---- projection ------------------------------------------------------------------
const COLS = 160, ROWS = 60;
const rt = new CellBuffer(COLS, ROWS);
rt.pxCellW = 1; rt.pxCellH = 2; // typical cell aspect
const light = [1, 1, 1];
const pool = new SpritePool(atlas, P);

function proj(x, y, z, cam) {
  pool.reset(); pool.push('lantern', 'unlit', 0, x, y, z); pool.project(cam, rt, light);
  return pool.count ? Array.from(pool.spr.subarray(0, SPR_STRIDE)) : null;
}
const camE = { x: 2.5, y: 2.5, z: 1.6, yawDeg: 90, pitchDeg: 0 }; // facing east (+x)
{
  const s = proj(6.5, 2.5, 1.6, camE); // 4 m straight ahead at eye height
  ok('straight-ahead sprite is projected', !!s);
  const x0 = s[0], w = s[2], invScale = s[4];
  const scale = 1 / invScale;
  // anchor col 1 of 3 sits at the centre column (80): x0 = 80 - 1.5*scale, rounded
  ok('straight-ahead sprite is centred on the middle column', Math.abs((x0 + 1.5 * scale) - COLS / 2) <= 0.5 + 1e-6, `x0=${x0} scale=${scale}`);
  ok('depth is the perpendicular distance (4 m)', Math.abs(s[5] - 4) < 1e-6, s[5]);
  // anchor row 3 of 4 (bottom) sits on the feet row: feet at z=1.6 == eye -> horizon row 30
  ok('feet row lands on the horizon for a sprite at eye height', Math.abs((s[1] + 4 * scale) - ROWS / 2) <= 0.5 + 1e-6, `y0=${s[1]}`);
  ok('rect width == ceil(3*scale)', w === Math.ceil(3 * scale));
  const s2 = proj(10.5, 2.5, 1.6, camE); // 8 m: half the scale, unless the LOD flips
  const scale2 = 1 / s2[4];
  const lodHalf2 = s2[10] === 3 && s2[11] === 2;
  ok('doubling the distance halves the scale (x2 back if the half LOD kicked in)', Math.abs((lodHalf2 ? scale2 / 2 : scale2) - scale / 2) < 1e-4, `${scale} -> ${scale2} half=${lodHalf2}`);
}
{
  // Half LOD below 0.75, never above 3x, and the invScale is an f32 of 1/scale
  const far = proj(40, 2.5, 1.6, camE);
  ok('far sprite uses the half LOD (atlas rect 3x2)', far && far[10] === 3 && far[11] === 2, far && `${far[10]}x${far[11]}`);
  const near = proj(2.9, 2.5, 1.6, camE);
  ok('very near sprite is capped at 3x', near && Math.abs(1 / near[4] - 3) < 1e-6, near && 1 / near[4]);
  ok('invScale is stored as f32 (fround)', near && near[4] === Math.fround(near[4]));
  ok('sprite behind the camera is culled', proj(0, 2.5, 1.6, camE) === null);
  ok('sprite far to the side (off-screen) is culled', proj(3.5, 40, 1.6, camE) === null);
}
{
  // Lateral offset moves the sprite left (camera-left = -y when facing east)
  const l = proj(6.5, 1.5, 1.6, camE), r = proj(6.5, 3.5, 1.6, camE);
  ok('left of the camera -> smaller column', l[0] < r[0], `${l[0]} vs ${r[0]}`);
  ok('lateral symmetry about the centre column', Math.abs((l[0] + l[2] / 2) + (r[0] + r[2] / 2) - COLS) <= 1.5, `${l[0]} ${r[0]}`);
}
{
  // fog + visibility
  const s = proj(6.5, 2.5, 1.6, camE);
  ok('fogF at 4 m == palette fogFactor(4)', Math.abs(s[6] - P.util.fogFactor(4)) < 1e-6);
  ok('visible flag set at ambient light', s[7] === 1);
  const dark = new SpritePool(atlas, P);
  dark.reset(); dark.push('lantern', 'unlit', 0, 6.5, 2.5, 1.6); dark.project(camE, rt, [0.01, 0.01, 0.01]);
  ok('visible flag clear below shading.cutoff', dark.spr[7] === 0);
}
{
  // MAX_SPRITES cap
  pool.reset();
  for (let i = 0; i < MAX_SPRITES + 5; i++) pool.push('lantern', 'unlit', 0, 6.5, 2.5, 1.6);
  ok('raw list caps at MAX_SPRITES and counts the drop', pool.rawCount === MAX_SPRITES && pool.dropped === 5);
}

// ---- drawSprites (JS reference) -------------------------------------------------------------
{
  const cells = new CellBuffer(COLS, ROWS);
  cells.pxCellW = 1; cells.pxCellH = 2;
  const depth = new DepthBuffer(COLS, ROWS);
  const fb = { rt: cells, depth, palette: P };
  cells.clear('#102030');
  depth.depth.fill(10); // a wall 10 m away everywhere
  pool.reset(); pool.push('lantern', 'unlit', 0, 6.5, 2.5, 1.6); pool.project(camE, cells, light);
  drawSprites(fb, pool);
  const sd = lastSpriteDepth();
  let drawn = 0, bgKept = true, glyphOk = true;
  const o = 0, x0 = pool.spr[o], y0 = pool.spr[o + 1], w = pool.spr[o + 2], h = pool.spr[o + 3], inv = pool.spr[o + 4];
  const fr = atlas.frames[atlas.models.get('lantern').full.anims.get('unlit').base];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = y * COLS + x;
    if (sd[i] === Infinity) continue;
    drawn++;
    const bi = i * 4;
    if (cells.bg[bi] !== 0x10 || cells.bg[bi + 1] !== 0x20 || cells.bg[bi + 2] !== 0x30) bgKept = false;
    const sx = Math.floor(Math.fround((x - x0) * inv)), sy = Math.floor(Math.fround((y - y0) * inv));
    const t = ((fr.y + sy) * atlas.width + (fr.x + sx)) * 4;
    if (cells.fg[bi + 3] !== atlas.data[t]) glyphOk = false;
  }
  ok('lantern draws a plausible number of cells (rect minus transparent)', drawn > 4 && drawn <= w * h, drawn);
  ok('sprite cells keep the wall bg behind them', bgKept);
  ok('sprite cells carry the atlas glyph code', glyphOk);

  // occluded: a wall at 2 m in front hides everything
  cells.clear('#000000'); depth.depth.fill(2);
  drawSprites(fb, pool);
  const sd2 = lastSpriteDepth();
  ok('a nearer wall occludes every sprite cell', sd2.every((d) => d === Infinity));

  // emissive ignores light and fog: brazier flame at 30 m (fogF > 0), dim light
  cells.clear('#000000'); depth.depth.fill(100);
  const dimL = [0.2, 0.2, 0.2];
  pool.reset(); pool.push('brazier', 'burn', 0, 32.5, 2.5, 1.0); pool.project(camE, cells, dimL);
  ok('brazier at 30 m has fogF > 0 and a half-LOD rect', pool.spr[6] > 0 && pool.spr[10] === 5);
  drawSprites(fb, pool);
  const sd3 = lastSpriteDepth();
  let emissiveFull = true, litDimmed = false, any = 0;
  const frB = atlas.frames[atlas.models.get('brazier').half.anims.get('burn').base];
  const bx0 = pool.spr[0], by0 = pool.spr[1], bw = pool.spr[2], bh = pool.spr[3], binv = pool.spr[4];
  for (let y = Math.max(0, by0); y < Math.min(ROWS, by0 + bh); y++) for (let x = Math.max(0, bx0); x < Math.min(COLS, bx0 + bw); x++) {
    const i = y * COLS + x;
    if (sd3[i] === Infinity) continue;
    any++;
    const sx = Math.floor(Math.fround((x - bx0) * binv)), sy = Math.floor(Math.fround((y - by0) * binv));
    const t = ((frB.y + sy) * atlas.width + (frB.x + sx)) * 4;
    const base = P.rgb[atlas.palKeys[atlas.data[t + 1]]];
    const bi = i * 4;
    if (atlas.data[t + 2] & 1) {
      if (cells.fg[bi] !== base[0] || cells.fg[bi + 1] !== base[1] || cells.fg[bi + 2] !== base[2]) emissiveFull = false;
    } else if (cells.fg[bi] !== base[0] || cells.fg[bi + 1] !== base[1] || cells.fg[bi + 2] !== base[2]) {
      litDimmed = true;
    }
  }
  ok('brazier half LOD drew cells', any > 0, any);
  ok('emissive flame cells are the full palette colour (light and fog ignored)', emissiveFull);
  ok('lit body cells differ from the base colour (light/fog applied)', litDimmed);

  // nearest opaque wins: two lanterns on the same cells, the nearer one drawn
  cells.clear('#000000'); depth.depth.fill(100);
  pool.reset();
  pool.push('lantern', 'lit', 0, 8.5, 2.5, 1.6);   // far first in the list
  pool.push('lantern', 'unlit', 0, 6.5, 2.5, 1.6); // near
  pool.project(camE, cells, light);
  drawSprites(fb, pool);
  const sd4 = lastSpriteDepth();
  let nearestWins = true;
  for (let i = 0; i < sd4.length; i++) if (sd4[i] !== Infinity && sd4[i] > 4.0001 && sd4[i] < 5.9999) nearestWins = false;
  ok('per cell, the nearest opaque sprite texel wins regardless of list order', nearestWins);
}

// ---- allocation check (project + drawSprites, 300 frames) -------------------------------------
{
  const cells = new CellBuffer(COLS, ROWS);
  cells.pxCellW = 1; cells.pxCellH = 2;
  const depth = new DepthBuffer(COLS, ROWS);
  depth.depth.fill(20);
  const fb = { rt: cells, depth, palette: P };
  const cam = { x: 2.5, y: 2.5, z: 1.6, yawDeg: 90, pitchDeg: 0 };
  const frame = () => {
    pool.reset();
    pool.push('brazier', 'burn', 2, 7.5, 2.5, 0); pool.push('lantern', 'unlit', 0, 6.5, 1.5, 1.3); pool.push('lantern', 'lit', 1, 16.5, 3.5, 1.3);
    pool.project(cam, cells, light);
    drawSprites(fb, pool);
  };
  if (typeof global.gc === 'function') {
    for (let i = 0; i < 30; i++) { cam.yawDeg = 85 + (i % 10); frame(); }
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 300; i++) { cam.yawDeg = 85 + (i % 10); frame(); }
    global.gc();
    const grew = process.memoryUsage().heapUsed - before;
    ok('300 frames of project()+drawSprites: no significant heap growth', grew < 256 * 1024, `grew by ${grew} bytes`);
  } else {
    for (let i = 0; i < 300; i++) frame();
    ok('300 frames of project()+drawSprites run (use --expose-gc for the heap check)', true);
  }
}

// ---- shader source rules (14.1 section 5 lexical checks, same as glsl.test.js) ---------------
for (const depthUint of [true, false]) {
  const src = spritesFragSrc({ depthUint });
  const lines = src.split('\n').filter((l) => l.includes('gl_FragCoord'));
  ok(`sprites.frag (depthUint=${depthUint}): gl_FragCoord only as ivec2(gl_FragCoord.xy)`, lines.length === 1 && /ivec2\s*\(\s*gl_FragCoord\.xy\s*\)/.test(lines[0]));
  ok(`sprites.frag (depthUint=${depthUint}): no round(`, !src.replace(/\/\/.*$/gm, '').includes('round('));
  ok(`sprites.frag (depthUint=${depthUint}): MAX_SPRITES const from sprites.js`, src.includes(`const int MAX_SPRITES = ${MAX_SPRITES};`));
  ok(`sprites.frag (depthUint=${depthUint}): depth sampler kind`, depthUint ? src.includes('uintBitsToFloat') : src.includes('uniform sampler2D uDepth'));
  ok(`sprites.frag (depthUint=${depthUint}): no EXT_color_buffer_float / std140`, !src.includes('EXT_color_buffer_float') && !src.includes('std140'));
}

console.log(`\n[sprites.test.js] ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('  FAIL: ' + f); process.exit(1); }
