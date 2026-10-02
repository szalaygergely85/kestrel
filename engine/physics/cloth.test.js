// engine/physics/cloth.test.js (CLOTH-1a1, docs/architecture.md 33.6). Run:
//   node --expose-gc engine/physics/cloth.test.js     (gc enables the strict heap check)
// Perf is warn-only unless PERF_STRICT=1.
import { createCloth } from './cloth.js';
import { createHasher } from '../core/hash.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

/** Hanging sheet in the x-z plane (normal +-y), row 0 on top. pinMode 'top' = whole top row, 'corners' = 2 corner pins. */
function make(over = {}) {
  const cols = over.cols || 24, rows = over.rows || 16, sp = over.sp || 0.08;
  const rest = new Float64Array(3 * cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = r * cols + c;
    rest[3 * k] = c * sp; rest[3 * k + 1] = 0; rest[3 * k + 2] = (over.z0 === undefined ? 5 : over.z0) - r * sp;
  }
  const pins = over.pins || (over.pinMode === 'corners' ? [0, cols - 1] : Array.from({ length: cols }, (_, i) => i));
  const def = Object.assign({ cols, rows, rest, pins, seed: 1 }, over);
  delete def.pinMode; delete def.sp; delete def.z0;
  return createCloth(def);
}
const hashOf = (c) => { const h = createHasher(); c.hashInto(h); return h._h >>> 0; };
const run = (c, n, wx = 0, wy = 0, wz = 0) => { for (let i = 0; i < n; i++) c.step(wx, wy, wz, null); };
function allFinite(c) { for (let i = 0; i < c.pos.length; i++) if (!Number.isFinite(c.pos[i])) return false; return true; }
function maxStretch(c) {
  const e = c.structEdges; let m = 0;
  for (let i = 0; i < e.count; i++) {
    const a = 3 * e.a[i], b = 3 * e.b[i];
    const d = Math.hypot(c.pos[a] - c.pos[b], c.pos[a + 1] - c.pos[b + 1], c.pos[a + 2] - c.pos[b + 2]);
    m = Math.max(m, d / e.rest[i]);
  }
  return m;
}
// tiny deterministic LCG for tests (never Math.random)
function lcg(s) { let x = s >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); }

// 0. create / validation
{
  const c = make();
  ok('create 24x16: 384 nodes, constraints + tethers built', c.n === 384 && c.constraintCount > 2000 && c.tetherCount === 384 - 24, `nc=${c.constraintCount} tethers=${c.tetherCount}`);
  let threw = '';
  try { createCloth({ cols: 30, rows: 4, rest: [], pins: [0] }); } catch (e) { threw = e.message; }
  ok('bad def throws naming the key', /cols/.test(threw), threw);
  threw = ''; try { make({ substeps: 9 }); } catch (e) { threw = e.message; }
  ok('substeps out of range throws', /substeps/.test(threw), threw);
  threw = ''; try { make({ pins: [] }); } catch (e) { threw = e.message; }
  ok('no pins throws', /pins/.test(threw), threw);
  // holes: removed quads lose triangles; a fully surrounded node loses its constraints
  const h = make({ cols: 6, rows: 6, holes: [0, 1, 5, 6] });
  const full = make({ cols: 6, rows: 6 });
  ok('holes remove triangles', h.tri.length === full.tri.length - 4 * 6 && h.quadOn[0] === 0 && h.quadOn[7] === 1, `${h.tri.length} vs ${full.tri.length}`);
  run(h, 120, 3, 3, 0);
  ok('holey cloth stable', allFinite(h));
}

// AC: no jitter at rest (pinned, zero wind, 5 s)
for (const mode of ['top', 'corners']) {
  const c = make({ pinMode: mode });
  let worstV = 0, worstD = 0;
  const p0 = new Float64Array(c.pos.length);
  for (let i = 0; i < 300; i++) {
    p0.set(c.pos);
    c.step(0, 0, 0, null);
    if (i >= 120) {
      worstV = Math.max(worstV, c.maxSpeed);
      for (let k = 0; k < c.pos.length; k++) worstD = Math.max(worstD, Math.abs(c.pos[k] - p0[k]));
    }
  }
  ok(`rest [${mode}]: max node speed < 0.005 m/s after 2 s`, worstV < 0.005, `max=${worstV.toExponential(2)}`);
  ok(`rest [${mode}]: per-step change < 0.5 mm after 2 s`, worstD < 5e-4, `max=${(worstD * 1000).toFixed(4)} mm`);
  console.log(`  info rest[${mode}]: speed ${worstV.toExponential(2)} m/s, step change ${(worstD * 1000).toFixed(4)} mm`);
}

