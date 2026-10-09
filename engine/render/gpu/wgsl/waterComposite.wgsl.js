// WG-3e (docs/architecture.md 32.2/35.3/35.4/36.1): WGSL port of glsl/waterComposite.frag.js (fullscreen water composite between SHADE and
// EDGE), line by line; JS twin = waterCompositeJS (engine/render/waterComposite.js) + waterLook.js (diamondAngle, flowStreakHit, packed rows).
// Deviations (mechanical): GL uniforms live in one block WaterCompositeU (uniformBlock.js layout, instance `wu`); `uGrid` = gridCols/gridRows;
// `uWL[]`/`uWFog[5]` = vec4 rows exactly like the GLSL arrays; early `return`s leave the already-written copy outputs in `o`; `a ? b : c` is
// select (pure arms only) or if/else; `%` on uint/int goes through umod (common.wgsl.js FMOD); `u32(int)` = GLSL `uint(int)`; the pitched uniform
// wrappers are written here (`fogScaleCell`). The uniform `uTimeSec` is declared but unused in the GLSL: kept in the block for plug-in parity.
// Bindings (@group(0), textureLoad only): 0 SHADE_FG rgba8, 1 SHADE_BG rgba8 (bg.a 1 shaded / 0 passthrough), 2 GI rgba32uint, 3 DEPTH r32uint,
// 4 WATER rgba32uint (x = bitcast vD, +Inf = no water), 5 LIGHT rgba32uint (w = sunlit | litCount << 8 | sunN << SUN_N_SHIFT).
// @group(1) @binding(0) = WaterCompositeU. Targets: 0 = fg rgba8 (glyph byte in .a), 1 = bg rgba8. Cell = @builtin(position).xy (no flip).
import { defineUniformBlock } from './uniformBlock.js';
import {
  GBUF_UNPACK_WGSL, FULLSCREEN_VS_WGSL, CELL_RAY_WGSL, CELL_RAY_PITCHED_WGSL, FMOD_WGSL, HASH_FAST_WGSL, BYTE_OUT_WGSL,
} from './common.wgsl.js';
import { SUN_N_SHIFT, SUN_N_MASK } from '../../shadowSun.js';
import { CLOUD_SHIFT } from '../../cloudShadow.js'; // S8-B2-12b (38.13)
import { WL_STRIDE, WL_SLOTS, WATER_HASH_SALT, WATER_FLOW_SALT, WATER_FALL_SALT, RIPPLE_MIN } from '../../waterLook.js';
import { RIPPLE_MAX, RIPPLE_HALF_W } from '../../../world/water.js'; // S8-B2-13 (38.14)

export const WATER_COMPOSITE_VECS_PER_SLOT = WL_STRIDE / 4;

export const WATER_COMPOSITE_BLOCK = defineUniformBlock('WaterCompositeU', [
  { name: 'gridCols', type: 'i32' }, { name: 'gridRows', type: 'i32' }, { name: 'sunMapOn', type: 'i32' }, { name: 'projMode', type: 'i32' },
  { name: 'sunDir', type: 'vec3' }, { name: 'ambientI', type: 'f32' },
  { name: 'sunI', type: 'f32' }, { name: 'posX', type: 'f32' }, { name: 'posY', type: 'f32' }, { name: 'eyeH', type: 'f32' },
  { name: 'dirX', type: 'f32' }, { name: 'dirY', type: 'f32' }, { name: 'planeX', type: 'f32' }, { name: 'planeY', type: 'f32' },
  { name: 'horizonRow', type: 'f32' }, { name: 'planeDistY', type: 'f32' }, { name: 'timeSec', type: 'f32' },
  { name: 'rippleCount', type: 'i32' }, // S8-B2-13 (38.14): was `pad0`, same word 19 - every later offset is unchanged
  { name: 'pitchA', type: 'vec4' }, // fX, fY, fZ, tanHalfX
  { name: 'pitchB', type: 'vec4' }, // rX, rY, uX, uY
  { name: 'pitchC', type: 'vec4' }, // uZ, tanHalfY, cosP, sinP
  { name: 'wl', type: 'vec4', count: WL_SLOTS * (WL_STRIDE / 4) }, // packed look rows, WL_STRIDE/4 vec4 per slot (waterLook.js)
  { name: 'wfog', type: 'vec4', count: 5 }, // start/full/curve/bgScale, fgNear, fgFar, bgNear, bgFar
  { name: 'ripple', type: 'vec4', count: RIPPLE_MAX }, // S8-B2-13 (38.14): x, y, r, s per live ring, densely packed
]);
export const WATER_COMPOSITE_TEXTURES = Object.freeze(['float', 'float', 'uint', 'uint', 'uint', 'uint']);
export const WATER_COMPOSITE_TARGETS = Object.freeze(['rgba8', 'rgba8']);

