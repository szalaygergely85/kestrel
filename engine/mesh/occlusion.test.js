// S8-B2-10a: occlusion twin tests (superset rule, wall/peek, fast turn, disocclusion, invalid HZB, zero alloc).
import assert from 'node:assert/strict';
import { buildHzb } from './hzb.js';
import { projectAabbRect, hzbMipPick, aabbOccluded, nearDepth, instanceOccluded, occlusionPass, createRect } from './occlusion.js';

let seed = 77; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const W = 96, H = 54;

// pinhole camera at `eye`, yaw about +Y (0 looks down -Z), column-major viewProj (clip.w = view depth)
function cam(eye, yaw, fovY = 1.0) {
  const fwd = [Math.sin(yaw) * -1 * -1 * 0 + Math.sin(yaw), 0, -Math.cos(yaw)], right = [Math.cos(yaw), 0, Math.sin(yaw)], up = [0, 1, 0];
  const f = 1 / Math.tan(fovY / 2), a = W / H, n = 0.1, fa = 500;
  const row = (v, tx) => [...v, -(v[0] * eye[0] + v[1] * eye[1] + v[2] * eye[2])];
  const rR = row(right), rU = row(up), rF = row(fwd);
  const m = (r, k) => r[k];
  const vp = new Float64Array(16); // rows of clip: x = f/a * right.p, y = f * up.p, z = ..., w = fwd.p
  const rows = [rR.map((v) => v * f / a), rU.map((v) => v * f), rF.map((v) => v * (fa + n) / (fa - n)), rF];
  rows[2][3] -= 2 * fa * n / (fa - n);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) vp[c * 4 + r] = m(rows[r], c);
  return { vp, eye, fwd, right, up, f, a, hzbOn: 1, hzbW: W, hzbH: H, margin: 0.05 };
}
// depth buffer (view-z) of vertical wall quads on planes z = zw (x in [x0,x1], y in [y0,y1]); +Inf elsewhere
function depthOf(c, walls) {
  const d = new Float32Array(W * H).fill(Infinity);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = ((x + 0.5) / W * 2 - 1) * c.a / c.f, ny = (1 - (y + 0.5) / H * 2) / c.f; // ray = fwd + nx*right + ny*up
    const dir = [c.fwd[0] + nx * c.right[0], ny, c.fwd[2] + nx * c.right[2]];
    for (const w of walls) {
      if (Math.abs(dir[2]) < 1e-9) continue;
      const t = (w.z - c.eye[2]) / dir[2]; if (t <= 0) continue;
      const px = c.eye[0] + t * dir[0], py = c.eye[1] + t * dir[1];
      if (px >= w.x0 && px <= w.x1 && py >= w.y0 && py <= w.y1) d[y * W + x] = Math.min(d[y * W + x], Math.fround(t * (dir[0] * c.fwd[0] + dir[2] * c.fwd[2])));
    }
  }
  return d;
}
// brute force: exact f64 projection, every level-0 texel the cube touches, nearest sphere depth, no mip/margin
function bruteOccluded(c, d0, t, R) {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (let k = 0; k < 8; k++) {
    const p = [t[0] + (k & 1 ? R : -R), t[1] + (k & 2 ? R : -R), t[2] + (k & 4 ? R : -R)];
    const w = c.vp[3] * p[0] + c.vp[7] * p[1] + c.vp[11] * p[2] + c.vp[15]; if (w <= 1e-6) return false;
    const sx = ((c.vp[0] * p[0] + c.vp[4] * p[1] + c.vp[8] * p[2] + c.vp[12]) / w * 0.5 + 0.5) * W, sy = (0.5 - (c.vp[1] * p[0] + c.vp[5] * p[1] + c.vp[9] * p[2] + c.vp[13]) / w * 0.5) * H;
    mnx = Math.min(mnx, sx); mxx = Math.max(mxx, sx); mny = Math.min(mny, sy); mxy = Math.max(mxy, sy);
  }
  const zNear = (t[0] - c.eye[0]) * c.fwd[0] + (t[1] - c.eye[1]) * c.fwd[1] + (t[2] - c.eye[2]) * c.fwd[2] - R;
  for (let y = Math.max(0, Math.floor(mny)); y <= Math.min(H - 1, Math.floor(mxy)); y++)
    for (let x = Math.max(0, Math.floor(mnx)); x <= Math.min(W - 1, Math.floor(mxx)); x++) if (!(zNear > d0[y * W + x])) return false;
  return true;
}
const test = (c, levels, t, R, sway = 0) => instanceOccluded(c, levels, t[0], t[1], t[2], R, sway);