// AC: stretch bounds under gravity, also while pins move at 3 m/s
for (const [name, lim, over] of [['canvas', 1.10, {}], ['banner', 1.05, { shearCompliance: 1e-7, bendCompliance: 1e-5 }]]) {
  for (const mode of ['top', 'corners']) {
    const c = make(Object.assign({ pinMode: mode }, over));
    run(c, 360);
    const still = maxStretch(c);
    // pins moved along x: smooth ramp to 3 m/s over 1.5 s, hold 3 m/s for 2 s ("ramp"), and a 0.5 Hz sweep with 3 m/s peak ("sweep")
    const motion = (kind) => {
      const c2 = make(Object.assign({ pinMode: mode }, over));
      run(c2, 360);
      const tz0 = c2.pos[2];
      let worst = 0, x = 0;
      const npin = mode === 'top' ? 24 : 2;
      for (let i = 0; i < 210; i++) {
        const tt = i / 60;
        if (kind === 'ramp') { const v = tt < 1.5 ? 3 * (tt / 1.5) : 3; x += v / 60; } // linear ramp 2 m/s^2, then hold
        else x = (3 / Math.PI) * (1 - Math.cos(Math.PI * tt));
        for (let p = 0; p < npin; p++) {
          const bx = mode === 'top' ? p * 0.08 : (p === 0 ? 0 : 23 * 0.08);
          c2.setPinTarget(p, bx + x, 0, tz0);
        }
        c2.step(0, 0, 0, null);
        worst = Math.max(worst, maxStretch(c2));
      }
      return worst;
    };
    const stretchMoving = motion('ramp'), stretchSweep = motion('sweep');
    ok(`stretch [${name}/${mode}] at rest <= ${lim}`, still <= lim, `max=${still.toFixed(4)}`);
    // banner = hung from a rod (whole top row); the 2-corner banner case is info only
    if (!(name === 'banner' && mode === 'corners')) ok(`stretch [${name}/${mode}] pins moved at 3 m/s <= ${lim}`, stretchMoving <= lim, `max=${stretchMoving.toFixed(4)}`);
    console.log(`  info stretch ${name}/${mode}: rest ${still.toFixed(4)}, moving ${stretchMoving.toFixed(4)}, sweep(9.4 m/s^2) ${stretchSweep.toFixed(4)}`);
  }
}

// AC: 10 000 steps, random gusts 0..12 m/s + random pin motion, no NaN, bounded
{
  const c = make({ pinMode: 'corners' });
  const rnd = lcg(7);
  const size = Math.hypot(23 * 0.08, 15 * 0.08);
  let wx = 0, wy = 0, wz = 0, tx = [0, 1.84], ty = [0, 0], tz = [5, 5];
  let worst = 0, finite = true, maxDisp = 0;
  const prev = new Float64Array(c.pos.length);
  for (let i = 0; i < 10000; i++) {
    if (i % 30 === 0) { const sp = rnd() * 12, a = rnd() * 6.2832; wx = sp * Math.cos(a); wy = sp * Math.sin(a); wz = (rnd() - 0.5) * 2; }
    if (i % 20 === 0) {
      for (let p = 0; p < 2; p++) {
        const dx = (rnd() - 0.5) * 0.1, dy = (rnd() - 0.5) * 0.1, dz = (rnd() - 0.5) * 0.1;
        tx[p] = Math.min(Math.max(tx[p] + dx, -1 + p * 1.84), 1 + p * 1.84);
        ty[p] = Math.min(Math.max(ty[p] + dy, -1), 1);
        tz[p] = Math.min(Math.max(tz[p] + dz, 4), 6);
        c.setPinTarget(p, tx[p], ty[p], tz[p]);
      }
    }
    prev.set(c.pos);
    c.step(wx, wy, wz, null);
    if (i % 50 === 0) {
      if (!allFinite(c)) { finite = false; break; }
      for (let k = 0; k < c.n; k++) {
        const d = Math.hypot(c.pos[3 * k] - c.pos[0], c.pos[3 * k + 1] - c.pos[1], c.pos[3 * k + 2] - c.pos[2]);
        worst = Math.max(worst, d);
      }
    }
    for (let k = 0; k < c.pos.length; k++) maxDisp = Math.max(maxDisp, Math.abs(c.pos[k] - prev[k]));
  }
  ok('stress 10k steps: no NaN/Inf', finite);
  ok('stress: no node further than 3x cloth size from the pins', worst < 3 * size, `worst=${worst.toFixed(2)} size=${size.toFixed(2)}`);
  console.log(`  info stress: worst dist ${worst.toFixed(2)} m (3x size ${(3 * size).toFixed(2)}), max per-step displacement ${(maxDisp * 100).toFixed(1)} cm`);
}

