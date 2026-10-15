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
import { SUN_N_SHIFT, SUN_N_MASK, CLOUD_Q_SHIFT } from '../../shadowSun.js'; // CLOUD_Q_SHIFT: S8-B2-12c (38.13)
import { WL_STRIDE, WL_SLOTS, WATER_HASH_SALT, WATER_FLOW_SALT, WATER_FALL_SALT, RIPPLE_SLOTS, RIPPLE_ACC_MIN } from '../../waterLook.js';
import { SKY_LUT_N } from './skyLut.js';
import { WATER_REFLECT } from '../../waterReflect.js'; // AUD-42: constants shared with the JS twin
import { WF_SLOTS, WATER_FINISH_WGSL } from '../../waterFinish.js'; // WATER-FINISH-01b (38.77): finish row + reflection/caustic helpers
import { RIPPLE_SPEED, RIPPLE_W, RIPPLE_LIFE } from '../../../fx/ripples.js'; // S8-B2-13b (38.14, the note of record)

export const WATER_COMPOSITE_VECS_PER_SLOT = WL_STRIDE / 4;

export const WATER_COMPOSITE_BLOCK = defineUniformBlock('WaterCompositeU', [
  { name: 'gridCols', type: 'i32' }, { name: 'gridRows', type: 'i32' }, { name: 'sunMapOn', type: 'i32' }, { name: 'projMode', type: 'i32' },
  { name: 'sunDir', type: 'vec3' }, { name: 'ambientI', type: 'f32' },
  { name: 'sunI', type: 'f32' }, { name: 'posX', type: 'f32' }, { name: 'posY', type: 'f32' }, { name: 'eyeH', type: 'f32' },
  { name: 'dirX', type: 'f32' }, { name: 'dirY', type: 'f32' }, { name: 'planeX', type: 'f32' }, { name: 'planeY', type: 'f32' },
  { name: 'horizonRow', type: 'f32' }, { name: 'planeDistY', type: 'f32' }, { name: 'timeSec', type: 'f32' },
  { name: 'rippleCount', type: 'i32' }, // S8-B2-13b (38.14): was `pad0`, same word 19 - every later offset is unchanged
  { name: 'pitchA', type: 'vec4' }, // fX, fY, fZ, tanHalfX
  { name: 'pitchB', type: 'vec4' }, // rX, rY, uX, uY
  { name: 'pitchC', type: 'vec4' }, // uZ, tanHalfY, cosP, sinP
  { name: 'wl', type: 'vec4', count: WL_SLOTS * (WL_STRIDE / 4) }, // packed look rows, WL_STRIDE/4 vec4 per slot (waterLook.js)
  { name: 'wfog', type: 'vec4', count: 5 }, // start/full/curve/bgScale, fgNear, fgFar, bgNear, bgFar
  // S8-B2-13b (38.14): appended at the END - rippleGlyph/rippleGain (the global ripple look, lane C via `setLook`,
  // defaults in waterLook.js) + 2 pad words (align the `ripple` array to 16 B, already aligned, kept explicit).
  { name: 'rippleGlyph', type: 'u32' }, { name: 'rippleGain', type: 'f32' }, { name: 'underOn', type: 'f32' }, { name: 'ripplePad1', type: 'f32' },
  { name: 'ripple', type: 'vec4', count: RIPPLE_SLOTS }, // x, y, age, amp per live ring, densely packed
  { name: 'reflectU', type: 'vec4' }, // AUD-42: x = sky elevTop (deg; 0 = no sky LUT -> reflection off)
  { name: 'skyLut', type: 'vec4', count: SKY_LUT_N }, // AUD-42: baked sky gradient rgb (0..255), same bake as shade's uSky
  { name: 'fin', type: 'vec4', count: WF_SLOTS * 2 }, // WATER-FINISH-01b: per-slot finish row (waterFinish.js WF_STRIDE=8 = 2 vec4): (causticK, depth, R, G) (B, glyph, reflK, reflDim); all 0 = off
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
${WATER_FINISH_WGSL}

fn fogScaleCell(row: i32, rows: i32) -> f32 {
  return select(pitchFogScale(row, rows, wu.pitchC.y, wu.pitchC.z, wu.pitchC.w, wu.projMode == 2), 1.0, wu.projMode == 0);
}

// diamond angle in [0, 4), no atan; twin of waterLook.js diamondAngle
fn diamondAngle(dx: f32, dy: f32) -> f32 {
  let d = abs(dx) + abs(dy);
  if (d < 1.0e-9) { return 0.0; }
  let p = dy / d;
  return select(select(p, 4.0 + p, dy < 0.0), 2.0 - p, dx < 0.0);
}

// splash ripple accumulator at the water point (px, py): fixed 8 with an early break (uniform trip count); shared by the glyph block and the reflection wobble
fn rippleAccAt(px: f32, py: f32) -> f32 {
  var acc: f32 = 0.0;
  for (var ri: i32 = 0; ri < ${RIPPLE_SLOTS}; ri = ri + 1) {
    if (ri >= wu.rippleCount) { break; }
    let rp = wu.ripple[ri];
    let age = rp.z;
    let amp = rp.w;
    let r = ${RIPPLE_SPEED} * age;
    let dx = px - rp.x;
    let dy = py - rp.y;
    let d = sqrt(dx * dx + dy * dy);
    let band = 1.0 - abs(d - r) / ${RIPPLE_W};
    if (band > 0.0) {
      let term = amp * band * (1.0 - age / ${RIPPLE_LIFE});
      acc = max(acc, term);
    }
  }
  return acc;
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
  if (wu.underOn > 0.5) { return o; } // SWIM-04c: eye submerged = no surface composite (the shade pass's under look owns the ceiling); JS twin: compositor.js skips waterCompositeJS
  let w = textureLoad(uWater, cell, 0);
  if (w.x == 0x7f800000u) { return o; } // cleared: no water here
  let dW = bitcast<f32>(w.x);
  let isSky = giKind(textureLoad(uGI, cell, 0).y) == 0u;
  var raw = 1.0e30;
  if (!isSky) { raw = bitcast<f32>(textureLoad(uDepth, cell, 0).r); }
  if (!(dW < raw)) { return o; }

  let sheet = (w.w & 32u) != 0u;
  let ribbon = (w.w & 64u) != 0u; // RIVER-03 (38.45): river ribbon texel (w = slot | back<<4 | 1<<6 | rapidQ<<8 | e*1000<<16, z = tau)
  let lb = i32(w.w & 15u) * ${WL_STRIDE / 4};
  let finSlot = min(i32(w.w & 15u), ${WF_SLOTS - 1}); // WATER-FINISH-01b row index (slots >= WF_SLOTS read the last row, which is 0 for river/sheet)
  let r0 = wu.wl[lb]; let r1 = wu.wl[lb + 1]; let r2 = wu.wl[lb + 2]; let r3 = wu.wl[lb + 3];
  let opaqueAt = r0.w; let seeThrough = r1.w; let bgK = r3.y;
  let nGlyph = i32(r3.x);
  var a: f32;
  if (sheet) { a = wu.wl[lb + 13].w; }
  else if (isSky) { a = 1.0; }
  else { a = clamp((raw - dW) / opaqueAt, 0.0, 1.0); }

  var P: vec3f;
  if (wu.projMode == 0) { P = cellRayP(vec2f(cell), grid, wu.posX, wu.posY, wu.eyeH, wu.dirX, wu.dirY, wu.planeX, wu.planeY, wu.horizonRow, wu.planeDistY, dW); }
  else { P = cellRayPitched(vec2f(cell), grid, vec3f(wu.posX, wu.posY, wu.eyeH), wu.pitchA.xyz, wu.pitchB.xy, vec3f(wu.pitchB.zw, wu.pitchC.x), vec2f(wu.pitchA.w, wu.pitchC.y), dW, wu.projMode == 2); }

  var column = 1.0e30;
  var floorP = vec3f(0.0);
  if (!isSky) {
    if (wu.projMode == 0) { floorP = cellRayP(vec2f(cell), grid, wu.posX, wu.posY, wu.eyeH, wu.dirX, wu.dirY, wu.planeX, wu.planeY, wu.horizonRow, wu.planeDistY, raw); }
    else { floorP = cellRayPitched(vec2f(cell), grid, vec3f(wu.posX, wu.posY, wu.eyeH), wu.pitchA.xyz, wu.pitchB.xy, vec3f(wu.pitchB.zw, wu.pitchC.x), vec2f(wu.pitchA.w, wu.pitchC.y), raw, wu.projMode == 2); }
    column = max(0.0, P.z - floorP.z);
    if (!sheet) { a = clamp(max(raw - dW, column * 4.0) / opaqueAt, 0.0, 1.0); } // OB-111: path floor (twin of waterComposite.js)
  }
  // river ribbon (twin of waterComposite.js / waterLook.js riverAlpha): alpha feather by edge distance e and column; row 7 = (o, streakT, feather, shoreFade)
  var rE = 0.0; var rRapid = 0.0;
  if (ribbon) {
    rE = f32(w.w >> 16u) * 0.001; rRapid = f32((w.w >> 8u) & 255u) * (1.0 / 255.0);
    let rr7 = wu.wl[lb + 7];
    a = a * select(1.0, min(1.0, rE / rr7.z), rr7.z > 0.0) * min(1.0, column / rr7.w);
  }
  var tint = a;
  if (!isSky) { tint = min(column / wu.wl[lb + 9].z, 1.0); }

  // sun on an up normal, the terrain 'b' formula (the cell's own sun-map bits when the map ran)
  let lightT = textureLoad(uLightTex, cell, 0);
  let sunF = select(1.0, f32((lightT.w >> ${SUN_N_SHIFT}u) & ${SUN_N_MASK}u) * 0.25, wu.sunMapOn != 0);
  // S8-B2-12b (38.13): cloud-darkening byte (bits 24..31 of the floor cell's LIGHT.w) scales the sun term here too;
  // q 0 (strength 0, or a sky cell under the floor with no cloud byte written) -> cF 1.0 -> bit-identical.
  let cF = 1.0 - f32((lightT.w >> ${CLOUD_Q_SHIFT}u) & 255u) * (1.0 / 255.0);
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
    if (ribbon) {
      // river streak (twin of waterLook.js riverStreakHit): material coordinate tau / streakT - o, across by e / W
      let ra = i32(floor(bitcast<f32>(w.z) / r7.y - r7.x));
      let rb = i32(floor(rE / r6.z));
      let rh = hashFastU(ra & 1023, rb & 1023, ${WATER_FLOW_SALT});
      if (f32(rh >> 8u) * (1.0 / 16777216.0) > r6.w) { glyph = r6.x; }
      if (rRapid > 0.0 && f32(h >> 8u) * (1.0 / 16777216.0) < rRapid * r8.y) { // rapids: foam glyph + rim tint
        glyph = wu.wl[lb + 11].x;
        wc += (wu.wl[lb + 12].rgb - wc) * 0.5;
      }
    } else if (r8.x > 0.5) {
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
    // AUD-42: sky tint at the mirrored view elevation + Schlick fresnel (twin: waterReflect.js); off for ortho / no sky LUT
    if (wu.reflectU.x > 0.0 && wu.projMode != 2) {
      let rv = P - vec3f(wu.posX, wu.posY, wu.eyeH);
      let rlen = sqrt(rv.x * rv.x + rv.y * rv.y + rv.z * rv.z);
      var rc = 0.0;
      if (rlen > 1.0e-6) { rc = -rv.z / rlen; }
      rc = clamp(rc, 0.0, 1.0);
      let rm = 1.0 - rc;
      let rm2 = rm * rm;
      let rF = ${WATER_REFLECT.f0} + (1.0 - ${WATER_REFLECT.f0}) * (rm2 * rm2 * rm);
      let rt = clamp(degrees(asin(rc)) / wu.reflectU.x, 0.0, 1.0);
      let rsky = wu.skyLut[i32(floor(rt * ${SKY_LUT_N - 1}.0 + 0.5))].rgb;
      let rkS = rF * ${WATER_REFLECT.skyMix};
      let rBody = (1.0 - ${WATER_REFLECT.darken} * (1.0 - rF)) * (1.0 - rkS);
      wc = wc * rBody + rsky * rkS;
      wb = wb * rBody + rsky * rkS;
      let fin1 = wu.fin[finSlot * 2 + 1];
      if (fin1.z > 0.0) { // WATER-FINISH-01b (38.77 A): screen-space reflection of the far bank (twin of waterComposite.js)
        var rowM = -1; var colM = cell.x;
        if (wu.projMode == 0) { rowM = shearMirrorRow(wu.horizonRow, cell.y); }
        else {
          let pdx = P.x - wu.posX; let pdy = P.y - wu.posY; let pdz = -(P.z - wu.eyeH);
          let pvd = pdx * wu.pitchA.x + pdy * wu.pitchA.y + pdz * wu.pitchA.z;
          if (pvd > 1.0e-9) {
            colM = pitchedMirrorCol(pdx, pdy, pdz, pvd, wu.pitchB.x, wu.pitchB.y, wu.pitchA.w, wu.gridCols);
            rowM = pitchedMirrorRow(pdx, pdy, pdz, pvd, wu.pitchB.z, wu.pitchB.w, wu.pitchC.x, wu.pitchC.y, wu.gridRows);
          }
        }
        if (rowM >= 0 && rowM < grid.y && colM >= 0 && colM < grid.x) {
          if (wu.rippleCount > 0 && rippleAccAt(P.x, P.y) >= ${RIPPLE_ACC_MIN}) { rowM = rowM + select(-1, 1, (cell.x & 1) != 0); } // ripple wobble
          let mc = vec2i(colM, rowM);
          if (rowM >= 0 && rowM < grid.y) {
            let mwx = textureLoad(uWater, mc, 0).x;
            let mk = giKind(textureLoad(uGI, mc, 0).y);
            let md = bitcast<f32>(textureLoad(uDepth, mc, 0).r);
            if (reflAccept(rowM, grid.y, select(0u, 1u, mwx != 0x7f800000u), mk, md, dW)) {
              let rmm = min(rF * fin1.z, 1.0);
              let mcol = floor(textureLoad(uShadeBg, mc, 0).rgb * 255.0 + 0.5) * fin1.w;
              wc = wc + (mcol - wc) * rmm;
              wb = wb + (mcol - wb) * rmm;
            }
          }
        }
      }
    }
  }

  // S8-B2-13b (38.14, the note of record): splash ripples, !sheet only (incl. see-through: replaces the floor
  // glyph); fixed 8 with an early break (uniform control flow) so rippleCount never varies the loop trip count
  // across invocations. glyph/gain are a single global uniform now, not a per-slot look field.
  if (!sheet) {
    let acc = rippleAccAt(P.x, P.y);
    if (acc >= ${RIPPLE_ACC_MIN}) {
      glyph = f32(wu.rippleGlyph);
      wc = wc + (vec3f(255.0) - wc) * (acc * wu.rippleGain);
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
    // OB-045: the sheet hangs in front of the cliff, so the cliff cell's sun-map shadow bits must not darken it (white water)
    let kS = wu.ambientI + wu.sunI * cF; // foam scatters light every way: full sun term, no N.L
    wc = min(vec3f(255.0), r0.rgb * kS * brightness);
    wb = wc * bgK;
    if (f32(h >> 8u) * (1.0 / 16777216.0) > 0.92) { wc = r2.rgb; }
  }
  let shape = wu.wl[lb + 10]; let foam = wu.wl[lb + 11]; let rim = wu.wl[lb + 12]; let shoreParams = wu.wl[lb + 13];
  var e: f32;
  if (rim.w > 0.5) {
    let dx = P.x - shape.x; let dy = P.y - shape.y;
    e = shape.z - sqrt(dx * dx + dy * dy);
  } else { e = min(min(P.x - shape.x, P.y - shape.y), min(shape.z - P.x, shape.w - P.y)); }
  var shoreS = max(0.0, min(column / shoreParams.x, e / wu.wl[lb + 9].w));
  if (ribbon) { shoreS = max(0.0, min(column / shoreParams.x, 1.0)); } // 38.45: shore band by column only
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
  if (!opaque && !shore && !isSky && !sheet && wu.sunDir.z > 0.0 && wu.sunI > 0.0) { // WATER-FINISH-01b (38.77 B): shallow caustic flicker on the see-through bed
    let fin0 = wu.fin[finSlot * 2]; let fin1c = wu.fin[finSlot * 2 + 1];
    if (fin0.x > 0.0 && column < fin0.y && causticHit(floorP.x, floorP.y, wu.timeSec, fin0.x)) {
      glyph = fin1c.y;
      let kc = k * (1.0 - a);
      fgc = fgc + vec3f(fin0.z, fin0.w, fin1c.x) * kc;
    }
  }
  o.fg = vec4f(toByte01(fgc.r), toByte01(fgc.g), toByte01(fgc.b), toByte01(glyph));
  o.bg = vec4f(toByte01(bgc.r), toByte01(bgc.g), toByte01(bgc.b), 1.0);
  return o;
}
`;
