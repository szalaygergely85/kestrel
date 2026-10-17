// ENV-01c (docs/architecture.md 38.62): WGSL twin of the GPU decor scatter. The oracle is engine/mesh/decorScatter.js (ENV-01a):
// `decorHash`, `jitterCm`, `decorSpecies` and `decorCell` below TRANSLATE it (same op order, constants interpolated from its exports).
// Every keep/species/LOD/fade/carpet decision is integer (u32/i32; 32-bit multiplies go through mulU/mulI so Node's wgslProbe can use
// Math.imul, exactly the twin's semantics; in WGSL they are plain wrapping `*`). Only z (bilinear f32) is float, 1 mm tolerance.
// Compute entry `cs_decor`: one thread per lattice cell of the (side x side) square around the eye, one dispatch per gpu layer.
// Bindings (DECOR_BUFFERS): @group(0) 0 dw (read, packed words of packDecorLayers), 1 maskB (read, the layer's mask bytes packed 4/u32,
// row-major mw x mh from lattice origin ix0, iy0), 2 dfade (read, fadeCm per species, i32), 3 rows (rw, instance rows: slot = species*2 + lod01,
// row index = slot*cap + n, 16 words each, same layout as writeUnitInstance), 4 args (rw atomic, instanceCount of a slot at
// argsBase + slot*ARGS_WORDS + 1); texture 5 uNearH (r32float near-band height, the carpet sampler); @group(1) @binding(0) DecorU.
// The plane test is cull.wgsl.js's CULL_AABB_FN (shared by import; `u.planes`, `u.params.x` = R, `u.swayPad` exist here too).
// No host code here (ENV-01d). objectId: tint bits from a position hash (vegTint.js layout), never pickable (no placement index).
import { defineUniformBlock } from './uniformBlock.js';
import { CULL_AABB_FN, CULL_ARGS_WORDS } from './cull.wgsl.js';
import { INSTANCE_STRIDE } from '../../../mesh/instances.js';
import { INST_FLAG_SWAY } from '../../../mesh/sway.js';
import { VEG_MARK, VEG_VAL_SHIFT, VEG_HUE_SHIFT } from '../../../mesh/vegTint.js';
import {
  K_RANK, K_JX, K_JY, K_SPECIES, K_YAW, K_SCALE, K_FADE, KEY_MUL, FADE_Q8_MIN, FADE_Q8_SPAN, MAX_DIST_CM,
  L_SEED, L_CELL_CM, L_JIT_CM, L_DRAW_CM, L_NSPECIES, L_SPECIES_OFF, L_DENSITY_Q8, LAYER_WORDS,
  S_CUM16, S_LOD_CM, S_MAX_CM, S_FLAGS, S_SCALE_MIN, S_SCALE_MAX, S_SINK_CM, SPECIES_WORDS, SP_GRASS_LIKE, SP_SWAY,
  MASK_PROB_MASK, MASK_CARPET_BIT, O_SPECIES, O_XCM, O_YCM, O_JQX, O_JQY, O_YAWQ, O_SCALEQ, O_DIST2, DECOR_OUT_WORDS,
} from '../../../mesh/decorScatter.js';

export const DECOR_WORKGROUP = 64;
export const K_TINT = 7; // extra hash key for the tint bits (not a decision)
export const DECOR_BUFFERS = Object.freeze(['read', 'read', 'read', 'rw', 'rw']);

export const DECOR_BLOCK = defineUniformBlock('DecorU', [
  { name: 'planes', type: 'vec4', count: 6 }, // frustumPlanes() (same as CullU): inside iff a x + b y + c z + d >= 0
  { name: 'params', type: 'vec4' },           // x = R (m, instance bound), y,z,w unused
  { name: 'nearOrg', type: 'vec4' },          // x = near grid x0 (m), y = y0 (m), z = cell (m), w unused
  { name: 'swayPad', type: 'f32' },           // metres added to R in the frustum test (SWAY_MAX while sway is on)
  { name: 'eyeX', type: 'i32' },              // eye in integer cm
  { name: 'eyeY', type: 'i32' },
  { name: 'layer', type: 'u32' },
  { name: 'side', type: 'u32' },              // decorSide(packed, layer)
  { name: 'cap', type: 'u32' },               // side * side = rows per (species, LOD) slab
  { name: 'ix0', type: 'i32' },               // mask lattice origin / size
  { name: 'iy0', type: 'i32' },
  { name: 'mw', type: 'i32' },
  { name: 'mh', type: 'i32' },
  { name: 'carpetCut', type: 'i32' },         // (carpet.radiusM + 2) * 100 cm, 0 = no carpet
  { name: 'argsBase', type: 'u32' },          // first word of this layer's args slot 0
  { name: 'objectId', type: 'u32' },          // base id (tint bits OR'd in)
  { name: 'nearW', type: 'i32' },
  { name: 'nearH', type: 'i32' },
]);

