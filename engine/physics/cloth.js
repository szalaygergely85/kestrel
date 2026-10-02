// @ts-check
// engine/physics/cloth.js (CLOTH-1a1, docs/architecture.md 33.2/33.3).
//
// Cloth sim core: Verlet-style positions (`pos`/`prev`, implicit velocity) +
// XPBD small-step constraints (structural alpha 0, shear/bend alpha per def,
// ONE solver pass per substep), a long-range tether per node, per-triangle
// aero (drag + lift) with deterministic per-node flutter. Stand-alone: imports
// nothing. No trig, no Math.random/exp/pow/hypot, no wall clock (rule 15).
// Zero allocation in step(): everything is preallocated in createCloth.
//
// Z is up. The caller lays `rest` out (world positions, node k = row*cols+col).
// Colliders (1a2) are not implemented yet: step()'s 4th argument is accepted
// and ignored. Aero deviation from 33.3: nodes carry unit mass, so `drag` and
// `lift` are accelerations per m/s of relative wind (1/s), not forces times
// area; each node averages the accelerations of its adjacent triangles.

export const MAX_CLOTH_COLS = 24;
export const MAX_CLOTH_ROWS = 16;
export const MAX_CLOTH_NODES = MAX_CLOTH_COLS * MAX_CLOTH_ROWS;
const NO_PIN = 0xffff;
const MOVE_EPS = 1e-6; // m per step: below this the cloth did not "move" (version gating)

/** @param {string} k @param {number} v @param {number} lo @param {number} hi */
function checkRange(k, v, lo, hi) {
  if (!(typeof v === 'number' && v >= lo && v <= hi)) throw new Error(`createCloth: def.${k} must be a number in [${lo}, ${hi}], got ${v}`);
}

/** 32-bit integer hash of (seed, k) -> [0,1). Deterministic, no state. */
function hash01(seed, k) {
  let x = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(k | 0, 0x85ebca6b)) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0;
  x ^= x >>> 12; x = Math.imul(x, 0x297a2d39) >>> 0;
  x ^= x >>> 15;
  return (x >>> 8) / 16777216;
}

/**
 * Builds a cloth. Allocates everything; throws naming the bad key.
 * @param {Object} def see docs/architecture.md 33.2 (cols, rows, rest, pins, holes, seed, dt, substeps, shearCompliance, bendCompliance, damping, gravity, drag, lift, flutter, maxSpeed, thickness)
 */