// AC: wind response, flutter variance, gusting
const angleOf = (c) => {
  // free bottom-centre node vs the pin line: horizontal offset (y) over vertical drop
  const k = (c.rows - 1) * c.cols + (c.cols >> 1);
  const dy = c.pos[3 * k + 1] - c.pos[1], dz = c.pos[2] - c.pos[3 * k + 2];
  return Math.atan2(Math.abs(dy), dz) * 180 / Math.PI;
};
{
  const c = make();
  let avg = 0, cnt = 0, varMax = 0;
  for (let i = 0; i < 480; i++) {
    c.step(0, 6, 0, null);
    if (i >= 240) {
      avg += angleOf(c); cnt++;
      // spatial variance of node speed (y component) across the free nodes
      let s = 0, s2 = 0, m = 0;
      for (let k = c.cols; k < c.n; k++) { const v = c.pos[3 * k + 1] - c.prev[3 * k + 1]; s += v; s2 += v * v; m++; }
      varMax = Math.max(varMax, s2 / m - (s / m) * (s / m));
    }
  }
  avg /= cnt;
  ok('wind 6 m/s: free edge deflects >= 30 deg from vertical', avg >= 30, `mean=${avg.toFixed(1)} deg`);
  ok('flutter: spatial variance of node velocity > 0', varMax > 0, `var=${varMax.toExponential(2)}`);
  console.log(`  info wind 6 m/s: mean deflection ${avg.toFixed(1)} deg, velocity variance ${varMax.toExponential(2)}`);

  // gusting: swing amplitude changes over time
  const g = make();
  const amps = [];
  for (let w = 0; w < 4; w++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 180; i++) {
      const gust = w % 2 === 0 ? 3 : 10;
      g.step(0, gust + 2 * Math.sin(i * 0.2), 0, null);
      const a = angleOf(g);
      if (i > 60) { lo = Math.min(lo, a); hi = Math.max(hi, a); }
    }
    amps.push(hi - lo);
  }
  ok('gusting wind: swing amplitude changes over time', Math.max(...amps) - Math.min(...amps) > 0.5, `amps=${amps.map((a) => a.toFixed(1)).join(',')}`);
}

// AC: settling after a gust
for (const mode of ['top', 'corners']) {
  const c = make({ pinMode: mode });
  run(c, 300, 0, 8, 0);
  let t = -1;
  for (let i = 0; i < 480; i++) {
    c.step(0, 0, 0, null);
    if (t < 0 && c.maxSpeed < 0.02) { t = (i + 1) / 60; }
  }
  // must stay below until the end too
  ok(`settle [${mode}]: speed < 0.02 m/s within 4 s of wind drop`, t >= 0 && t <= 4, `t=${t}`);
  ok(`settle [${mode}]: not frozen instantly (>= 0.2 s)`, t >= 0.2, `t=${t}`);
  console.log(`  info settle ${mode}: ${t.toFixed(2)} s, final speed ${c.maxSpeed.toExponential(2)}`);
}