const hex = (v) => '0x' + (v >>> 0).toString(16) + 'u';

export const DECOR_WGSL = `${DECOR_BLOCK.wgsl}
@group(0) @binding(0) var<storage, read> dw: array<u32>;
@group(0) @binding(1) var<storage, read> maskB: array<u32>;
@group(0) @binding(2) var<storage, read> dfade: array<i32>;
@group(0) @binding(3) var<storage, read_write> rows: array<u32>;
@group(0) @binding(4) var<storage, read_write> args: array<atomic<u32>>;
@group(0) @binding(5) var uNearH: texture_2d<f32>;
@group(1) @binding(0) var<uniform> u: DecorU;
const STRIDE: u32 = ${INSTANCE_STRIDE}u;
const ARGS_WORDS: u32 = ${CULL_ARGS_WORDS}u;
var<private> dout: array<i32, ${DECOR_OUT_WORDS}>; // decision record (decorScatter.js O_*), per invocation

${CULL_AABB_FN}
// 32-bit wrapping multiply/add (WGSL u32/i32 wrap; the Node probe maps these to Math.imul, the twin's semantics)
fn mulU(a: u32, b: u32) -> u32 { return a * b; }
fn mulI(a: i32, b: i32) -> i32 { return a * b; }
fn addU(a: u32, b: u32) -> u32 { return a + b; }
fn addI(a: i32, b: i32) -> i32 { return a + b; }

// decorScatter.js decorHash: 38.52 hashFastU keyed (ix, iy, seed + k * KEY_MUL)
fn decorHash(ix: i32, iy: i32, seed: u32, k: u32) -> u32 {
  var h: u32 = mulU(u32(ix), 0x27d4eb2du) ^ mulU(u32(iy), 0x165667b1u) ^ mulU(addU(seed, mulU(k, ${hex(KEY_MUL)})), 0x9e3779b1u);
  h = mulU(h ^ (h >> 15u), 0x85ebca6bu);
  h = mulU(h ^ (h >> 13u), 0xc2b2ae35u);
  h = h ^ (h >> 16u);
  return h;
}

// decorScatter.js jitterCm: [-jit, jit], u32 math
fn jitterCm(h: u32, jit: u32) -> i32 {
  return i32(mulU(h >> 16u, 2u * jit + 1u) >> 16u) - i32(jit);
}

// decorScatter.js decorSpecies: first species whose cum16 > sp16
fn decorSpecies(o: u32, sp16: u32) -> u32 {
  let ns = dw[o + ${L_NSPECIES}u];
  let so = dw[o + ${L_SPECIES_OFF}u];
  var i: u32 = 0u;
  while (i < ns - 1u && sp16 >= dw[so + i * ${SPECIES_WORDS}u + ${S_CUM16}u]) { i = i + 1u; }
  return i;
}

// decorScatter.js decorCell. Returns 0 none, 1 LOD0, 2 LOD1; on 1|2 fills dout (O_SPECIES, O_XCM, O_YCM, O_JQX, O_JQY, O_YAWQ, O_SCALEQ, O_DIST2).
fn decorCell(layer: u32, ix: i32, iy: i32, maskByte: u32, eyeX: i32, eyeY: i32, carpetCutIn: i32) -> u32 {
  let carpetCut = min(carpetCutIn, ${MAX_DIST_CM}); // clamped to the same max as fadeLim
  let o = 2u + layer * ${LAYER_WORDS}u;
  let prob = maskByte & ${MASK_PROB_MASK}u;
  if (prob == 0u) { return 0u; }
  let seed = dw[o + ${L_SEED}u];
  var eff = (prob * dw[o + ${L_DENSITY_Q8}u]) >> 8u;
  if (eff > ${MASK_PROB_MASK}u) { eff = ${MASK_PROB_MASK}u; }
  if (mulU(decorHash(ix, iy, seed, ${K_RANK}u) >> 16u, 127u) >= (eff << 16u)) { return 0u; }
  let cell = dw[o + ${L_CELL_CM}u];
  let jit = dw[o + ${L_JIT_CM}u];
  let jqx = jitterCm(decorHash(ix, iy, seed, ${K_JX}u), jit);
  let jqy = jitterCm(decorHash(ix, iy, seed, ${K_JY}u), jit);
  let xcm = addI(mulI(ix, i32(cell)), jqx);
  let ycm = addI(mulI(iy, i32(cell)), jqy);
  let dx = xcm - eyeX;
  let dy = ycm - eyeY;
  let draw = i32(dw[o + ${L_DRAW_CM}u]);
  if (abs(dx) >= draw || abs(dy) >= draw) { return 0u; } // per-axis reject BEFORE squaring (arch 2026-10-14): accepted d2 stays exact in i32
  let d2 = addI(mulI(dx, dx), mulI(dy, dy));
  if (d2 >= mulI(draw, draw)) { return 0u; }
  let sp = decorSpecies(o, decorHash(ix, iy, seed, ${K_SPECIES}u) >> 16u);
  let p = dw[o + ${L_SPECIES_OFF}u] + sp * ${SPECIES_WORDS}u;
  let maxCm = i32(dw[p + ${S_MAX_CM}u]);
  if (d2 >= mulI(maxCm, maxCm)) { return 0u; }
  // footprint fade: one fixed distance per placement; fadeLim clamped to ${MAX_DIST_CM} cm (the twin's lim^2 stays exact in i32)
  let fq = ${FADE_Q8_MIN}u + (((decorHash(ix, iy, seed, ${K_FADE}u) >> 24u) * ${FADE_Q8_SPAN}u) >> 8u);
  var fadeLim = i32((u32(dfade[sp]) * fq) >> 8u);
  if (fadeLim > ${MAX_DIST_CM}) { fadeLim = ${MAX_DIST_CM}; }
  if (d2 >= mulI(fadeLim, fadeLim)) { return 0u; }
  // carpet hand-off: grass-like species yield to the carpet inside radius + 2 m
  if ((maskByte & ${MASK_CARPET_BIT}u) != 0u && (dw[p + ${S_FLAGS}u] & ${SP_GRASS_LIKE}u) != 0u && d2 < mulI(carpetCut, carpetCut)) { return 0u; }
  dout[${O_SPECIES}] = i32(sp); dout[${O_XCM}] = xcm; dout[${O_YCM}] = ycm; dout[${O_JQX}] = jqx; dout[${O_JQY}] = jqy;
  dout[${O_YAWQ}] = i32(decorHash(ix, iy, seed, ${K_YAW}u) >> 24u); dout[${O_SCALEQ}] = i32(decorHash(ix, iy, seed, ${K_SCALE}u) >> 24u); dout[${O_DIST2}] = d2;
  let lod = i32(dw[p + ${S_LOD_CM}u]);
  if (d2 >= mulI(lod, lod)) { return 2u; }
  return 1u;
}

fn nearTexel(i: i32, j: i32) -> f32 { return textureLoad(uNearH, vec2i(i, j), 0).x; }
// near-band height, bilinear (carpet.wgsl.js ground(), same op order; edge value outside the grid)
fn decorGround(x: f32, y: f32) -> f32 {
  let fx = (x - u.nearOrg.x) / u.nearOrg.z - 0.5;
  let fy = (y - u.nearOrg.y) / u.nearOrg.z - 0.5;
  let i = clamp(i32(floor(fx)), 0, u.nearW - 2);
  let j = clamp(i32(floor(fy)), 0, u.nearH - 2);
  let tu = clamp(fx - f32(i), 0.0, 1.0);
  let tv = clamp(fy - f32(j), 0.0, 1.0);
  let a = nearTexel(i, j); let b = nearTexel(i + 1, j); let c = nearTexel(i, j + 1); let d = nearTexel(i + 1, j + 1);
  return a + (b - a) * tu + (c - a) * tv + (a - b - c + d) * tu * tv;
}

// floor division (Math.floor(a / b), b > 0; WGSL i32 '/' truncates toward zero: wrong for negative eye coordinates)
fn floorDivI(a: i32, b: i32) -> i32 {
  var q = a / b;
  if (a - q * b < 0) { q = q - 1; }
  return q;
}

fn maskByteAt(i: u32) -> u32 { return (maskB[i >> 2u] >> ((i & 3u) * 8u)) & 255u; }

// scale from the 8-bit step (decorScatter.js decorScale; float, not a decision)
fn decorScaleW(p: u32, q: u32) -> f32 {
  let smin = f32(dw[p + ${S_SCALE_MIN}u]);
  let smax = f32(dw[p + ${S_SCALE_MAX}u]);
  return (smin + (smax - smin) * f32(q) / 255.0) / 1000.0;
}

// per-species row facts (decorScatter.js S_SINK_CM / SP_SWAY): z sinks into the ground, only swaying species get INST_FLAG_SWAY
fn decorSinkZ(z: f32, p: u32) -> f32 { return z - f32(dw[p + ${S_SINK_CM}u]) * 0.01; }
fn decorRowFlags(p: u32) -> u32 {
  if ((dw[p + ${S_FLAGS}u] & ${SP_SWAY}u) != 0u) { return ${INST_FLAG_SWAY}u; }
  return 0u;
}

@compute @workgroup_size(${DECOR_WORKGROUP})
fn cs_decor(@builtin(global_invocation_id) gid: vec3u) {
  let t = gid.x;
  if (t >= u.cap) { return; }
  let row = t / u.side;
  let col = t - row * u.side;
  let half = i32((u.side - 1u) >> 1u);
  let cellCm = i32(dw[2u + u.layer * ${LAYER_WORDS}u + ${L_CELL_CM}u]);
  let ix = floorDivI(u.eyeX, cellCm) - half + i32(col);
  let iy = floorDivI(u.eyeY, cellCm) - half + i32(row);
  let mx = ix - u.ix0;
  let my = iy - u.iy0;
  if (mx < 0 || my < 0 || mx >= u.mw || my >= u.mh) { return; }
  let r = decorCell(u.layer, ix, iy, maskByteAt(u32(my * u.mw + mx)), u.eyeX, u.eyeY, u.carpetCut);
  if (r == 0u) { return; }
  let o = 2u + u.layer * ${LAYER_WORDS}u;
  let sp = u32(dout[${O_SPECIES}]);
  let p = dw[o + ${L_SPECIES_OFF}u] + sp * ${SPECIES_WORDS}u;
  let x = f32(dout[${O_XCM}]) * 0.01;
  let y = f32(dout[${O_YCM}]) * 0.01;
  let z = decorSinkZ(decorGround(x, y), p);
  if (aabbOutside(x, y, z)) { return; }
  let seed = dw[o + ${L_SEED}u];
  let slot = sp * 2u + (r - 1u);
  let n = atomicAdd(&args[u.argsBase + slot * ARGS_WORDS + 1u], 1u); // cap = lattice size: cannot overflow
  let sc = decorScaleW(p, u32(dout[${O_SCALEQ}]));
  let ang = f32(dout[${O_YAWQ}]) * (6.2831855 / 256.0);
  let c = cos(ang) * sc;
  let s = sin(ang) * sc;
  let th = decorHash(ix, iy, seed, ${K_TINT}u);
  let id = u.objectId | ${VEG_MARK}u | ((th & 7u) << ${VEG_VAL_SHIFT}u) | (((th >> 8u) & 7u) << ${VEG_HUE_SHIFT}u);
  let b = (slot * u.cap + n) * STRIDE;
  rows[b] = bitcast<u32>(c); rows[b + 1u] = bitcast<u32>(-s); rows[b + 2u] = 0u; rows[b + 3u] = bitcast<u32>(x);
  rows[b + 4u] = bitcast<u32>(s); rows[b + 5u] = bitcast<u32>(c); rows[b + 6u] = 0u; rows[b + 7u] = bitcast<u32>(y);
  rows[b + 8u] = 0u; rows[b + 9u] = 0u; rows[b + 10u] = bitcast<u32>(sc); rows[b + 11u] = bitcast<u32>(z);
  rows[b + 12u] = id; rows[b + 13u] = decorRowFlags(p); rows[b + 14u] = 0u; rows[b + 15u] = 0u;
}
`;
