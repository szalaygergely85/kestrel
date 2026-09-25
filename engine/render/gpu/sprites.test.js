// engine/render/gpu/sprites.test.js (US-030c). Headless Node ESM, no
// framework. Run: node engine/render/gpu/sprites.test.js
//      node --expose-gc engine/render/gpu/sprites.test.js   (also checks project()+drawSprites for heap growth)
// Covers: the pure atlas packer against design/README.md section 4
// (transparent space, emissive flag, colour round-trip, half LOD, normals),
// projection (centre column, scale vs distance, half LOD below 0.75, no
// upscale cap (BUG-OWN-002), size shrinks with distance, rect placement), the JS reference `drawSprites` (depth test,
// emissive ignores light+fog, non-emissive fogged, bg kept, nearest wins)
// and the sprite shader source rules (14.1 section 5 lexical checks).
import { AssetRegistry } from '../../core/assets.js';
import { CellBuffer } from '../CellBuffer.js';
import { DepthBuffer } from '../DepthBuffer.js';
import { buildSpriteAtlas, NORMAL_CODES } from './spritesAtlas.js';
import { SpritePool, drawSprites, lastSpriteDepth, MAX_SPRITES, SPR_STRIDE, HORIZON_DEPTH } from '../sprites.js';
import { spritesFragSrc } from './glsl/sprites.frag.js';
import { World } from '../../world/World.js';
import { buildLightSet } from '../lighting.js';
import paletteMod from '../../../design/palette.js';
import lanternMod from '../../../design/models/lantern.js';
import brazierMod from '../../../design/models/brazier.js';
// US-011 (7.5 item 7): the wreck/tower packs, for the atlas/light checks
// near the end of this file. Same classic-script side-effect loading.
import leverMod from '../../../design/models/lever.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import overworldFarMod from '../../../design/levels/overworld_far.js';
// US-016: the `farTower` entity + `ferrumLights` horizon billboard world_m1.js references.
import farTowerMod from '../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../design/models/ferrum_lights.js';
// US-027b: tower/world_m1 moved to content/*.json.
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; lanternMod; brazierMod;
leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; overworldFarMod;
farTowerMod; ferrumLightsMod;
const { assets } = await loadTestAssets();
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
  ok('very near sprite is NOT capped (BUG-OWN-002: scale keeps growing)', near && 1 / near[4] > 3, near && 1 / near[4]);
  ok('invScale is stored as f32 (fround)', near && near[4] === Math.fround(near[4]));
  ok('sprite behind the camera is culled', proj(0, 2.5, 1.6, camE) === null);
  ok('sprite far to the side (off-screen) is culled', proj(3.5, 40, 1.6, camE) === null);
}
{
  // BUG-OWN-002: projected size strictly decreases with distance for every
  // prop and grid, and the full->half LOD switch never makes it grow.
  const bugGrids = [[160, 60, 12, 18], [320, 120, 6, 9]];
  for (const [c, r, pw, ph] of bugGrids) {
    const g = { cols: c, rows: r, pxCellW: pw, pxCellH: ph };
    for (const [key, an] of [['lever', 'idle'], ['brazier', 'burn'], ['lantern', 'unlit']]) {
      const cam = { x: 0, y: 0, z: 1.6, yawDeg: 90, pitchDeg: 0 };
      let prevH = Infinity, strict = true, mono = true, detail = '';
      for (const d of [1, 2, 4, 8]) {
        pool.reset(); pool.push(key, an, 0, d, 0, 1.6); pool.project(cam, g, light);
        const h = pool.count ? pool.spr[3] : -1;
        if (!(h < prevH)) { strict = false; detail += ` ${d}m:${h}>=${prevH}`; }
        prevH = h;
      }
      prevH = Infinity;
      for (let d = 1; d <= 60; d += 0.25) {
        pool.reset(); pool.push(key, an, 0, d, 0, 1.6); pool.project(cam, g, light);
        const h = pool.spr[3]; // rows only: half-tier art is not always half WIDTH (lantern 3x4 -> 3x2)
        if (h > prevH) { mono = false; detail += ` ${d}m:${h}>${prevH}`; }
        prevH = h;
      }
      ok(`${key} @${c}x${r}: rect rows strictly shrink over 1/2/4/8 m`, strict, detail);
      ok(`${key} @${c}x${r}: rect rows never grow with distance (incl. LOD switch)`, mono, detail);
    }
  }
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
  // US-017 ARCH CHANGES #1 item 1/3: GPU scene fade uniforms/textures present.
  ok(`sprites.frag (depthUint=${depthUint}): uSceneFade uniform`, src.includes('uniform float uSceneFade;'));
  ok(`sprites.frag (depthUint=${depthUint}): uFadeLut/uFadeRamp R8UI textures`, src.includes('uniform usampler2D uFadeLut;') && src.includes('uniform usampler2D uFadeRamp;'));
  ok(`sprites.frag (depthUint=${depthUint}): fade skipped when uSceneFade >= 1.0 (identity)`, /if\s*\(\s*uSceneFade\s*<\s*1\.0\s*\)/.test(src));
  // US-015 (docs/architecture.md 7.6 item 3/9): GPU scene dim uniforms present, applied after the fade block, identity-skipped.
  ok(`sprites.frag (depthUint=${depthUint}): uDimAll/uDimCount/uDimRect/uDimMul uniforms`,
    src.includes('uniform float uDimAll;') && src.includes('uniform int uDimCount;') &&
    src.includes('uniform vec4 uDimRect[4];') && src.includes('uniform float uDimMul[4];'));
  ok(`sprites.frag (depthUint=${depthUint}): dim block runs after the fade block`, src.indexOf('uDimAll < 1.0') > src.indexOf('uSceneFade < 1.0'));
  ok(`sprites.frag (depthUint=${depthUint}): dim identity guard (uDimAll<1.0 || uDimCount>0)`, /if\s*\(\s*uDimAll\s*<\s*1\.0\s*\|\|\s*uDimCount\s*>\s*0\s*\)/.test(src));
}