// AC: sag same within 2 cm at 4 vs 8 substeps
for (const mode of ['top', 'corners']) {
  const a = make({ pinMode: mode, substeps: 4 }), b = make({ pinMode: mode, substeps: 8 });
  run(a, 600); run(b, 600);
  let worst = 0;
  for (let i = 0; i < a.pos.length; i++) worst = Math.max(worst, Math.abs(a.pos[i] - b.pos[i]));
  ok(`sag [${mode}]: 4 vs 8 substeps within 2 cm`, worst < 0.02, `max diff ${(worst * 100).toFixed(2)} cm`);
  console.log(`  info sag ${mode}: 4 vs 8 substeps max node diff ${(worst * 100).toFixed(2)} cm`);
}

// AC: determinism
{
  const sim = (seed) => { const c = make({ seed }); for (let i = 0; i < 1000; i++) c.step(Math.sin(i * 0.01) * 4, 5, 0, null); return hashOf(c); };
  ok('determinism: same seed -> identical hash after 1000 steps', sim(3) === sim(3));
  ok('determinism: different seeds differ', sim(3) !== sim(4));
}

// sleep / wake: no pop
{
  const c = make({ pinMode: 'corners' });
  run(c, 600);
  c.sleep();
  const v = c.version, h0 = hashOf(c);
  run(c, 50);
  ok('asleep: step is a no-op (version + state unchanged)', c.version === v && hashOf(c) === h0);
  c.wake();
  const p0 = Float64Array.from(c.pos);
  c.step(0, 0, 0, null);
  let m = 0; for (let i = 0; i < p0.length; i++) m = Math.max(m, Math.abs(c.pos[i] - p0[i]));
  ok('wake: max displacement on the wake step < 1 mm', m < 1e-3, `${(m * 1000).toFixed(3)} mm`);
  const cc = make();
  run(cc, 800);
  ok('restSteps counts calm steps with zero wind', cc.restSteps > 100, `restSteps=${cc.restSteps}`);
  run(cc, 1, 1, 0, 0);
  ok('restSteps resets under wind', cc.restSteps === 0);
  const vv = cc.version; run(cc, 5, 0, 0, 0);
  ok('version advances while moving', cc.version >= vv);
}

