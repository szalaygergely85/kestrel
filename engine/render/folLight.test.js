// AA-16 (OB-208): folLightJS - leaf-card light smoothing (twin of WGSL folLight in shade.wgsl.js).
import assert from 'node:assert';
import { folLightJS, FOL_LIGHT_R } from './detailShade.js';
import { KIND_MESH } from './GBuffer.js';
import { SHADE_WGSL } from './gpu/wgsl/shade.wgsl.js';
import { fogShapeCtx, setFoliageLight, foliageBits } from './fogShape.js';

const cols = 7, rows = 7, N = cols * rows;
const kind = new Uint8Array(N).fill(KIND_MESH), mat = new Uint16Array(N).fill(5), soft = new Uint8Array(8); soft[5] = 1;
const depth = new Float32Array(N).fill(10), lb = new Float32Array(N * 3);
for (let i = 0; i < N; i++) { const v = (i % 2) ? 0.2 : 0.8; lb[i * 3] = v; lb[i * 3 + 1] = v; lb[i * 3 + 2] = v; } // checkerboard-ish card light
const cx = 3, cy = 3, ci = cy * cols + cx, L = new Float32Array(3);
const own = () => { L[0] = lb[ci * 3]; L[1] = lb[ci * 3 + 1]; L[2] = lb[ci * 3 + 2]; };

// 1) all soft neighbours: plain mean over the (2R+1)^2 window
own(); folLightJS(cx, cy, cols, rows, kind, mat, soft, depth, lb, L);
let s = 0, n = 0;
for (let dy = -FOL_LIGHT_R; dy <= FOL_LIGHT_R; dy++) for (let dx = -FOL_LIGHT_R; dx <= FOL_LIGHT_R; dx++) { s += lb[((cy + dy) * cols + cx + dx) * 3]; n++; }
assert.ok(Math.abs(L[0] - s / n) < 1e-6, `mean ${L[0]} vs ${s / n}`);
// 2) non-soft mats, other kinds and far depths are skipped -> own light only
const mat2 = new Uint16Array(N).fill(6); mat2[ci] = 5;
own(); folLightJS(cx, cy, cols, rows, kind, mat2, soft, depth, lb, L); assert.strictEqual(L[0], Math.fround(lb[ci * 3]), 'non-soft skipped');
const kind2 = new Uint8Array(N).fill(1); kind2[ci] = KIND_MESH;
own(); folLightJS(cx, cy, cols, rows, kind2, mat, soft, depth, lb, L); assert.strictEqual(L[0], Math.fround(lb[ci * 3]), 'other kinds skipped');
const depth2 = new Float32Array(N).fill(30); depth2[ci] = 10;
own(); folLightJS(cx, cy, cols, rows, kind, mat, soft, depth2, lb, L); assert.strictEqual(L[0], Math.fround(lb[ci * 3]), 'far depth skipped');
// 3) grid border: no out-of-range reads
L[0] = L[1] = L[2] = 0.8; folLightJS(0, 0, cols, rows, kind, mat, soft, depth, lb, L); assert.ok(Number.isFinite(L[0]));
// 4) switch + WGSL twin gated on fogView.w bit 2 and F_SOFT_EDGE, same radius
setFoliageLight(false); assert.strictEqual(fogShapeCtx.aaFolL, false); assert.strictEqual(foliageBits() & 2, 0);
setFoliageLight(true); assert.strictEqual(foliageBits() & 2, 2);
assert.ok(/fn folLight\(/.test(SHADE_WGSL) && /\(folBits & 2u\) != 0u/.test(SHADE_WGSL) && SHADE_WGSL.includes(`for (var dy = -${FOL_LIGHT_R}; dy <= ${FOL_LIGHT_R}; dy++)`));
console.log('folLight.test.js: PASS');