// ---------------------------------------------------------------------------
// US-015 (7.6 item 9): GpuSpritePass.setSceneDim copies a SceneDim into the
// per-uniform fields run() uploads (no gl needed for this part - pure data copy).
{
  const { GpuSpritePass } = await import('./spritesPass.js');
  const fakeThis = { dimAll: 1, dimCount: 0, dimRect: new Float32Array(16), dimMul: new Float32Array(4) };
  const dim = { all: 0.35, n: 2, rects: new Float32Array(20) };
  dim.rects.set([2, 2, 10, 10, 0.35, 5, 50, 8, 53, 0.18]); // rect0: x0,y0,x1,y1,mul ; rect1: same
  GpuSpritePass.prototype.setSceneDim.call(fakeThis, dim);
  ok('setSceneDim copies dimAll/dimCount', fakeThis.dimAll === 0.35 && fakeThis.dimCount === 2);
  ok('setSceneDim copies rect0 xyxy', fakeThis.dimRect[0] === 2 && fakeThis.dimRect[1] === 2 && fakeThis.dimRect[2] === 10 && fakeThis.dimRect[3] === 10);
  ok('setSceneDim copies rect1 xyxy at offset 4', fakeThis.dimRect[4] === 5 && fakeThis.dimRect[5] === 50 && fakeThis.dimRect[6] === 8 && fakeThis.dimRect[7] === 53);
  const approx = (a, b) => Math.abs(a - b) < 1e-5; // Float32Array storage - not exact vs a JS double literal
  ok('setSceneDim copies mul per rect', approx(fakeThis.dimMul[0], 0.35) && approx(fakeThis.dimMul[1], 0.18));
  ok('setSceneDim(null) is a no-op (keeps the previous frame\'s values)', (() => {
    GpuSpritePass.prototype.setSceneDim.call(fakeThis, null);
    return approx(fakeThis.dimAll, 0.35) && fakeThis.dimCount === 2;
  })());
}

