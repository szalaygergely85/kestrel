// @ts-check
// engine/world/cloths.js (CLOTH-1b3, docs/architecture.md 33.1 item 4, 33.4, 33.5).
//
// The cloth SYSTEM: owns the cloths built from `cloths` content blocks at
// World.load (like `world.wind`), ticks them in the fixed step, and decides
// who sleeps. Presentation only: bodies push cloth, cloth never pushes back;
// not saved, not in World.hashInto (its sleep depends on the camera).
// `engine/physics/cloth.js` stays stand-alone; this file may import it.
//
// Per fixed step (`tick`): sleep rules in slot order -> candidates -> cap
// (maxAwake / maxAwakeNodes, nearest first) -> wind sample once per candidate
// -> static colliders + body capsules -> cloth.step. Zero allocation per tick.
import {
  createCloth, createClothColliders, setSphere, setCapsule, setBox, setPlane, MAX_CLOTH_COLS, MAX_CLOTH_ROWS,
} from '../physics/cloth.js';
import { forwardOf, rightOf, localToWorld } from '../core/transform.js';

export const MAX_CLOTHS = 16;
export const MAX_CLOTH_BODIES = 4;
export const MAX_CLOTH_STATIC = 12; // static colliders per cloth (12 + 4 bodies = the 16-slot list)
export const CLOTH_WARMUP_STEPS = 60;
export const CLOTH_REST_STEPS = 60; // consecutive calm steps before rest-sleep
export const CLOTH_DRAWN_GRACE = 8; // ticks a markDrawn stamp stays valid ("drawn last frame")
export const CLOTH_SLEEP_DIST = 40;
export const CLOTH_MIN_BOX = 0.2; // thinnest allowed static box (m): tunnelling rule, 33.3

/** Engine default presets (designer data `assets.clothPresets` overrides per key; numbers only). */
export const DEFAULT_CLOTH_PRESETS = Object.freeze({
  silk: { shearCompliance: 1e-6, bendCompliance: 1e-5, damping: 2.0, drag: 1.0, lift: 0.3, flutter: 0.3 },
  canvas: { shearCompliance: 1e-6, bendCompliance: 1e-4, damping: 2.5, drag: 1.2, lift: 0.2, flutter: 0.25 },
  banner: { shearCompliance: 1e-7, bendCompliance: 1e-3, damping: 3.0, drag: 0.9, lift: 0.15, flutter: 0.2 },
});
const SIM_KEYS = ['substeps', 'shearCompliance', 'bendCompliance', 'damping', 'gravity', 'drag', 'lift', 'flutter', 'maxSpeed', 'thickness'];

function fail(id, msg) { throw new Error(`cloths: cloth "${id}": ${msg}`); }
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function isVec(v, n) { return Array.isArray(v) && v.length >= n && v.every((x, i) => i >= n || isNum(x)); }

const fwd2 = [0, 0], right2 = [0, 0], tmpW = { x: 0, y: 0, z: 0 };

/**
 * Collects world-space cloth blocks: the world's own `def.cloths` plus every placed
 * structure's level `cloths` (level-local, converted through the structure frame,
 * ids prefixed `<structId>.`). Content is never mutated. Load-time only.
 * @param {Object} def world def @param {Array} structures `world.structures`
 */
export function collectClothDefs(def, structures) {
  const out = [];
  if (def && Array.isArray(def.cloths)) for (const b of def.cloths) out.push(b);
  for (const s of structures || []) {
    const lv = s.level && s.level.def;
    if (!lv || !Array.isArray(lv.cloths)) continue;
    const f = s.frame, yawAdd = f.yawSteps * 90;
    for (const b of lv.cloths) {
      const id = b && typeof b.id === 'string' ? `${s.id}.${b.id}` : b && b.id;
      const o = isVec(b && b.origin, 3) ? localToWorld(f, b.origin[0], b.origin[1], b.origin[2], { x: 0, y: 0, z: 0 }) : null;
      const c = { ...b, id };
      if (o) c.origin = [o.x, o.y, o.z];
      c.yawDeg = (isNum(b.yawDeg) ? b.yawDeg : 0) + yawAdd;
      if (Array.isArray(b.colliders)) {
        c.colliders = b.colliders.map((k) => {
          if (!k || !isVec(k.c, 3)) return k;
          const p = localToWorld(f, k.c[0], k.c[1], k.c[2], { x: 0, y: 0, z: 0 });
          const n = { ...k, c: [p.x, p.y, p.z] };
          if (k.type === 'box') n.yawDeg = (isNum(k.yawDeg) ? k.yawDeg : 0) + yawAdd;
          return n;
        });
      }
      out.push(c);
    }
  }
  return out;
}