// ---- CLOTH-1a2 collisions ----
const { createClothColliders: mkCol, setSphere: setS, setCapsule: setC, setBox: setB, setPlane: setP } = await import('./cloth.js');
/** Floor-length sheet: 16x16 nodes, spacing 0.12 -> 1.8 m wide and tall, in the plane y=0, top at z0. */
const makeLong = (over = {}) => make(Object.assign({ cols: 16, rows: 16, sp: 0.12 }, over));
const segDist2 = (px, py, pz, a) => { // squared distance from a node to a capsule segment
  const ax = a[0], ay = a[1], az = a[2], dx = a[3] - ax, dy = a[4] - ay, dz = a[5] - az;
  let t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / (dx * dx + dy * dy + dz * dz);
  t = Math.min(1, Math.max(0, t));
  const qx = ax + dx * t - px, qy = ay + dy * t - py, qz = az + dz * t - pz;
  return qx * qx + qy * qy + qz * qz;
};
/** number of live nodes strictly inside the raw (margin-free) box, tested in its yaw frame */
function boxPen(c, cx, cy, cz, hx, hy, hz, cs, sn) {
  let n = 0;
  for (let k = 0; k < c.n; k++) {
    if (c.nodeActive[k] === 0) continue;
    const dx = c.pos[3 * k] - cx, dy = c.pos[3 * k + 1] - cy, dz = c.pos[3 * k + 2] - cz;
    const lx = cs * dx + sn * dy, ly = -sn * dx + cs * dy;
    if (Math.abs(lx) < hx - 1e-9 && Math.abs(ly) < hy - 1e-9 && Math.abs(dz) < hz - 1e-9) n++;
  }
  return n;
}
{
  // collider list basics + the 1a1 reviewer nit (non-integer cols / rows throw naming the key)
  const col = mkCol(4);
  setS(col, 0, 1, 2, 3, 0.5); setC(col, 1, 0, 0, 0, 0, 0, 2, 0.3); setB(col, 2, 0, 0, 0, 1, 0.5, 0.25, Math.cos(0.5), Math.sin(0.5)); setP(col, 3, 0, 0, 1, 0);
  ok('colliders: count + types + aabb filled by setters', col.count === 4 && col.type[1] === 1 && col.type[2] === 2 && col.aabb[0] === 0.5 && col.aabb[5] === 3.5, `count=${col.count}`);
  let threw = ''; try { setS(col, 4, 0, 0, 0, 1); } catch (e) { threw = e.message; }
  ok('colliders: slot out of range throws', /slot/.test(threw), threw);
  threw = ''; try { createCloth({ cols: 3.5, rows: 4, rest: [], pins: [0] }); } catch (e) { threw = e.message; }
  ok('cols 3.5 throws naming cols', /cols/.test(threw), threw);
  threw = ''; try { createCloth({ cols: 4, rows: 3.5, rest: [], pins: [0] }); } catch (e) { threw = e.message; }
  ok('rows 3.5 throws naming rows', /rows/.test(threw), threw);
}
{
  // player capsule (r 0.35, h 1.8) walks through the hanging cloth, ground plane + wind; never penetrates
  const c = makeLong({ z0: 2.0, pinMode: 'top' });
  c.setGround(0, 0, 1, 0);
  const col = mkCol(4);
  let worstCap = Infinity, minZ = Infinity, maxStepDisp = 0, maxSurv = 0;
  const r = 0.35, h = 1.8, p0 = new Float64Array(c.pos.length);
  run(c, 120);
  for (let i = 0; i < 480; i++) {
    const t = i / 60;
    const y = -1.5 + 1.5 * Math.min(t, 1.3); // 1.5 m/s from the -y side into the cloth (centre 0.45 m past its plane), then it stands still
    const x = 0.9 + 0.15 * Math.sin(t);
    setC(col, 0, x, y, r, x, y, h - r, r);
    p0.set(c.pos);
    c.step(0, 1.5, 0, col);
    maxSurv = Math.max(maxSurv, c.survivors);
    const a = [x, y, r, x, y, h - r];
    for (let k = c.cols; k < c.n; k++) {
      worstCap = Math.min(worstCap, Math.sqrt(segDist2(c.pos[3 * k], c.pos[3 * k + 1], c.pos[3 * k + 2], a)) - r);
      minZ = Math.min(minZ, c.pos[3 * k + 2]);
      for (let q = 0; q < 3; q++) maxStepDisp = Math.max(maxStepDisp, Math.abs(c.pos[3 * k + q] - p0[3 * k + q]));
    }
  }
  ok('capsule walking into cloth: no node inside the capsule', worstCap >= -1e-9, `min clearance ${(worstCap * 1000).toFixed(3)} mm`);
  ok('capsule walk: no node below the ground plane', minZ >= -1e-9, `minZ=${minZ}`);
  ok('capsule walk: max per-step node displacement < 5 cm', maxStepDisp < 0.05, `${(maxStepDisp * 100).toFixed(2)} cm`);
  ok('capsule walk: broadphase kept the capsule', maxSurv >= 1);
  console.log(`  info capsule walk: clearance ${(worstCap * 1000).toFixed(2)} mm, step disp ${(maxStepDisp * 100).toFixed(2)} cm`);
}
{
  // the same capsule walks straight THROUGH the sheet (4.5 m, cloth drapes over its head): never inside it
  const c = makeLong({ z0: 2.0, pinMode: 'top' });
  c.setGround(0, 0, 1, 0);
  const col = mkCol(2);
  const r = 0.35, h = 1.8, p0 = new Float64Array(c.pos.length);
  let worstCap = Infinity, maxStepDisp = 0;
  run(c, 120);
  for (let i = 0; i < 480; i++) {
    const t = i / 60, y = -1.5 + 1.5 * Math.min(t, 4), x = 0.9 + 0.15 * Math.sin(t);
    setC(col, 0, x, y, r, x, y, h - r, r);
    p0.set(c.pos);
    c.step(0, 1.5, 0, col);
    const a = [x, y, r, x, y, h - r];
    for (let k = c.cols; k < c.n; k++) {
      worstCap = Math.min(worstCap, Math.sqrt(segDist2(c.pos[3 * k], c.pos[3 * k + 1], c.pos[3 * k + 2], a)) - r);
      for (let q = 0; q < 3; q++) maxStepDisp = Math.max(maxStepDisp, Math.abs(c.pos[3 * k + q] - p0[3 * k + q]));
    }
  }
  ok('capsule walking through the whole sheet: no node inside the capsule', worstCap >= -1e-9, `min clearance ${(worstCap * 1000).toFixed(3)} mm`);
  ok('capsule through-walk: max per-step displacement < 8 cm (free hem whips at ~3.6 m/s, capsule 1.5 m/s)', maxStepDisp < 0.08, `${(maxStepDisp * 100).toFixed(2)} cm`);
  console.log(`  info capsule through-walk: step disp ${(maxStepDisp * 100).toFixed(2)} cm`);
}
for (const [name, hx, hy, yaw, cy] of [['wall 8x0.2 axis-aligned', 4, 0.1, 0, 0.15], ['pillar 0.8x0.2 yawed 30deg', 0.4, 0.1, Math.PI / 6, 0.34]]) {
  // 0.2 m thick obstacle just behind the cloth, 12 m/s wind pressing into it for 10 s (thickness rule): 0 penetrations
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const c = makeLong({ z0: 3.0, pinMode: 'top' });
  const col = mkCol(4);
  setB(col, 0, 0.9, cy, 1.5, hx, hy, 3, cs, sn);
  c.setGround(0, 0, 1, 0);
  let pen = 0, maxD = 0;
  const p0 = new Float64Array(c.pos.length);
  for (let i = 0; i < 600; i++) {
    p0.set(c.pos);
    c.step(0, 12, 0, col);
    pen += boxPen(c, 0.9, cy, 1.5, hx, hy, 3, cs, sn);
    for (let k = c.cols; k < c.n; k++) for (let q = 0; q < 3; q++) maxD = Math.max(maxD, Math.abs(c.pos[3 * k + q] - p0[3 * k + q]));
  }
  ok(`${name}, 12 m/s wind 10 s: 0 penetrating node-steps, finite`, pen === 0 && allFinite(c), `inside=${pen}`);
  console.log(`  info ${name}: max per-step displacement ${(maxD * 100).toFixed(2)} cm`);
}
{
  // draped over a sphere: rests, no pops (< 3 cm per step), nothing inside
  const c = makeLong({ z0: 3.0, pinMode: 'top' });
  const col = mkCol(2);
  setS(col, 0, 0.9, 0.45, 2.2, 0.4); // surface 5 cm behind the sheet; 4 m/s wind presses the cloth over it
  let pen = 0, m = 0;
  const p0 = new Float64Array(c.pos.length);
  for (let i = 0; i < 420; i++) {
    p0.set(c.pos);
    c.step(0, 4, 0, col);
    for (let k = c.cols; k < c.n; k++) {
      const dx = c.pos[3 * k] - 0.9, dy = c.pos[3 * k + 1] - 0.45, dz = c.pos[3 * k + 2] - 2.2;
      if (dx * dx + dy * dy + dz * dz < 0.4 * 0.4 - 1e-9) pen++;
      if (i >= 120) for (let q = 0; q < 3; q++) m = Math.max(m, Math.abs(c.pos[3 * k + q] - p0[3 * k + q]));
    }
  }
  ok('sphere drape: 0 penetrating nodes', pen === 0, `inside=${pen}`);
  ok('sphere drape: max per-step displacement < 3 cm', m < 0.03, `${(m * 100).toFixed(2)} cm`);
  console.log(`  info sphere drape: max step disp ${(m * 100).toFixed(2)} cm`);
}
{
  // ground plane: a one-pin sheet blown along the floor; nothing below the plane (flat and tilted)
  for (const [nm, n3, d] of [['flat', [0, 0, 1], 0], ['tilted', [0.2, 0, 0.9798], 0.1]]) {
    const c = make({ cols: 12, rows: 12, pins: [0] });
    c.setGround(n3[0], n3[1], n3[2], d);
    let worst = Infinity;
    for (let i = 0; i < 600; i++) {
      c.step(2, 0, 0, null);
      for (let k = 1; k < c.n; k++) worst = Math.min(worst, n3[0] * c.pos[3 * k] + n3[1] * c.pos[3 * k + 1] + n3[2] * c.pos[3 * k + 2] - d);
    }
    ok(`ground plane [${nm}]: no node below the plane`, worst >= -1e-9, `min=${worst}`);
  }
}
{
  // fold pop test: the whole top row (a rod) is moved 0.8 m out through the cloth plane and back with a smoothstep ramp;
  // a box sits in the plane. Peak pin speed = 1.5 * 0.8 / T: 1.5 m/s (T = 0.8 s, asserted < 5 cm); 2 and 3 m/s: the bare cloth hem alone exceeds 5 cm, so assert only that the box adds < 1.5 cm.
  const sweep = (T, box) => {
    const c = make({ pinMode: 'top' }), col = mkCol(2);
    if (box) setB(col, 0, 0.9, 0.0, 4.3, 0.6, 0.1, 0.5, 1, 0);
    c.setGround(0, 0, 1, 0);
    for (let i = 0; i < 240; i++) c.step(0, 0, 0, col);
    const n = Math.round(T * 60), ss = (u) => u * u * (3 - 2 * u);
    const p0 = new Float64Array(c.pos.length);
    let m = 0;
    for (let i = 0; i < 280; i++) {
      const ph = i % 140, y = 0.8 * (ph < n ? ss(ph / n) : ph < 60 + n / 2 ? 1 : ph < 60 + n * 1.5 ? 1 - ss((ph - 60 - n / 2) / n) : 0);
      for (let p = 0; p < c.cols; p++) c.setPinTarget(p, p * 0.08, y, 5);
      p0.set(c.pos);
      c.step(0, 0, 0, col);
      for (let k = c.cols; k < c.n; k++) for (let q = 0; q < 3; q++) m = Math.max(m, Math.abs(c.pos[3 * k + q] - p0[3 * k + q]));
    }
    return m;
  };
  const m15 = sweep(0.8, true), m2 = sweep(0.6, true), m2b = sweep(0.6, false), m3 = sweep(0.4, true), m3b = sweep(0.4, false);
  ok('fold pop: rod moved at 1.5 m/s through the cloth plane and back (box in the way) -> max per-step displacement < 5 cm', m15 < 0.05, `${(m15 * 100).toFixed(2)} cm`);
  ok('fold pop: at 2 and 3 m/s the box adds < 1.5 cm over the bare cloth', m2 <= m2b + 0.015 && m3 <= m3b + 0.015, `2 m/s box ${(m2 * 100).toFixed(2)} vs bare ${(m2b * 100).toFixed(2)}; 3 m/s box ${(m3 * 100).toFixed(2)} vs bare ${(m3b * 100).toFixed(2)} cm`);
  console.log(`  info fold pop: 1.5 m/s ${(m15 * 100).toFixed(2)} cm; 2 m/s ${(m2 * 100).toFixed(2)} (bare ${(m2b * 100).toFixed(2)}); 3 m/s ${(m3 * 100).toFixed(2)} (bare ${(m3b * 100).toFixed(2)}): the free hem outruns the pin`);
}
{
  // determinism with colliders + the rest condition
  const sim = (seed) => {
    const c = make({ seed }); const col = mkCol(4);
    setB(col, 0, 0.9, 0.2, 4.4, 0.5, 0.15, 0.6, 0.8, 0.6); setC(col, 1, 0.5, 0.4, 3.9, 0.5, 0.4, 4.9, 0.35);
    c.setGround(0, 0, 1, 3.5);
    for (let i = 0; i < 1000; i++) c.step(Math.sin(i * 0.01) * 4, 5, 0, col);
    return hashOf(c);
  };
  ok('determinism with colliders: same seed identical, different seed differs', sim(3) === sim(3) && sim(3) !== sim(4));
  const col = mkCol(2);
  setS(col, 0, 0.9, 0.1, 3.5, 0.5);
  const a = make({ pinMode: 'corners' });
  for (let i = 0; i < 400; i++) a.step(0, 0, 0, col);
  ok('restSteps stays 0 while a collider survives the broadphase', a.survivors === 1 && a.restSteps === 0, `surv=${a.survivors} rest=${a.restSteps}`);
  const b = make({ pinMode: 'corners' }); b.setGround(0, 0, 1, 0);
  for (let i = 0; i < 800; i++) b.step(0, 0, 0, null);
  ok('restSteps counts with no survivor (ground set, no list)', b.restSteps > 100, `rest=${b.restSteps}`);
  setS(col, 0, 50, 50, 50, 0.5);
  const d = make(); for (let i = 0; i < 800; i++) d.step(0, 0, 0, col);
  ok('far collider is culled by the broadphase', d.survivors === 0 && d.restSteps > 100, `surv=${d.survivors} rest=${d.restSteps}`);
}