// ---------------------------------------------------------------------------
// US-011 (7.5 item 7): atlas contains rope#0/#1, every tower model packs
// full+half, per-sprite light differs near vs far from the burner torch.
// The extra model/level packs (classic scripts) add onto the SAME
// `window.ASSETS` the top of this file already populated (lantern/brazier),
// so a second `AssetRegistry` built from it sees everything.
// ---------------------------------------------------------------------------
{
  const assets2 = AssetRegistry.fromGlobals(globalThis.ASSETS);
  const atlas2 = buildSpriteAtlas(assets2, assets2.palette);
  ok('atlas packs rope#0 and rope#1 (numeric variants, 7.5 item 2)', atlas2.models.has('rope#0') && atlas2.models.has('rope#1'));

  const towerProps = assets2.level('tower').props;
  let allPacked = true, missing = [];
  for (const p of towerProps) {
    if (typeof p.model === 'string' && p.model.indexOf('decal:') === 0) continue;
    if (p.from || p.to) continue;
    const key = typeof p.variant === 'number' ? `${p.model}#${p.variant}` : p.model;
    const m = atlas2.models.get(key);
    if (!m || !m.half) { allPacked = false; missing.push(key); }
  }
  ok('every tower prop model packs full + half LOD in the atlas', allPacked, missing.join(','));

  // Per-sprite light: `project(cam, rt, LightSet, world)` (7.5 item 4) -
  // a sprite right next to the burner torch (18.5, 6.5, 1.2, preset
  // 'torch', on) should be brighter than the SAME model far from every
  // light (structTable / ambient-only), same T3 slot (12..14).
  const world2 = World.load(assets2.world('world_m1'), assets2, {});
  const lights2 = buildLightSet(world2, assets2.palette);
  lights2.sun.on = false; // isolate the torch's own falloff from daylight (both points stay indoors, same tower)
  lights2.update(0, world2);
  const towerStruct = world2.structures.find((s) => s.id === 'tower');
  // `lightAt`'s sprite normal is straight up (0,0,1 - 7.5 item 4), so the
  // dot product mostly comes from the VERTICAL offset to the light, not the
  // horizontal one: sit the near sample a bit below the torch (z 1.2), not
  // level with it.
  const near = { x: towerStruct.origin.x + 18.6, y: towerStruct.origin.y + 6.5, z: towerStruct.origin.z + 0.6 };
  // The dead relay (9.0, 7.0, 6.6): same tower, ~9.5 m from the torch (preset
  // radius 6 m per D-011 reskin note) and off the `beacon`/relay light (off).
  const far = { x: towerStruct.origin.x + 9.0, y: towerStruct.origin.y + 7.0, z: towerStruct.origin.z + 6.6 };

  const cellsL = new CellBuffer(COLS, ROWS);
  cellsL.pxCellW = 1; cellsL.pxCellH = 2;
  const poolL = new SpritePool(atlas2, assets2.palette);
  const camNear = { x: near.x - 2, y: near.y, z: near.z, yawDeg: 90, pitchDeg: 0 };
  poolL.reset(); poolL.push('lantern', 'unlit', 0, near.x, near.y, near.z); poolL.project(camNear, cellsL, lights2, world2);
  const nearMul = poolL.spr[12]; // T3.r

  const camFar = { x: far.x - 2, y: far.y, z: far.z, yawDeg: 90, pitchDeg: 0 };
  poolL.reset(); poolL.push('lantern', 'unlit', 0, far.x, far.y, far.z); poolL.project(camFar, cellsL, lights2, world2);
  const farMul = poolL.spr[12];

  ok('per-sprite light near the burner torch is brighter than far from every light',
    nearMul > farMul, `near=${nearMul} far=${farMul}`);

  // -------------------------------------------------------------------------
  // US-016 D-011 addendum (architecture.md 14.4 items 13/14): world.horizon[]
  // projection (`projectHorizon`, folded into `project()`) and per-sprite fog
  // colour (SPR T4). `world2` is the real world_m1 (its one horizon entry,
  // ferrumLights, bearing 87.6 / elevDeg 1.0 / angular 13.2x2.2 / fog 0.55 /
  // fogColor 'fogFar').
  // -------------------------------------------------------------------------
  const h = world2.horizon[0];
  const ambient = [0.6, 0.6, 0.6];
  {
    poolL.reset();
    poolL.project({ x: 0, y: 0, z: 1.6, yawDeg: h.bearingDeg, pitchDeg: 0 }, cellsL, ambient, world2);
    ok('a horizon entry facing straight at its own bearing is projected (on-screen)', poolL.count === 1, poolL.count);
    const o = 0;
    const x0 = poolL.spr[o], w = poolL.spr[o + 2], invScale = poolL.spr[o + 4];
    const scale = 1 / invScale;
    ok('centred on the middle column at yaw == bearingDeg (diff 0)',
      Math.abs((x0 + w / 2) - COLS / 2) <= 1.5, `x0=${x0} w=${w}`);
    ok('horizon depth is HORIZON_DEPTH (farther than any finite scene depth)', poolL.spr[o + 5] === HORIZON_DEPTH);
    ok('unlit: colour multiplier is the flat b=1 gain (no per-sprite lightAt)',
      poolL.spr[o + 12] === poolL.spr[o + 13] && poolL.spr[o + 13] === poolL.spr[o + 14]);
    const fogRGB = assets2.palette.rgb[h.fogColor];
    ok('fog colour (T4) is the entry\'s fixed fogColor palette key, not fog.interior',
      poolL.spr[o + 16] === fogRGB[0] && poolL.spr[o + 17] === fogRGB[1] && poolL.spr[o + 18] === fogRGB[2]);
    ok('fog fraction is the entry\'s own fixed `fog` (0.55), not a distance fogFactor', Math.abs(poolL.spr[o + 6] - h.fog) < 1e-5, poolL.spr[o + 6]);
  }
  {
    // |bearing - yaw| >= 90 -> behind the camera, never wraps onto screen (item 13).
    poolL.reset();
    poolL.project({ x: 0, y: 0, z: 1.6, yawDeg: h.bearingDeg + 90, pitchDeg: 0 }, cellsL, ambient, world2);
    ok('a horizon entry >= 90 deg off yaw is skipped (no sprite row written)', poolL.count === 0, poolL.count);
  }
  {
    // Tier switch (same rule as an ordinary sprite: rowsOnScreen/full.size.h < 0.75 -> half), at two grid sizes.
    const cellsSmall = new CellBuffer(160, 60); cellsSmall.pxCellW = 1; cellsSmall.pxCellH = 2;
    const cellsBig = new CellBuffer(640, 240); cellsBig.pxCellW = 1; cellsBig.pxCellH = 2;
    const camH = { x: 0, y: 0, z: 1.6, yawDeg: h.bearingDeg, pitchDeg: 0 };
    poolL.reset(); poolL.project(camH, cellsSmall, ambient, world2);
    const smallHalf = poolL.count === 1 && poolL.spr[10] === 18 && poolL.spr[11] === 2; // atlas rect == ferrumLights half (18x2)
    poolL.reset(); poolL.project(camH, cellsBig, ambient, world2);
    const bigFull = poolL.count === 1 && poolL.spr[10] === 36 && poolL.spr[11] === 4; // atlas rect == ferrumLights full (36x4)
    ok('small grid (fewer projected rows) picks the half tier (18x2)', smallHalf, `${poolL.spr[10]}x${poolL.spr[11]}`);
    ok('large grid (more projected rows) picks the full tier (36x4)', bigFull);
  }
  {
    // Never over a finite-depth cell (item 13: "only cells with no finite depth (sky)").
    const cellsH = new CellBuffer(160, 60); cellsH.pxCellW = 1; cellsH.pxCellH = 2;
    poolL.reset();
    poolL.project({ x: 0, y: 0, z: 1.6, yawDeg: h.bearingDeg, pitchDeg: 0 }, cellsH, ambient, world2);
    const depthBuf = new DepthBuffer(160, 60);
    depthBuf.depth.fill(500); // pretend every cell already has a nearer (terrain) hit
    const gbuf = { kind: new Uint8Array(160 * 60) };
    drawSprites({ rt: cellsH, depth: depthBuf, palette: assets2.palette, gbuf }, poolL);
    const sd = lastSpriteDepth();
    ok('a horizon sprite never wins the depth test over a finite (terrain/structure) depth',
      sd.every((d) => d === Infinity));
    depthBuf.depth.fill(Infinity); // sky: no finite depth anywhere
    drawSprites({ rt: cellsH, depth: depthBuf, palette: assets2.palette, gbuf }, poolL);
    const sd2 = lastSpriteDepth();
    let any = 0; for (let i = 0; i < sd2.length; i++) if (sd2[i] !== Infinity) any++;
    ok('the same horizon sprite DOES draw once every cell is sky (depth = +Inf)', any > 0, any);
  }
  {
    // Per-sprite fog colour (T4) for an ordinary 'far'-fogModel billboard
    // (the signal tower, `farTower`) is the shadeTerrainFar gradient
    // (mix(fog.far.color, fog.far.colorFar, fogFactor(depth,'far'))), not
    // the flat `fog.interior` colour every sprite used before this story.
    // world2 also carries its usual horizon[] entry - `project()` appends it
    // AFTER every entity, so index 0 is still this pushed farTower sprite.
    poolL.reset();
    poolL.push('farTower', 'idle', 0, 100, 0, 0, { unlit: true, fogModel: 'far', fogMax: 1 });
    poolL.project({ x: 0, y: 0, z: 1.6, yawDeg: 90, pitchDeg: 0 }, cellsL, ambient, world2);
    ok('farTower billboard projects (plus world2\'s own horizon entry)', poolL.count >= 1, poolL.count);
    const depth = poolL.spr[5];
    const f0 = assets2.palette.util.fogFactor(depth, 'far');
    const near = assets2.palette.rgb[assets2.palette.fog.far.color], farC = assets2.palette.rgb[assets2.palette.fog.far.colorFar];
    const expR = near[0] + (farC[0] - near[0]) * f0, expG = near[1] + (farC[1] - near[1]) * f0, expB = near[2] + (farC[2] - near[2]) * f0;
    // float32 storage (SPR is a Float32Array) - tolerance covers the fround, not a real mismatch.
    ok('far-fogModel billboard fog colour (T4) matches the shadeTerrainFar near/far gradient',
      Math.abs(poolL.spr[16] - expR) < 1e-3 && Math.abs(poolL.spr[17] - expG) < 1e-3 && Math.abs(poolL.spr[18] - expB) < 1e-3,
      `got (${poolL.spr[16]},${poolL.spr[17]},${poolL.spr[18]}) want (${expR},${expG},${expB})`);
    ok('far-fogModel fog colour differs from the plain fog.interior colour (not the old flat approximation)',
      !(poolL.spr[16] === assets2.palette.rgb[assets2.palette.fog.interior.color][0] &&
        poolL.spr[17] === assets2.palette.rgb[assets2.palette.fog.interior.color][1]));
  }
}

console.log(`\n[sprites.test.js] ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('  FAIL: ' + f); process.exit(1); }