export const WATER_COMPOSITE_WGSL = `${WATER_COMPOSITE_BLOCK.wgsl}
@group(0) @binding(0) var uShadeFg: texture_2d<f32>;
@group(0) @binding(1) var uShadeBg: texture_2d<f32>;
@group(0) @binding(2) var uGI: texture_2d<u32>;
@group(0) @binding(3) var uDepth: texture_2d<u32>;   // R32UI bitcast<u32>(d), raw view depth
@group(0) @binding(4) var uWater: texture_2d<u32>;   // RGBA32UI: x = bitcast vD (+Inf = no water), w = slot | back << 4 | sheet << 5
@group(0) @binding(5) var uLightTex: texture_2d<u32>;
@group(1) @binding(0) var<uniform> wu: WaterCompositeU;

${GBUF_UNPACK_WGSL}
${FMOD_WGSL}
${HASH_FAST_WGSL}
${BYTE_OUT_WGSL}
${CELL_RAY_WGSL}
${CELL_RAY_PITCHED_WGSL}
${FULLSCREEN_VS_WGSL}

fn fogScaleCell(row: i32, rows: i32) -> f32 {
  return select(pitchFogScale(row, rows, wu.pitchC.y, wu.pitchC.z, wu.pitchC.w), 1.0, wu.projMode == 0);
}

// diamond angle in [0, 4), no atan; twin of waterLook.js diamondAngle
fn diamondAngle(dx: f32, dy: f32) -> f32 {
  let d = abs(dx) + abs(dy);
  if (d < 1.0e-9) { return 0.0; }
  let p = dy / d;
  return select(select(p, 4.0 + p, dy < 0.0), 2.0 - p, dx < 0.0);
}

struct FO { @location(0) fg: vec4f, @location(1) bg: vec4f };

@fragment fn fs_main(@builtin(position) frag: vec4f) -> FO {
  let cell = vec2i(frag.xy);
  let grid = vec2i(wu.gridCols, wu.gridRows);
  let sfg = textureLoad(uShadeFg, cell, 0);
  let sbg = textureLoad(uShadeBg, cell, 0);
  var o: FO;
  o.fg = sfg;
  o.bg = sbg;
  if (sbg.a < 0.5) { return o; } // JS-layer passthrough cell (HUD etc.)
  let w = textureLoad(uWater, cell, 0);
  if (w.x == 0x7f800000u) { return o; } // cleared: no water here
  let dW = bitcast<f32>(w.x);
  let isSky = giKind(textureLoad(uGI, cell, 0).y) == 0u;
  var raw = 1.0e30;
  if (!isSky) { raw = bitcast<f32>(textureLoad(uDepth, cell, 0).r); }
  if (!(dW < raw)) { return o; }

  let sheet = (w.w & 32u) != 0u;
  let lb = i32(w.w & 15u) * ${WL_STRIDE / 4};
  let r0 = wu.wl[lb]; let r1 = wu.wl[lb + 1]; let r2 = wu.wl[lb + 2]; let r3 = wu.wl[lb + 3];
  let opaqueAt = r0.w; let seeThrough = r1.w; let bgK = r3.y;
  let nGlyph = i32(r3.x);
  var a: f32;
  if (sheet) { a = wu.wl[lb + 13].w; }
  else if (isSky) { a = 1.0; }
  else { a = clamp((raw - dW) / opaqueAt, 0.0, 1.0); }

  var P: vec3f;
  if (wu.projMode == 0) { P = cellRayP(vec2f(cell), grid, wu.posX, wu.posY, wu.eyeH, wu.dirX, wu.dirY, wu.planeX, wu.planeY, wu.horizonRow, wu.planeDistY, dW); }
  else { P = cellRayPitched(vec2f(cell), grid, vec3f(wu.posX, wu.posY, wu.eyeH), wu.pitchA.xyz, wu.pitchB.xy, vec3f(wu.pitchB.zw, wu.pitchC.x), vec2f(wu.pitchA.w, wu.pitchC.y), dW); }

  var column = 1.0e30;
  if (!isSky) {
    var floorP: vec3f;
    if (wu.projMode == 0) { floorP = cellRayP(vec2f(cell), grid, wu.posX, wu.posY, wu.eyeH, wu.dirX, wu.dirY, wu.planeX, wu.planeY, wu.horizonRow, wu.planeDistY, raw); }
    else { floorP = cellRayPitched(vec2f(cell), grid, vec3f(wu.posX, wu.posY, wu.eyeH), wu.pitchA.xyz, wu.pitchB.xy, vec3f(wu.pitchB.zw, wu.pitchC.x), vec2f(wu.pitchA.w, wu.pitchC.y), raw); }
    column = max(0.0, P.z - floorP.z);
  }
  var tint = a;
  if (!isSky) { tint = min(column / wu.wl[lb + 9].z, 1.0); }

  // sun on an up normal, the terrain 'b' formula (the cell's own sun-map bits when the map ran)
  let lightT = textureLoad(uLightTex, cell, 0);
  let sunF = select(1.0, f32((lightT.w >> ${SUN_N_SHIFT}u) & ${SUN_N_MASK}u) * 0.25, wu.sunMapOn != 0);
  // S8-B2-12b (38.13): cloud-darkening byte (bits 24..31 of the floor cell's LIGHT.w) scales the sun term here too;
  // q 0 (strength 0, or a sky cell under the floor with no cloud byte written) -> cF 1.0 -> bit-identical.
  let cF = 1.0 - f32((lightT.w >> ${CLOUD_SHIFT}u) & 255u) * (1.0 / 255.0);
  let k = wu.ambientI + wu.sunI * max(wu.sunDir.z, 0.0) * sunF * cF;
  var wc = clamp((r0.rgb + (r1.rgb - r0.rgb) * tint) * k, vec3f(0.0), vec3f(255.0));

  var wb = wc * bgK; // background never receives the glint (36.1b)
  let opaque = !sheet && a >= seeThrough;
  var glyph = floor(sfg.a * 255.0 + 0.5);
  if (opaque) {
    let r9 = wu.wl[lb + 9];
    let u = (P.x * 0.8776 + P.y * 0.4794) / r3.z - r9.x;
    let v = (-P.x * 0.4794 + P.y * 0.8776) / r3.z;
    let iu = i32(floor(u)); let iv = i32(floor(v + 0.5 * f32(iu & 1)));
    let h0 = hashFastU(iu & 1023, iv & 1023, ${WATER_HASH_SALT});
    let tick = i32(floor(r9.y + f32(h0 & 255u) / 256.0));
    let h = hashFastU(iu & 1023, iv & 1023, ${WATER_HASH_SALT} + 31 * tick);
    let gi = i32(umod(h, u32(nGlyph)));
    let gv = wu.wl[lb + 4 + (gi >> 2)];
    let gc = gi & 3;
    glyph = select(select(select(gv.w, gv.z, gc == 2), gv.y, gc == 1), gv.x, gc == 0);
    // flow streaks (twin of waterLook.js flowStreakHit): r6 = (streak glyph, L, W, K), r7 = (fhat.xy, |f|, o), r8 = (mode, c.xy, nAng)
    let r6 = wu.wl[lb + 6]; let r7 = wu.wl[lb + 7]; let r8 = wu.wl[lb + 8];
    if (r8.x > 0.5) {
      var fa: f32; var fib: f32;
      if (r8.x < 1.5) {
        fa = P.x * r7.x + P.y * r7.y;
        fib = floor((-P.x * r7.y + P.y * r7.x) / r6.z);
      } else {
        let ddx = P.x - r8.y; let ddy = P.y - r8.z;
        fa = sqrt(ddx * ddx + ddy * ddy);
        fib = min(floor(diamondAngle(ddx, ddy) * 0.25 * r8.w), r8.w - 1.0);
      }
      let ia = i32(floor((fa - r7.w) / r6.y));
      let fh = hashFastU(ia & 1023, i32(fib) & 1023, ${WATER_FLOW_SALT});
      if (f32(fh >> 8u) * (1.0 / 16777216.0) > r6.w) { glyph = r6.x; }
    }
    if (f32(h >> 8u) * (1.0 / 16777216.0) > 1.0 - r3.w) { wc += (r2.rgb - wc) * 0.5; }
  }

  // S8-B2-13 (38.14): splash ripples, !sheet only (incl. see-through: replaces the floor glyph); fixed 8 with an
  // early break (uniform control flow) so rippleCount never varies the loop trip count across invocations.
  if (!sheet) {
    var rs: f32 = 0.0;
    for (var ri: i32 = 0; ri < ${RIPPLE_MAX}; ri = ri + 1) {
      if (ri >= wu.rippleCount) { break; }
      let rp = wu.ripple[ri];
      let dx = P.x - rp.x;
      let dy = P.y - rp.y;
      let d = sqrt(dx * dx + dy * dy);
      let term = rp.w * (1.0 - abs(d - rp.z) / ${RIPPLE_HALF_W});
      rs = max(rs, term);
    }
    if (rs > ${RIPPLE_MIN}) {
      let r13 = wu.wl[lb + 13];
      glyph = r13.z;
      wc += (r2.rgb - wc) * (r13.w * rs);
    }
  }

  if (sheet) {
    let lip = wu.wl[lb + 10];
    let u = (P.x - lip.x) * lip.z + (P.y - lip.y) * lip.w;
    let ia = i32(floor(u / 0.25));
    let ib = i32(floor((bitcast<f32>(w.z) - wu.wl[lb + 9].x) / 0.6));
    let h = hashFastU(ia & 1023, ib & 1023, ${WATER_FALL_SALT});
    let gi = i32(umod(h, u32(nGlyph)));
    let gv = wu.wl[lb + 4 + (gi >> 2)];
    let gc = gi & 3;
    glyph = select(select(select(gv.w, gv.z, gc == 2), gv.y, gc == 1), gv.x, gc == 0);
    let brightness = 0.6 + f32(umod(h, 3u)) * 0.2;
    wc = min(vec3f(255.0), r0.rgb * k * brightness);
    wb = wc * bgK;
    if (f32(h >> 8u) * (1.0 / 16777216.0) > 0.92) { wc = r2.rgb; }
  }
  let shape = wu.wl[lb + 10]; let foam = wu.wl[lb + 11]; let rim = wu.wl[lb + 12]; let shoreParams = wu.wl[lb + 13];
  var e: f32;
  if (rim.w > 0.5) {
    let dx = P.x - shape.x; let dy = P.y - shape.y;
    e = shape.z - sqrt(dx * dx + dy * dy);
  } else { e = min(min(P.x - shape.x, P.y - shape.y), min(shape.z - P.x, shape.w - P.y)); }
  let shoreS = max(0.0, min(column / shoreParams.x, e / wu.wl[lb + 9].w));
  let shore = !sheet && !isSky && shoreS < 1.0 && dW < shoreParams.y;
  if (shore) {
    let fi = min(i32(floor(shoreS * foam.w)), i32(foam.w) - 1);
    glyph = select(select(foam.z, foam.y, fi == 1), foam.x, fi == 0);
    wc = rim.rgb + (wc - rim.rgb) * shoreS;
  }

  // own fog (distance dW x the pitched fog scale)
  let fd = select(dW * fogScaleCell(cell.y, grid.y), dW, wu.projMode == 0);
  var f = clamp((fd - wu.wfog[0].x) / (wu.wfog[0].y - wu.wfog[0].x), 0.0, 1.0);
  if (f > 0.0 && wu.wfog[0].z != 1.0) { f = pow(f, wu.wfog[0].z); }
  let fBg = min(wu.wfog[0].w * f, 1.0);
  var fgc = wc + (wu.wfog[1].rgb + (wu.wfog[2].rgb - wu.wfog[1].rgb) * f - wc) * f;
  var bgc = wb + (wu.wfog[3].rgb + (wu.wfog[4].rgb - wu.wfog[3].rgb) * f - wb) * fBg;
  if (!opaque) { // see-through: tint the shaded floor cell by the opacity
    let fgOld = floor(sfg.rgb * 255.0 + 0.5); let bgOld = floor(sbg.rgb * 255.0 + 0.5);
    if (!shore) { fgc = fgOld + (fgc - fgOld) * a; }
    bgc = bgOld + (bgc - bgOld) * a;
  }
  o.fg = vec4f(toByte01(fgc.r), toByte01(fgc.g), toByte01(fgc.b), toByte01(glyph));
  o.bg = vec4f(toByte01(bgc.r), toByte01(bgc.g), toByte01(bgc.b), 1.0);
  return o;
}
`;