// --- wall-occluded box culled, peeking box kept, sky never occludes
{
  const c = cam([0, 0, 0], 0), wall = { z: -10, x0: -5, x1: 5, y0: -9, y1: 9 }; // taller than the frustum: no sky rows at the bottom
  const lv = buildHzb(depthOf(c, [wall]), W, H);
  assert.equal(test(c, lv, [0, 0, -30], 1), true, 'box behind wall culled');
  assert.equal(test(c, lv, [0, 0, -5], 1), false, 'box in front of wall kept');
  assert.equal(test(c, lv, [15, 0, -30], 1), false, 'box peeking past the wall edge kept');
  assert.equal(test(c, lv, [25, 0, -30], 1), false, 'box beside the wall (sky behind) kept');
  const sky = buildHzb(new Float32Array(W * H).fill(Infinity), W, H);
  assert.equal(test(c, sky, [0, 0, -30], 1), false, '+Inf never occludes');
  assert.equal(test(c, lv, [0, 0, 20], 1), false, 'behind the eye -> visible');
  assert.equal(test(c, lv, [0, 0, -0.5], 1), false, 'eye inside the sphere (zN <= 0) -> visible');
  assert.equal(test({ ...c, hzbOn: 0 }, lv, [0, 0, -30], 1), false, 'hzbOn 0 never culls');
  assert.equal(test(c, lv, [0, 0, -12], 1.5, 0), true, 'just behind wall, no sway: culled');
  assert.equal(test(c, lv, [0, 0, -12], 1.5, 2.0), false, 'sway pad grows R and brings zN in front of wall: kept');
}

// --- superset rule on random scenes: twin occluded => brute occluded
{
  let culled = 0, total = 0;
  for (let s = 0; s < 60; s++) {
    const c = cam([rnd() * 10 - 5, rnd() * 4, rnd() * 10], (rnd() - 0.5) * 2);
    const walls = []; for (let k = 0; k < 4; k++) { const x = rnd() * 40 - 20, y = rnd() * 6 - 3; walls.push({ z: -rnd() * 40 - 3, x0: x, x1: x + rnd() * 20 + 2, y0: y, y1: y + rnd() * 8 + 2 }); }
    const d0 = depthOf(c, walls), lv = buildHzb(d0, W, H);
    for (let i = 0; i < 80; i++) {
      const t = [rnd() * 60 - 30, rnd() * 10 - 3, -rnd() * 90 + 10], R = 0.3 + rnd() * 3, sway = rnd() < 0.3 ? 1 : 0;
      total++;
      if (test(c, lv, t, R, sway)) { culled++; assert.ok(bruteOccluded(c, d0, t, R + sway), `wrongly culled scene ${s} inst ${i}`); }
    }
  }
  assert.ok(culled > 100, `random scenes cull something (${culled}/${total})`);
  console.log(`superset: ${culled}/${total} culled, all inside brute-force occluded`);
}

// --- mip pick
{
  const r = createRect();
  r.set([3, 3, 4, 4]); assert.equal(hzbMipPick(r, 7), 0, '2x2 texels at L0');
  r.set([3, 3, 5, 5]); assert.equal(hzbMipPick(r, 7), 1);
  r.set([0, 0, 95, 53]); assert.equal(hzbMipPick(r, 4), 3, 'clamped to levels - 1');
}

// --- regression: rect rows beyond a 1-row top level must clamp (empty loop used to read as occluded)
{
  const lv = buildHzb(new Float32Array(W * H).fill(Infinity), W, H), r = createRect(); r.set([50, 33, 95, 53]);
  assert.equal(aabbOccluded(lv, W, H, r, 6.4), false, 'all-sky HZB with a rect below the top level rows stays visible');
}