export function createCloth(def) {
  if (!def) throw new Error('createCloth: def required');
  const cols = def.cols, rows = def.rows;
  checkRange('cols', cols, 2, MAX_CLOTH_COLS);
  checkRange('rows', rows, 2, MAX_CLOTH_ROWS);
  if (!Number.isInteger(cols)) throw new Error(`createCloth: def.cols must be an integer, got ${cols}`);
  if (!Number.isInteger(rows)) throw new Error(`createCloth: def.rows must be an integer, got ${rows}`);
  const N = cols * rows;
  if (!def.rest || def.rest.length !== 3 * N) throw new Error(`createCloth: def.rest must have ${3 * N} numbers`);
  if (!def.pins || def.pins.length < 1) throw new Error('createCloth: def.pins needs >= 1 node index');
  for (let i = 0; i < def.pins.length; i++) {
    if (!(def.pins[i] >= 0 && def.pins[i] < N)) throw new Error(`createCloth: def.pins[${i}] out of range`);
  }
  const seed = (def.seed === undefined ? 1 : def.seed) | 0;
  const dt = def.dt === undefined ? 1 / 60 : def.dt;
  const substeps = def.substeps === undefined ? 4 : def.substeps | 0;
  const shearC = def.shearCompliance === undefined ? 1e-6 : def.shearCompliance;
  const bendC = def.bendCompliance === undefined ? 1e-4 : def.bendCompliance;
  const damping = def.damping === undefined ? 2.5 : def.damping;
  const gravity = def.gravity === undefined ? -9.81 : def.gravity;
  const drag = def.drag === undefined ? 1.2 : def.drag;
  const lift = def.lift === undefined ? 0.2 : def.lift;
  const flutter = def.flutter === undefined ? 0.25 : def.flutter;
  const maxSpeedCfg = def.maxSpeed === undefined ? 8 : def.maxSpeed;
  const thickness = def.thickness === undefined ? 0.03 : def.thickness;
  checkRange('dt', dt, 1e-4, 0.1);
  checkRange('substeps', substeps, 2, 8);
  checkRange('shearCompliance', shearC, 0, 1);
  checkRange('bendCompliance', bendC, 0, 1);
  checkRange('damping', damping, 0, 1 / (dt / substeps));
  checkRange('drag', drag, 0, 100);
  checkRange('lift', lift, 0, 100);
  checkRange('flutter', flutter, 0, 1);
  checkRange('maxSpeed', maxSpeedCfg, 0.1, 1000);
  const h = dt / substeps;
  const h2 = h * h;
  const dampK = 1 - damping * h;
  const shearA = shearC / h2, bendA = bendC / h2;

  const pos = new Float64Array(3 * N);
  const prev = new Float64Array(3 * N);
  const invMass = new Float64Array(N);
  for (let i = 0; i < 3 * N; i++) { pos[i] = def.rest[i]; prev[i] = def.rest[i]; }
  const nPins = def.pins.length;
  const pinNode = new Uint16Array(nPins);
  const pinTarget = new Float64Array(3 * nPins);
  const pinStart = new Float64Array(3 * nPins);
  const isPin = new Uint8Array(N);
  for (let i = 0; i < nPins; i++) {
    const k = def.pins[i];
    pinNode[i] = k; isPin[k] = 1;
    pinTarget[3 * i] = pos[3 * k]; pinTarget[3 * i + 1] = pos[3 * k + 1]; pinTarget[3 * i + 2] = pos[3 * k + 2];
  }

  // ---- quads / holes / triangles
  const QW = cols - 1, QH = rows - 1;
  const quadOn = new Uint8Array(QW * QH).fill(1);
  if (def.holes) {
    for (let i = 0; i < def.holes.length; i++) {
      const q = def.holes[i];
      if (!(q >= 0 && q < QW * QH)) throw new Error(`createCloth: def.holes[${i}] out of range`);
      quadOn[q] = 0;
    }
  }
  const qOn = (r, c) => (r >= 0 && r < QH && c >= 0 && c < QW) ? quadOn[r * QW + c] : 0;
  let T = 0;
  for (let q = 0; q < QW * QH; q++) T += quadOn[q] * 2;
  const tri = new Uint16Array(3 * T);
  let ti = 0;
  const valence = new Uint8Array(N);
  for (let r = 0; r < QH; r++) {
    for (let c = 0; c < QW; c++) {
      if (!quadOn[r * QW + c]) continue;
      const a = r * cols + c, b = a + 1, cc = a + cols, d = cc + 1;
      tri[ti++] = a; tri[ti++] = b; tri[ti++] = d;
      tri[ti++] = a; tri[ti++] = d; tri[ti++] = cc;
      valence[a] += 2; valence[b] += 1; valence[d] += 2; valence[cc] += 1;
    }
  }
  const active = new Uint8Array(N); // node touches at least one live triangle
  const invVal = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    if (valence[k] > 0) { active[k] = 1; invVal[k] = 1 / valence[k]; }
    invMass[k] = (active[k] && !isPin[k]) ? 1 : 0;
  }

  // ---- constraints, SoA, ranges [structural | shear | bend]
  // Horizontal edge (r,c)-(r,c+1) lives if a live quad is above or below; vertical (r,c)-(r+1,c) likewise left/right.
  const hEdge = (r, c) => qOn(r - 1, c) || qOn(r, c);
  const vEdge = (r, c) => qOn(r, c - 1) || qOn(r, c);
  const maxC = 4 * N + 2 * QW * QH + 2 * N; // generous upper bound
  const ca = new Uint16Array(maxC), cb = new Uint16Array(maxC);
  const cr = new Float64Array(maxC);
  let nc = 0;
  const addC = (a, b) => {
    const dx = pos[3 * a] - pos[3 * b], dy = pos[3 * a + 1] - pos[3 * b + 1], dz = pos[3 * a + 2] - pos[3 * b + 2];
    ca[nc] = a; cb[nc] = b; cr[nc] = Math.sqrt(dx * dx + dy * dy + dz * dz); nc++;
  };
  // structural, red-black: horizontal even, horizontal odd, vertical even, vertical odd
  for (let par = 0; par < 2; par++) for (let r = 0; r < rows; r++) for (let c = par; c < cols - 1; c += 2) if (hEdge(r, c)) addC(r * cols + c, r * cols + c + 1);
  for (let par = 0; par < 2; par++) for (let r = par; r < rows - 1; r += 2) for (let c = 0; c < cols; c++) if (vEdge(r, c)) addC(r * cols + c, (r + 1) * cols + c);
  const nStruct = nc;
  for (let r = 0; r < QH; r++) for (let c = 0; c < QW; c++) {
    if (!quadOn[r * QW + c]) continue;
    const a = r * cols + c;
    addC(a, a + cols + 1); addC(a + 1, a + cols);
  }
  const nShear = nc - nStruct;
  // bend: skip-one, only across two live edges
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols - 2; c++) if (hEdge(r, c) && hEdge(r, c + 1)) addC(r * cols + c, r * cols + c + 2);
  for (let r = 0; r < rows - 2; r++) for (let c = 0; c < cols; c++) if (vEdge(r, c) && vEdge(r + 1, c)) addC((r) * cols + c, (r + 2) * cols + c);
  const b1 = nc;
  const ca3 = new Uint16Array(nc), cb3 = new Uint16Array(nc); // node index * 3
  const cr2 = new Float64Array(nc), cwa = new Float64Array(nc), cwb = new Float64Array(nc);
  for (let e = 0; e < nc; e++) {
    const alpha = e < nStruct ? 0 : (e < nStruct + nShear ? shearA : bendA);
    const wa = invMass[ca[e]], wb = invMass[cb[e]];
    ca3[e] = 3 * ca[e]; cb3[e] = 3 * cb[e];
    const ws = wa + wb + alpha;
    cwa[e] = ws > 0 ? wa / ws : 0; cwb[e] = ws > 0 ? wb / ws : 0; // both pinned, alpha 0: no-op
    cr2[e] = cr[e] * cr[e];
  }

  // ---- tethers: nearest pin by geodesic distance over structural + shear edges (O(N^2) Dijkstra at create)
  const tPin = new Uint16Array(N).fill(NO_PIN); // pin slot index (into pinNode) per node
  const tLen = new Float64Array(N);
  {
    const dist = new Float64Array(N).fill(Infinity);
    const src = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    for (let i = 0; i < nPins; i++) if (active[pinNode[i]] && dist[pinNode[i]] > 0) { dist[pinNode[i]] = 0; src[pinNode[i]] = i; }
    const lim = nStruct + nShear;
    for (;;) {
      let u = -1, best = Infinity;
      for (let k = 0; k < N; k++) if (!done[k] && dist[k] < best) { best = dist[k]; u = k; }
      if (u < 0) break;
      done[u] = 1;
      for (let e = 0; e < lim; e++) {
        let v = -1;
        if (ca[e] === u) v = cb[e]; else if (cb[e] === u) v = ca[e]; else continue;
        const nd = best + cr[e];
        if (nd < dist[v]) { dist[v] = nd; src[v] = src[u]; }
      }
    }
    for (let k = 0; k < N; k++) {
      if (src[k] >= 0 && !isPin[k]) { tPin[k] = src[k]; tLen[k] = 1.02 * dist[k]; }
    }
  }

  // ---- state / scratch
  const force = new Float64Array(3 * N);
  const wMul = new Float64Array(N); // per-node flutter multiplier (refreshed each step)
  const nodeW = new Float64Array(N); // invVal * wMul: per-node aero weight (refreshed each step)
  const vel = new Float64Array(3 * N); // node velocity (pos - prev) / h, once per step
  const kIdx = new Int32Array(N).fill(-1);
  const kA = new Float64Array(N), kB = new Float64Array(N);
  const bbox = new Float64Array(6);
  const maxSpeedStep = maxSpeedCfg * h; // displacement clamp per substep
  const clamp2 = maxSpeedStep * maxSpeedStep;

  /** @type {any} */
  const cloth = {
    pos, prev, n: N, cols, rows, quadOn, tri, bbox,
    nodeActive: active, // render may skip nodes with 0
    thickness, dt, substeps,
    asleep: false, restSteps: 0, version: 0, maxSpeed: 0, tick: 0,
  };

  // Plane set by setGround is stored for 1a2 (collisions are not applied in 1a1).
  const ground = new Float64Array(4);

  cloth.setPinTarget = function setPinTarget(p, x, y, z) {
    pinTarget[3 * p] = x; pinTarget[3 * p + 1] = y; pinTarget[3 * p + 2] = z;
  };
  cloth.setGround = function setGround(nx, ny, nz, d) {
    ground[0] = nx; ground[1] = ny; ground[2] = nz; ground[3] = d;
  };
  cloth.sleep = function sleep() { cloth.asleep = true; };
  cloth.wake = function wake() {
    // zero velocity: no pop
    prev.set(pos);
    cloth.asleep = false; cloth.restSteps = 0;
  };

  cloth.step = function step(wx, wy, wz, colliders) {
    void colliders;
    if (cloth.asleep) return;
    const P = pos;
    const tick = cloth.tick;

    // --- 2. forces once per step
    const invH = 1 / h;
    let col = 0, row = 0;
    for (let k = 0; k < N; k++) {
      force[3 * k] = 0; force[3 * k + 1] = 0; force[3 * k + 2] = gravity;
      vel[3 * k] = (pos[3 * k] - prev[3 * k]) * invH;
      vel[3 * k + 1] = (pos[3 * k + 1] - prev[3 * k + 1]) * invH;
      vel[3 * k + 2] = (pos[3 * k + 2] - prev[3 * k + 2]) * invH;
      // flutter multiplier: smoothstep between hash knots, per-node phase offset
      const t = tick + col * 3 + row * 5;
      const ki = (t / 12) | 0;
      if (kIdx[k] !== ki) {
        if (kIdx[k] === ki - 1) kA[k] = kB[k]; else kA[k] = hash01(seed, k * 7919 + ki);
        kB[k] = hash01(seed, k * 7919 + ki + 1);
        kIdx[k] = ki;
      }
      const f = (t - ki * 12) / 12;
      const g = kA[k] + (kB[k] - kA[k]) * (f * f * (3 - 2 * f));
      wMul[k] = 1 + flutter * (2 * g - 1);
      nodeW[k] = invVal[k] * wMul[k];
      if (++col === cols) { col = 0; row++; }
    }
    if (drag !== 0 || lift !== 0) {
      for (let t3 = 0; t3 < tri.length; t3 += 3) {
        const a = tri[t3], b = tri[t3 + 1], c = tri[t3 + 2];
        const a3 = 3 * a, b3 = 3 * b, c3 = 3 * c;
        const ux = pos[b3] - pos[a3], uy = pos[b3 + 1] - pos[a3 + 1], uz = pos[b3 + 2] - pos[a3 + 2];
        const vx = pos[c3] - pos[a3], vy = pos[c3 + 1] - pos[a3 + 1], vz = pos[c3 + 2] - pos[a3 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl2 = nx * nx + ny * ny + nz * nz;
        if (nl2 < 1e-18) continue;
        const inl = 1 / Math.sqrt(nl2);
        nx *= inl; ny *= inl; nz *= inl;
        // relative wind = wind - mean node velocity
        const mvx = (vel[a3] + vel[b3] + vel[c3]) * (1 / 3);
        const mvy = (vel[a3 + 1] + vel[b3 + 1] + vel[c3 + 1]) * (1 / 3);
        const mvz = (vel[a3 + 2] + vel[b3 + 2] + vel[c3 + 2]) * (1 / 3);
        const rx = wx - mvx, ry = wy - mvy, rz = wz - mvz;
        const dn = nx * rx + ny * ry + nz * rz;
        const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
        const adn = dn < 0 ? -dn : dn;
        const lk = lift * adn / (rl > 1e-6 ? rl : 1e-6);
        const fx = drag * dn * nx + lk * (rx - dn * nx);
        const fy = drag * dn * ny + lk * (ry - dn * ny);
        const fz = drag * dn * nz + lk * (rz - dn * nz);
        const wa = nodeW[a], wb = nodeW[b], wc = nodeW[c];
        force[a3] += fx * wa; force[a3 + 1] += fy * wa; force[a3 + 2] += fz * wa;
        force[b3] += fx * wb; force[b3 + 1] += fy * wb; force[b3 + 2] += fz * wb;
        force[c3] += fx * wc; force[c3 + 1] += fy * wc; force[c3 + 2] += fz * wc;
      }
    }
    for (let i = 0; i < nPins; i++) {
      const k3 = 3 * pinNode[i];
      pinStart[3 * i] = pos[k3]; pinStart[3 * i + 1] = pos[k3 + 1]; pinStart[3 * i + 2] = pos[k3 + 2];
    }

    // --- 4. substeps
    for (let sub = 0; sub < substeps; sub++) {
      // predict
      for (let k = 0; k < N; k++) {
        const w = invMass[k];
        const k3 = 3 * k;
        if (w === 0) { prev[k3] = pos[k3]; prev[k3 + 1] = pos[k3 + 1]; prev[k3 + 2] = pos[k3 + 2]; continue; }
        let dx = (pos[k3] - prev[k3]) * dampK + force[k3] * h2;
        let dy = (pos[k3 + 1] - prev[k3 + 1]) * dampK + force[k3 + 1] * h2;
        let dz = (pos[k3 + 2] - prev[k3 + 2]) * dampK + force[k3 + 2] * h2;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > clamp2) { const s = maxSpeedStep / Math.sqrt(d2); dx *= s; dy *= s; dz *= s; }
        prev[k3] = pos[k3]; prev[k3 + 1] = pos[k3 + 1]; prev[k3 + 2] = pos[k3 + 2];
        pos[k3] += dx; pos[k3 + 1] += dy; pos[k3 + 2] += dz;
      }
      // kinematic pins: linear toward target over the substeps
      const u = (sub + 1) / substeps;
      for (let i = 0; i < nPins; i++) {
        const k3 = 3 * pinNode[i], i3 = 3 * i;
        pos[k3] = pinStart[i3] + (pinTarget[i3] - pinStart[i3]) * u;
        pos[k3 + 1] = pinStart[i3 + 1] + (pinTarget[i3 + 1] - pinStart[i3 + 1]) * u;
        pos[k3 + 2] = pinStart[i3 + 2] + (pinTarget[i3 + 2] - pinStart[i3 + 2]) * u;
      }
      // constraints: structural (alpha 0), shear, bend. One pass each.
      // cwa/cwb = wa/(wa+wb+alpha), wb/(...) = per-constraint inverse masses (static, built at create).
      for (let e = 0; e < b1; e++) {
        const a3 = ca3[e], b3 = cb3[e];
        const dx = P[b3] - P[a3], dy = P[b3 + 1] - P[a3 + 1], dz = P[b3 + 2] - P[a3 + 2];
        // sqrt-free form: f = (r^2 - d^2) / (d^2 + r^2) -> f*d ~= -C*n to 2nd order in strain, stable at any stretch
        const d2 = dx * dx + dy * dy + dz * dz;
        const dl = (cr2[e] - d2) / (d2 + cr2[e]);
        const sa = cwa[e] * dl, sb = cwb[e] * dl;
        P[a3] -= sa * dx; P[a3 + 1] -= sa * dy; P[a3 + 2] -= sa * dz;
        P[b3] += sb * dx; P[b3 + 1] += sb * dy; P[b3 + 2] += sb * dz;
      }
      // tethers: only shorten
      for (let k = 0; k < N; k++) {
        const p = tPin[k];
        if (p === NO_PIN) continue;
        const p3 = 3 * pinNode[p], k3 = 3 * k;
        const dx = pos[k3] - pos[p3], dy = pos[k3 + 1] - pos[p3 + 1], dz = pos[k3 + 2] - pos[p3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        const L = tLen[k];
        if (d2 > L * L) {
          const s = L / Math.sqrt(d2);
          pos[k3] = pos[p3] + dx * s; pos[k3 + 1] = pos[p3 + 1] + dy * s; pos[k3 + 2] = pos[p3 + 2] + dz * s;
        }
      }
      // (1a2: collisions + friction go here)
    }

    // --- 5. bookkeeping
    let ms2 = 0;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < N; k++) {
      if (!active[k]) continue;
      const k3 = 3 * k;
      const px = pos[k3], py = pos[k3 + 1], pz = pos[k3 + 2];
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
      if (pz < z0) z0 = pz; if (pz > z1) z1 = pz;
      if (invMass[k] === 0) continue;
      const dx = px - prev[k3], dy = py - prev[k3 + 1], dz = pz - prev[k3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > ms2) ms2 = d2;
    }
    bbox[0] = x0; bbox[1] = y0; bbox[2] = z0; bbox[3] = x1; bbox[4] = y1; bbox[5] = z1;
    const speed = Math.sqrt(ms2) * invH;
    cloth.maxSpeed = speed;
    if (speed < 0.002 && wx === 0 && wy === 0 && wz === 0) cloth.restSteps++; else cloth.restSteps = 0;
    if (speed * h > MOVE_EPS) cloth.version++;
    cloth.tick = tick + 1;
  };

  /** Duck-typed hasher ({f64, u32}), fixed order: pos, prev, version, tick. */
  cloth.hashInto = function hashInto(hs) {
    for (let i = 0; i < 3 * N; i++) hs.f64(pos[i]);
    for (let i = 0; i < 3 * N; i++) hs.f64(prev[i]);
    hs.u32(cloth.version >>> 0);
    hs.u32(cloth.tick >>> 0);
  };

  // Tuned-for-test introspection (not part of the render contract).
  cloth.constraintCount = nc;
  cloth.tetherCount = (() => { let n = 0; for (let k = 0; k < N; k++) if (tPin[k] !== NO_PIN) n++; return n; })();
  cloth.structEdges = { a: ca, b: cb, rest: cr, count: nStruct };
  cloth.groundPlane = ground;

  return cloth;
}