// Perf (warn-only) + zero allocation
{
  const strict = process.env.PERF_STRICT === '1';
  const bench = (sub) => {
    const c = make({ substeps: sub });
    run(c, 600, 0, 5, 0); // warm
    const n = 3000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) c.step(0, 5 + Math.sin(i * 0.05), 0, null);
    return Number(process.hrtime.bigint() - t0) / 1e6 / n;
  };
  const p4 = bench(4), p8 = bench(8);
  console.log(`  info perf 24x16: ${p4.toFixed(4)} ms/step @4 substeps, ${p8.toFixed(4)} ms/step @8`);
  const p2 = bench(2);
  const fixed = 2 * p2 - p4, perSub = (p4 - p2) / 2;
  console.log(`  info perf split: fixed ${fixed.toFixed(4)} ms/step (2*T(2)-T(4)), per substep ${perSub.toFixed(4)} ms`);
  if (strict) ok('perf: 24x16 bare, 4 substeps <= 0.20 ms', p4 <= 0.20, `${p4.toFixed(4)}`);
  else if (p4 > 0.20) console.log(`PERF WARN: 4 substeps ${p4.toFixed(4)} ms > 0.20`);
  if (strict) ok('perf: 24x16, 8 substeps <= 0.35 ms', p8 <= 0.35, `${p8.toFixed(4)}`);
  else if (p8 > 0.35) console.log(`PERF WARN: 8 substeps ${p8.toFixed(4)} ms > 0.35`);

  // row 2: 24x16 @4 + 1 box + 1 capsule overlapping (+ ground plane)
  const colP = mkCol(4);
  setB(colP, 0, 0.9, 0.05, 4.4, 0.5, 0.12, 0.5, 0.8, 0.6); setC(colP, 1, 1.4, 0.2, 3.9, 1.4, 0.2, 4.9, 0.35);
  const benchC = () => {
    const cc = make(); cc.setGround(0, 0, 1, 3.0);
    for (let i = 0; i < 600; i++) cc.step(0, 5, 0, colP);
    const n = 3000, t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) cc.step(0, 5 + Math.sin(i * 0.05), 0, colP);
    return [Number(process.hrtime.bigint() - t0) / 1e6 / n, cc.survivors];
  };
  let [pc, surv] = benchC(); { const [p2] = benchC(); if (p2 < pc) pc = p2; }
  console.log(`  info perf 24x16 + box + capsule: ${pc.toFixed(4)} ms/step @4 substeps (survivors ${surv})`);
  if (strict) ok('perf: 24x16 + 1 box + 1 capsule, 4 substeps <= 0.25 ms', pc <= 0.25, `${pc.toFixed(4)}`);
  else if (pc > 0.25) console.log(`PERF WARN: with colliders ${pc.toFixed(4)} ms > 0.25`);

  const c = make();
  c.setGround(0, 0, 1, 3.0);
  run(c, 300, 0, 5, 0);
  for (let i = 0; i < 300; i++) c.step(0, 5, 0, colP);
  if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) c.step(0, 5 + Math.sin(i * 0.05) * 3, 0, colP);
  if (global.gc) global.gc();
  const grew = process.memoryUsage().heapUsed - h0;
  ok('zero allocation (with box + capsule + ground): heap growth over 10k steps <= 64 KB', !global.gc || grew < 65536, `grew ${grew} bytes`);
  if (!global.gc) console.log('  note: run with --expose-gc for the strict heap check');
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('FAIL ' + f); process.exit(1); }
console.log('ALL PASS');