// --- fast turn + disocclusion: phase1 (previous HZB) U phase2 (current HZB) is a superset of the truly visible set
{
  const stride = 16, n = 400, g = { count: n, ib: { f32: new Float32Array(n * stride) } };
  for (let i = 0; i < n; i++) { const o = i * stride; g.ib.f32[o + 3] = rnd() * 80 - 40; g.ib.f32[o + 7] = rnd() * 6 - 2; g.ib.f32[o + 11] = rnd() * 80 - 40; }
  const R = 1, occl = new Uint32Array(n), out = { visible: new Uint32Array(n), pending: new Uint32Array(n), nVisible: 0, nPending: 0 };
  const walls = [{ z: -8, x0: -30, x1: 30, y0: -10, y1: 10 }];
  const seqs = [
    { name: 'fast turn', prev: cam([0, 0, 0], 0), cur: cam([0, 0, 0], Math.PI / 2), wallsPrev: walls, wallsCur: walls },
    { name: 'disocclusion', prev: cam([0, 0, 0], 0), cur: cam([0, 0, 0], 0), wallsPrev: walls, wallsCur: [] },
  ];
  for (const sq of seqs) {
    const lvPrev = buildHzb(depthOf(sq.prev, sq.wallsPrev), W, H), d0 = depthOf(sq.cur, sq.wallsCur), lvCur = buildHzb(d0, W, H);
    const f1 = { ...sq.cur, hzbOn: 1 };
    occlusionPass(g, stride, f1, lvPrev, occl, 1, R, 0, out);
    const p1 = new Set(out.visible.subarray(0, out.nVisible)), pend = out.nPending;
    occlusionPass(g, stride, f1, lvCur, occl, 2, R, 0, out);
    const drawn = new Set([...p1, ...out.visible.subarray(0, out.nVisible)]);
    assert.equal(p1.size + pend, n, 'phase 1 partitions the group');
    let truth = 0, recovered = 0;
    for (let i = 0; i < n; i++) {
      const o = i * stride, t = [g.ib.f32[o + 3], g.ib.f32[o + 7], g.ib.f32[o + 11]];
      if (!bruteOccluded(sq.cur, d0, t, R)) { truth++; assert.ok(drawn.has(i), `${sq.name}: truly visible ${i} dropped`); if (!p1.has(i)) recovered++; }
    }
    assert.ok(recovered > 0, `${sq.name}: phase 2 recovers instances the stale HZB hid (${recovered})`);
    console.log(`${sq.name}: truly visible ${truth}, phase 1 ${p1.size}, recovered in phase 2 ${recovered}`);
  }
  // invalid HZB (cut / teleport / first frame): nothing culled, nothing pending
  const lv = buildHzb(depthOf(cam([0, 0, 0], 0), walls), W, H);
  occlusionPass(g, stride, { ...cam([0, 0, 0], 0), hzbOn: 0 }, lv, occl, 1, R, 0, out);
  assert.equal(out.nVisible, n); assert.equal(out.nPending, 0);
  occlusionPass(g, stride, { ...cam([0, 0, 0], 0), hzbOn: 0 }, lv, occl, 2, R, 0, out);
  assert.equal(out.nVisible, 0, 'phase 2 has nothing pending when hzbOn 0');
}

// --- zero alloc per call after warm-up
{
  const c = cam([0, 0, 0], 0), lv = buildHzb(depthOf(c, [{ z: -10, x0: -5, x1: 5, y0: -5, y1: 5 }]), W, H), rect = createRect();
  const run = () => { let k = 0; for (let i = 0; i < 20000; i++) { if (instanceOccluded(c, lv, i % 7, 0, -30, 1, 0.5)) k++; projectAabbRect(c.vp, W, H, 1, 2, -20, 1, rect); aabbOccluded(lv, W, H, rect, nearDepth(c, 1, 2, -20, 1)); } return k; };
  run(); if (globalThis.gc) globalThis.gc();
  const h0 = process.memoryUsage().heapUsed; run(); run();
  const grew = process.memoryUsage().heapUsed - h0;
  assert.ok(grew < 200 * 1024, `no per-call allocation (heap grew ${grew} B over 120k calls)`);
}
console.log('occlusion.test OK');