/**
 * @param {Array} defs world-space cloth blocks (see collectClothDefs)
 * @param {{groundAt?:(x:number,y:number)=>(number|null)}|null} world
 * @param {Object} [presets] designer presets (key -> numbers)
 * @param {{maxAwake?:number, maxAwakeNodes?:number}} [opts]
 */
export function createClothSystem(defs, world, presets, opts) {
  const o = opts || {};
  const maxAwake = o.maxAwake ?? 6;
  const maxAwakeNodes = o.maxAwakeNodes ?? 768;
  const list = defs || [];
  if (list.length > MAX_CLOTHS) throw new Error(`cloths: ${list.length} cloths exceed the maximum ${MAX_CLOTHS}`);
  const count = list.length;
  const cloths = [];
  const meshes = new Array(count).fill(null); // CLOTH-1b1 fills these via setMesh
  const cols_ = [];
  const seen = new Set();

  // per-slot state
  const sleepDist2 = new Float64Array(count);
  const castShadow = new Uint8Array(count);
  const ids = [];
  const mats = [];
  const anchor = new Float64Array(3 * count); // wind sample point (first pin at rest)
  const lastDrawn = new Int32Array(count).fill(-1000000);
  const restAsleep = new Uint8Array(count);
  const nStatic = new Uint8Array(count);
  const seenVersion = new Float64Array(count);
  const windV = new Float64Array(3 * count);
  const dist2 = new Float64Array(count);
  const cand = new Int32Array(count);
  const windScratch = new Float64Array(3);

  const uvStep = new Float64Array(2 * count); // rest spacing [dx, dy] per slot (mesh uv is rest-space metres, 33.5)
  const bodies = new Float64Array(5 * MAX_CLOTH_BODIES); // x y z r h
  let bodyCount = 0;

  for (let i = 0; i < count; i++) {
    const b = list[i];
    const id = b && typeof b.id === 'string' && b.id ? b.id : fail(String(b && b.id), '"id" must be a non-empty string');
    if (seen.has(id)) fail(id, 'duplicate id');
    seen.add(id);
    ids.push(id);
    const cols = b.cols, rows = b.rows;
    if (!(Number.isInteger(cols) && cols >= 2 && cols <= MAX_CLOTH_COLS)) fail(id, `"cols" must be an integer in [2, ${MAX_CLOTH_COLS}], got ${cols}`);
    if (!(Number.isInteger(rows) && rows >= 2 && rows <= MAX_CLOTH_ROWS)) fail(id, `"rows" must be an integer in [2, ${MAX_CLOTH_ROWS}], got ${rows}`);
    if (!(isVec(b.size, 2) && b.size[0] > 0 && b.size[1] > 0)) fail(id, '"size" must be [width, height] > 0');
    if (!isVec(b.origin, 3)) fail(id, '"origin" must be [x, y, z]');
    const yaw = b.yawDeg === undefined ? 0 : b.yawDeg;
    if (!isNum(yaw)) fail(id, `"yawDeg" must be a number, got ${yaw}`);
    const plane = b.plane === undefined ? 'vertical' : b.plane;
    if (plane !== 'vertical' && plane !== 'horizontal') fail(id, `"plane" must be "vertical" or "horizontal", got ${plane}`);
    if (b.mat !== undefined && typeof b.mat !== 'string') fail(id, '"mat" must be a MaterialTable key (string)');
    mats.push(b.mat || null);
    const presetKey = b.preset === undefined ? 'canvas' : b.preset;
    const dp = DEFAULT_CLOTH_PRESETS[presetKey], up = presets && presets[presetKey];
    const preset = up ? { ...dp, ...up } : dp; // designer preset overrides the engine default per key (load time only)
    if (!preset) fail(id, `unknown preset "${presetKey}"`);
    const sleepDist = b.sleepDist === undefined ? CLOTH_SLEEP_DIST : b.sleepDist;
    if (!(isNum(sleepDist) && sleepDist > 0)) fail(id, `"sleepDist" must be a number > 0, got ${sleepDist}`);
    sleepDist2[i] = sleepDist * sleepDist;
    castShadow[i] = b.castShadow === false ? 0 : 1;

    // pins / holes: [col, row]
    if (!Array.isArray(b.pins) || b.pins.length < 1) fail(id, '"pins" needs >= 1 [col, row]');
    const pins = b.pins.map((p, k) => {
      if (!(isVec(p, 2) && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[0] < cols && p[1] >= 0 && p[1] < rows)) fail(id, `pins[${k}] must be [col, row] inside ${cols}x${rows}`);
      return p[1] * cols + p[0];
    });
    const holes = (b.holes || []).map((p, k) => {
      if (!(isVec(p, 2) && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[0] < cols - 1 && p[1] >= 0 && p[1] < rows - 1)) fail(id, `holes[${k}] must be a quad [col, row] inside ${cols - 1}x${rows - 1}`);
      return p[1] * (cols - 1) + p[0];
    });

    // rest layout (33.5): vertical = cols along the yaw's right vector, rows down -z; horizontal = rows along forward
    rightOf(yaw, right2); forwardOf(yaw, fwd2);
    const dx = b.size[0] / (cols - 1), dy = b.size[1] / (rows - 1);
    uvStep[2 * i] = dx; uvStep[2 * i + 1] = dy;
    const rest = new Float64Array(3 * cols * rows);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = 3 * (r * cols + c);
        let x = b.origin[0] + right2[0] * c * dx, y = b.origin[1] + right2[1] * c * dx, z = b.origin[2];
        if (plane === 'vertical') z -= r * dy; else { x += fwd2[0] * r * dy; y += fwd2[1] * r * dy; }
        rest[k] = x; rest[k + 1] = y; rest[k + 2] = z;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    const a0 = 3 * pins[0];
    anchor[3 * i] = rest[a0]; anchor[3 * i + 1] = rest[a0 + 1]; anchor[3 * i + 2] = rest[a0 + 2];

    const cdef = { cols, rows, rest, pins, holes, seed: b.seed === undefined ? 1 + i : b.seed };
    const src = { ...preset, ...b };
    for (const k of SIM_KEYS) if (src[k] !== undefined) cdef[k] = src[k];
    let cloth;
    try { cloth = createCloth(cdef); } catch (e) { fail(id, e.message); }
    cloths.push(cloth);

    // static colliders -> world slots (already world-space: collectClothDefs converted level-local ones)
    const col = createClothColliders(MAX_CLOTH_STATIC + MAX_CLOTH_BODIES);
    const kc = b.colliders === undefined ? [] : b.colliders;
    if (!Array.isArray(kc) || kc.length > MAX_CLOTH_STATIC) fail(id, `"colliders" must be an array of <= ${MAX_CLOTH_STATIC}`);
    kc.forEach((k, j) => {
      if (!k || !isVec(k.c, 3)) fail(id, `colliders[${j}].c must be [x, y, z]`);
      if (k.type === 'sphere') {
        if (!(isNum(k.r) && k.r > 0)) fail(id, `colliders[${j}].r must be > 0`);
        setSphere(col, j, k.c[0], k.c[1], k.c[2], k.r);
      } else if (k.type === 'box') {
        if (!(isVec(k.half, 3) && k.half[0] > 0 && k.half[1] > 0 && k.half[2] > 0)) fail(id, `colliders[${j}].half must be [hx, hy, hz] > 0`);
        if (2 * Math.min(k.half[0], k.half[1], k.half[2]) < CLOTH_MIN_BOX - 1e-9) fail(id, `colliders[${j}] box thinner than ${CLOTH_MIN_BOX} m (tunnelling rule, architecture.md 33.3)`);
        const kyaw = k.yawDeg === undefined ? 0 : k.yawDeg;
        if (!isNum(kyaw)) fail(id, `colliders[${j}].yawDeg must be a number`);
        rightOf(kyaw, right2); // box local x axis = (cos, sin)
        setBox(col, j, k.c[0], k.c[1], k.c[2], k.half[0], k.half[1], k.half[2], right2[0], right2[1]);
      } else fail(id, `colliders[${j}].type must be "box" or "sphere", got ${k.type}`);
    });
    nStatic[i] = kc.length;
    col.staticCount = kc.length; // 1a2 review: only survivors in slots >= staticCount reset the calm counter
    cols_.push(col);

    // ground plane fitted from 3 groundAt samples (33.1 item 2): tilted allowed, flat fallback when steep
    const gAt = world && typeof world.groundAt === 'function' ? world.groundAt.bind(world) : null;
    if (gAt) {
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, e = 1.5;
      const g0 = gAt(cx, cy), g1 = gAt(cx + e, cy), g2 = gAt(cx, cy + e);
      if (isNum(g0) && isNum(g1) && isNum(g2)) {
        let nx = -(g1 - g0) * e, ny = -(g2 - g0) * e, nz = e * e;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= l; ny /= l; nz /= l;
        if (nz < 0.5) { nx = 0; ny = 0; nz = 1; }
        cloth.setGround(nx, ny, nz, nx * cx + ny * cy + nz * g0);
      }
    }

    // warm-up: zero wind, WITH colliders (a collider appearing overlapping would snap nodes in one step)
    col.count = nStatic[i];
    for (let s = 0; s < CLOTH_WARMUP_STEPS; s++) cloth.step(0, 0, 0, col);
    cloth.restSteps = 0;
    seenVersion[i] = cloth.version;
  }

  let curTick = 0;
  const stats = { awake: 0, awakeNodes: 0, steps: 0 };

  const sys = {
    count, cloths, meshes, ids, mats, uvStep, castShadow, lastDrawn, stats, maxAwake, maxAwakeNodes,
    get bodyCount() { return bodyCount; },
    /** Renderer hook (1b1/1b2 `addCloths`): this cloth was drawn this frame. Wakes it on the next tick. */
    markDrawn(slot) { lastDrawn[slot] = curTick; },
    /** 1b1: attach the cloth's MeshData; the system bumps its `meshVersion` whenever the sim moved (shadow dirty-skip, 27.9a am. 4). */
    setMesh(slot, mesh) { meshes[slot] = mesh; },
    /** Body capsule (player): feet position, radius, height. Call before `tick` each step; slots >= MAX_CLOTH_BODIES throw. */
    setBody(i, x, y, z, r, h) {
      if (!(i >= 0 && i < MAX_CLOTH_BODIES)) throw new Error(`cloths.setBody: slot ${i} out of range [0, ${MAX_CLOTH_BODIES})`);
      const k = 5 * i;
      bodies[k] = x; bodies[k + 1] = y; bodies[k + 2] = z; bodies[k + 3] = r; bodies[k + 4] = h;
      if (i >= bodyCount) bodyCount = i + 1;
    },
    clearBodies() { bodyCount = 0; },
    isAsleep(slot) { return cloths[slot].asleep; },
    /**
     * One fixed step. Sleep rules (33.1 item 4): farther than sleepDist from the eye, not
     * drawn within CLOTH_DRAWN_GRACE ticks, over maxAwake / maxAwakeNodes (nearest first), at
     * rest (woken by wind > 0 or a body overlapping its bbox). Wake = prev := pos (no pop).
     * @param {number} tick @param {{sampleInto:Function}|null} wind
     */
    tick(tick, wind, eyeX, eyeY, eyeZ) {
      curTick = tick;
      let nc = 0;
      for (let i = 0; i < count; i++) {
        const c = cloths[i], bb = c.bbox;
        const dx = (bb[0] + bb[3]) * 0.5 - eyeX, dy = (bb[1] + bb[4]) * 0.5 - eyeY, dz = (bb[2] + bb[5]) * 0.5 - eyeZ;
        const d2 = dx * dx + dy * dy + dz * dz;
        dist2[i] = d2;
        if (d2 > sleepDist2[i] || tick - lastDrawn[i] > CLOTH_DRAWN_GRACE) {
          if (!c.asleep) c.sleep();
          restAsleep[i] = 0;
          continue;
        }
        let wx = 0, wy = 0, wz = 0;
        if (wind) {
          wind.sampleInto(anchor[3 * i], anchor[3 * i + 1], anchor[3 * i + 2], tick, windScratch);
          wx = windScratch[0]; wy = windScratch[1]; wz = windScratch[2];
        }
        windV[3 * i] = wx; windV[3 * i + 1] = wy; windV[3 * i + 2] = wz;
        // body overlap with the (thickness-grown) bbox
        let overlap = false;
        const g = c.thickness + 0.05;
        for (let b = 0; b < bodyCount; b++) {
          const k = 5 * b, r = bodies[k + 3];
          if (bodies[k] + r < bb[0] - g || bodies[k] - r > bb[3] + g || bodies[k + 1] + r < bb[1] - g || bodies[k + 1] - r > bb[4] + g
            || bodies[k + 2] + bodies[k + 4] < bb[2] - g || bodies[k + 2] > bb[5] + g) continue;
          overlap = true; break;
        }
        if (overlap) c.restSteps = 0;
        if (restAsleep[i]) {
          if (wx === 0 && wy === 0 && wz === 0 && !overlap) continue; // stays at rest, costs nothing
        }
        // insertion into the nearest-first candidate list (ties: lower slot first)
        let p = nc++;
        while (p > 0 && dist2[cand[p - 1]] > d2) { cand[p] = cand[p - 1]; p--; }
        cand[p] = i;
      }
      // cap: nearest first, maxAwake and maxAwakeNodes
      let awake = 0, nodes = 0;
      for (let q = 0; q < nc; q++) {
        const i = cand[q], c = cloths[i];
        if (awake < maxAwake && nodes + c.n <= maxAwakeNodes) {
          awake++; nodes += c.n;
          if (c.asleep) { c.wake(); restAsleep[i] = 0; }
          const col = cols_[i];
          col.count = nStatic[i];
          for (let b = 0; b < bodyCount; b++) {
            const k = 5 * b, r = bodies[k + 3];
            setCapsule(col, nStatic[i] + b, bodies[k], bodies[k + 1], bodies[k + 2] + r, bodies[k], bodies[k + 1], bodies[k + 2] + bodies[k + 4] - r, r);
          }
          c.step(windV[3 * i], windV[3 * i + 1], windV[3 * i + 2], col);
          if (c.version !== seenVersion[i]) {
            seenVersion[i] = c.version;
            const m = meshes[i];
            if (m) m.meshVersion++;
          }
          if (c.restSteps >= CLOTH_REST_STEPS) { c.sleep(); restAsleep[i] = 1; }
        } else if (!c.asleep) { c.sleep(); restAsleep[i] = 0; }
      }
      stats.awake = awake; stats.awakeNodes = nodes; stats.steps++;
    },
    /** Replay/test hash only (never part of World.hashInto). */
    hashInto(h) {
      for (let i = 0; i < count; i++) {
        cloths[i].hashInto(h);
        h.u32((cloths[i].asleep ? 1 : 0) | (restAsleep[i] << 1));
      }
    },
  };
  return sys;
}
