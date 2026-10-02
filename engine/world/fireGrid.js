// engine/world/fireGrid.js (US-133, docs/architecture.md 32.3).
//
// Deterministic fire-spread cellular sim over coarse per-area grids. Cell
// state: 0 none (never burns), 1 unburnt, 2 burning, 3 burnt (charred).
// The fire ticks at 10 Hz (every `tickSteps` sim steps, integer counter).
// Per tick, per area with burning cells, in cell index order:
//   1. decide (step-start state is read-only): burning cells lose 1 fuel and
//      join `burnList` at 0; every unburnt 8-neighbour of a burning cell
//      multiplies its survival `q` by (1 - ignite[mat] * wDir * wWind); then
//      each touched cell takes ONE rng draw, in index order.
//   2. apply: burnList -> burnt, igniteList -> burning with fresh fuel.
// Everything is baked at `addArea` (load time, may allocate); `step` never
// reads the world and never allocates. Own RNG stream (32.0 item 4).
// No trig / Math.random / wall clock (rule 15).
import { createRng } from '../core/rng.js';

export const FIRE_EMPTY = 0, FIRE_UNBURNT = 1, FIRE_BURNING = 2, FIRE_BURNT = 3;
export const FIRE_CHANGE_IGNITE = 1, FIRE_CHANGE_BURNT = 2; // change kind (low 2 bits)
export const FIRE_MAX_AREAS = 8;
export const FIRE_MAX_AREA_CELLS = 4096;
export const FIRE_MAX_CELLS = 16384;

const R2 = 0.70710678; // 1/sqrt(2): unit vector of a diagonal
const DIAG_W = 0.7;
// 8 neighbour offsets: 4 orthogonal then 4 diagonal; unit vectors and weights fixed.
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const UX = [1, -1, 0, 0, R2, R2, -R2, -R2];
const UY = [0, 0, 1, -1, R2, -R2, R2, -R2];
const DIRW = [1, 1, 1, 1, DIAG_W, DIAG_W, DIAG_W, DIAG_W];

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * @param {Object} opts
 * @param {Object} opts.materials  { key: {fuelSec, ignite (0..1), charred?} }
 * @param {number} [opts.seed=1]
 * @param {number} [opts.tickSteps=6]  sim steps per fire tick (10 Hz at 60)
 * @param {number} [opts.windK=0.15]   wind bias per m/s along the spread direction
 * @param {number} [opts.maxCells=16384]
 * @param {{emit:Function}} [opts.events]  receives one `fire:area` {id, kind:'burnt'} per tagged area that burns out
 * @param {{sampleInto:Function}} [opts.wind]  wind field; when set, sampled at each area centre every fire tick
 */
export function createFireGrid(opts) {
  const o = opts || {};
  const tickSteps = o.tickSteps > 0 ? (o.tickSteps | 0) : 6;
  const windK = typeof o.windK === 'number' ? o.windK : 0.15;
  const maxCells = Math.min(o.maxCells > 0 ? o.maxCells | 0 : FIRE_MAX_CELLS, FIRE_MAX_CELLS);
  const events = o.events || null;
  const rng = createRng(typeof o.seed === 'number' ? o.seed : 1);

  // ---- materials (sorted key order -> stable ids; id 0 = none) ----
  const matKeys = [''];
  const matIgnite = [0];
  const matFuelTicks = [0];
  const matCharred = [null];
  const matId = new Map();
  const mats = o.materials || {};
  for (const key of Object.keys(mats).sort()) {
    const m = mats[key];
    if (!m || !(m.fuelSec > 0)) throw new Error(`createFireGrid: material "${key}": fuelSec must be > 0`);
    if (!(m.ignite >= 0 && m.ignite <= 1)) throw new Error(`createFireGrid: material "${key}": ignite must be 0..1`);
    matId.set(key, matKeys.length);
    matKeys.push(key);
    matIgnite.push(m.ignite);
    matFuelTicks.push(Math.max(1, Math.round(m.fuelSec * 60 / tickSteps)));
    matCharred.push(m.charred || null);
  }
  if (matKeys.length > 255) throw new Error('createFireGrid: too many materials');
  const ign = Float64Array.from(matIgnite);

  // ---- SoA over all cells (preallocated) ----
  const state = new Uint8Array(maxCells);
  const fuel = new Uint16Array(maxCells);
  const mat = new Uint8Array(maxCells);
  const cz = new Float32Array(maxCells);
  const areaOf = new Uint8Array(maxCells);
  const qAcc = new Float64Array(maxCells).fill(1);
  const igniteList = new Int32Array(maxCells);
  const burnList = new Int32Array(maxCells);
  const changes = new Int32Array(maxCells * 2);
  const areas = [];
  const areaById = new Map(); // load-time only (save/load)
  const wf = new Float64Array(8);
  const off = new Int32Array(8);
  const windTmp = [0, 0, 0];
  const payload = { id: '', kind: 'burnt' };

  const grid = {
    areas, changes, changeCount: 0,
    stats: { burning: 0, ticks: 0 },
    tickSteps, windK,
    /** optional wind field (see opts.wind); may be (re)assigned any time */
    wind: o.wind || null,
    cellCount: 0,
    materialKeys: matKeys,
  };
  let counter = 0;

  function matKeyOf(globalCell) { return matKeys[mat[globalCell]]; }
  grid.materialKey = matKeyOf;
  /** charred material key the view swaps to once the cell is burnt (null = none). */
  grid.charredOf = (globalCell) => matCharred[mat[globalCell]];

  /**
   * Build one area (load time; allocates). `world` is duck-typed: optional
   * `surfaceAt(x, y) -> surfaceName|null` and `heightAt(x, y) -> z`; else the
   * terrain (`terrain.typeName(terrain.groundTypeAt(x,y))`, `terrain.groundAt`)
   * is used when present.
   * @param {Object} def {id, x0, y0, w, h, cell, zMin, zMax, paint?, tag?, surfaces?}
   * @param {Object} [world]
   * @param {Object<string,string>} [surfaces] surface name -> material key (shared `fire.surfaces`)
   */
  grid.addArea = function addArea(def, world, surfaces) {
    const id = def && def.id;
    if (!id || typeof id !== 'string') throw new Error('fireGrid.addArea: "id" is required');
    const tag = `fireGrid.addArea "${id}"`;
    if (areaById.has(id)) throw new Error(`${tag}: duplicate id`);
    if (areas.length >= FIRE_MAX_AREAS) throw new Error(`${tag}: more than ${FIRE_MAX_AREAS} areas`);
    const w = def.w | 0, h = def.h | 0;
    if (!(w > 0 && h > 0)) throw new Error(`${tag}: w and h must be > 0`);
    if (w * h > FIRE_MAX_AREA_CELLS) throw new Error(`${tag}: ${w * h} cells exceeds ${FIRE_MAX_AREA_CELLS}`);
    if (grid.cellCount + w * h > maxCells) throw new Error(`${tag}: total cells exceed ${maxCells}`);
    const cell = typeof def.cell === 'number' && def.cell > 0 ? def.cell : 0.5;
    const zMin = typeof def.zMin === 'number' ? def.zMin : -Infinity;
    const zMax = typeof def.zMax === 'number' ? def.zMax : Infinity;
    const paint = def.paint || [];
    for (const p of paint) {
      if (!Array.isArray(p.rect) || p.rect.length < 4) throw new Error(`${tag}: paint rect must be [x0,y0,x1,y1]`);
      if (p.mat != null && !matId.has(p.mat)) throw new Error(`${tag}: paint material "${p.mat}" unknown`);
    }
    const surf = surfaces || def.surfaces || {};
    for (const k of Object.keys(surf)) {
      if (!matId.has(surf[k])) throw new Error(`${tag}: surface "${k}" maps to unknown material "${surf[k]}"`);
    }
    const base = grid.cellCount;
    const ai = areas.length;
    const terrain = world && world.terrain;
    let flammable = 0;
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const px = def.x0 + (cx + 0.5) * cell, py = def.y0 + (cy + 0.5) * cell;
        let m = 0, painted = false;
        for (let k = 0; k < paint.length; k++) {
          const r = paint[k].rect;
          if (px >= r[0] && px < r[2] && py >= r[1] && py < r[3]) { m = paint[k].mat == null ? 0 : matId.get(paint[k].mat); painted = true; }
        }
        if (!painted) {
          let name = null;
          if (world && typeof world.surfaceAt === 'function') name = world.surfaceAt(px, py);
          else if (terrain && typeof terrain.groundTypeAt === 'function') name = terrain.typeName(terrain.groundTypeAt(px, py));
          if (name != null && Object.prototype.hasOwnProperty.call(surf, name)) m = matId.get(surf[name]);
        }
        const g = base + cy * w + cx;
        mat[g] = m;
        state[g] = m ? FIRE_UNBURNT : FIRE_EMPTY;
        fuel[g] = 0;
        areaOf[g] = ai;
        let z = 0;
        if (world && typeof world.heightAt === 'function') z = world.heightAt(px, py);
        else if (terrain && typeof terrain.groundAt === 'function') z = terrain.groundAt(px, py);
        cz[g] = z;
        if (m) flammable++;
      }
    }
    const a = {
      id, tag: def.tag || null, base, w, h, n: w * h, cell,
      x0: def.x0, y0: def.y0, zMin, zMax,
      cx: def.x0 + w * cell * 0.5, cy: def.y0 + h * cell * 0.5,
      wx: 0, wy: 0, burning: 0, flammable,
    };
    areas.push(a);
    areaById.set(id, a);
    grid.cellCount += w * h;
    return a;
  };

  // ---- queries ----
  function findCell(x, y, z) {
    for (let i = 0; i < areas.length; i++) {
      const a = areas[i];
      if (z < a.zMin || z > a.zMax) continue;
      const fx = Math.floor((x - a.x0) / a.cell), fy = Math.floor((y - a.y0) / a.cell);
      if (fx < 0 || fy < 0 || fx >= a.w || fy >= a.h) continue;
      return a.base + fy * a.w + fx;
    }
    return -1;
  }

  function lightCell(g) {
    state[g] = FIRE_BURNING;
    fuel[g] = matFuelTicks[mat[g]];
    areas[areaOf[g]].burning++;
    grid.stats.burning++;
    if (grid.changeCount < changes.length) changes[grid.changeCount++] = (g << 2) | FIRE_CHANGE_IGNITE;
  }

  /** Immediate, deterministic (no RNG). Only an unburnt flammable cell of the area containing (x,y,z). */
  grid.ignite = function ignite(x, y, z) {
    const g = findCell(x, y, z);
    if (g < 0 || state[g] !== FIRE_UNBURNT) return false;
    lightCell(g);
    return true;
  };

  /** Ignite every unburnt flammable cell whose centre is within r (xy) of the point. Returns the count. */
  grid.igniteRadius = function igniteRadius(x, y, z, r) {
    let count = 0;
    const r2 = r * r;
    for (let ai = 0; ai < areas.length; ai++) {
      const a = areas[ai];
      if (z < a.zMin || z > a.zMax) continue;
      let cx0 = Math.floor((x - r - a.x0) / a.cell), cx1 = Math.floor((x + r - a.x0) / a.cell);
      let cy0 = Math.floor((y - r - a.y0) / a.cell), cy1 = Math.floor((y + r - a.y0) / a.cell);
      if (cx0 < 0) cx0 = 0; if (cy0 < 0) cy0 = 0;
      if (cx1 >= a.w) cx1 = a.w - 1; if (cy1 >= a.h) cy1 = a.h - 1;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const dx = a.x0 + (cx + 0.5) * a.cell - x, dy = a.y0 + (cy + 0.5) * a.cell - y;
          if (dx * dx + dy * dy > r2) continue;
          const g = a.base + cy * a.w + cx;
          if (state[g] !== FIRE_UNBURNT) continue;
          lightCell(g);
          count++;
        }
      }
    }
    return count;
  };

  grid.stateAt = function stateAt(x, y, z) {
    const g = findCell(x, y, z);
    return g < 0 ? FIRE_EMPTY : state[g];
  };
  grid.isBurning = function isBurning(x, y, z) { return grid.stateAt(x, y, z) === FIRE_BURNING; };

  grid.cellCenter = function cellCenter(g, out) {
    const a = areas[areaOf[g]];
    const l = g - a.base;
    out[0] = a.x0 + ((l % a.w) + 0.5) * a.cell;
    out[1] = a.y0 + (((l / a.w) | 0) + 0.5) * a.cell;
    out[2] = cz[g];
    return out;
  };

  grid.setAreaWind = function setAreaWind(ai, wx, wy) {
    const a = typeof ai === 'number' ? areas[ai] : areaById.get(ai);
    a.wx = wx; a.wy = wy;
  };

  /** One `sampleInto` at each area centre (US-138 field). Zero allocation. */
  grid.sampleWind = function sampleWind(field, tick) {
    for (let i = 0; i < areas.length; i++) {
      const a = areas[i];
      field.sampleInto(a.cx, a.cy, a.zMin === -Infinity ? 0 : a.zMin, tick, windTmp);
      a.wx = windTmp[0]; a.wy = windTmp[1];
    }
  };

  // ---- the tick ----
  function tickArea(a) {
    const { base, w, h } = a;
    // per-direction factor: dir weight * wind bias (area wind is constant over a tick)
    for (let k = 0; k < 8; k++) wf[k] = DIRW[k] * clamp(1 + windK * (a.wx * UX[k] + a.wy * UY[k]), 0.25, 3);
    for (let k = 0; k < 8; k++) off[k] = DY[k] * w + DX[k];
    let nb = 0, ni = 0;
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const g = base + cy * w + cx;
        if (state[g] !== FIRE_BURNING) continue;
        const f = fuel[g] - 1;
        fuel[g] = f;
        if (f <= 0) burnList[nb++] = g;
        if (cx > 0 && cy > 0 && cx < w - 1 && cy < h - 1) {
          // interior fast path: no bounds checks
          for (let k = 0; k < 8; k++) {
            const t = g + off[k];
            if (state[t] !== FIRE_UNBURNT) continue;
            const p = ign[mat[t]] * wf[k];
            qAcc[t] *= p >= 1 ? 0 : 1 - p;
          }
        } else {
          for (let k = 0; k < 8; k++) {
            const nx = cx + DX[k], ny = cy + DY[k];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const t = base + ny * w + nx;
            if (state[t] !== FIRE_UNBURNT) continue;
            const p = ign[mat[t]] * wf[k];
            qAcc[t] *= p >= 1 ? 0 : 1 - p;
          }
        }
      }
    }
    // one draw per touched candidate, in index order
    const end = base + a.n;
    for (let g = base; g < end; g++) {
      const q = qAcc[g];
      if (q >= 1) continue;
      qAcc[g] = 1;
      if (rng.nextFloat() < 1 - q) igniteList[ni++] = g;
    }
    for (let i = 0; i < nb; i++) {
      const g = burnList[i];
      state[g] = FIRE_BURNT;
      a.burning--;
      grid.stats.burning--;
      changes[grid.changeCount++] = (g << 2) | FIRE_CHANGE_BURNT;
    }
    for (let i = 0; i < ni; i++) lightCell(igniteList[i]);
    if (nb > 0 && a.burning === 0 && a.tag && events) {
      payload.id = a.id;
      events.emit('fire:area', payload);
    }
  }

  /** Call once per sim step; ticks when the integer counter wraps. */
  grid.step = function step() {
    if (++counter < tickSteps) return;
    counter = 0;
    grid.stats.ticks++;
    grid.changeCount = 0;
    if (grid.stats.burning === 0 && grid.wind === null) return;
    if (grid.wind) grid.sampleWind(grid.wind, grid.stats.ticks);
    for (let i = 0; i < areas.length; i++) {
      if (areas[i].burning > 0) tickArea(areas[i]);
    }
  };

  // ---- hash / save / load ----
  grid.hashInto = function hashInto(h) {
    rng.hashInto(h);
    h.u32(counter);
    h.u32(grid.stats.ticks);
    const n = grid.cellCount;
    h.u8Array(state, 0, n);
    for (let i = 0; i < n; i++) if (state[i] === FIRE_BURNING) h.u32((i << 16) | fuel[i]);
  };

  grid.save = function save() {
    const out = { v: 1, rng: rng.save(), tick: grid.stats.ticks, counter, areas: {} };
    for (const a of areas) {
      let s = '';
      let run = 1;
      for (let i = 1; i <= a.n; i++) {
        if (i < a.n && state[a.base + i] === state[a.base + i - 1]) { run++; continue; }
        s += (s ? ',' : '') + state[a.base + i - 1] + 'x' + run;
        run = 1;
      }
      const b = [];
      for (let i = 0; i < a.n; i++) if (state[a.base + i] === FIRE_BURNING) b.push(i, fuel[a.base + i]);
      out.areas[a.id] = { s, b };
    }
    return out;
  };

  /** Restore into a grid whose areas were already built from the same content. */
  grid.load = function load(obj) {
    if (!obj || obj.v !== 1) throw new Error('fireGrid.load: unsupported save version');
    for (const a of areas) {
      const sv = obj.areas && obj.areas[a.id];
      if (!sv) continue; // area not in the save: keep fresh
      let i = 0;
      for (const run of sv.s.split(',')) {
        const [sStr, nStr] = run.split('x');
        const s = +sStr, n = +nStr;
        for (let k = 0; k < n; k++, i++) {
          if (i >= a.n) throw new Error(`fireGrid.load: area "${a.id}": state run overflows`);
          // content decides flammability: a saved non-empty state needs a material and vice versa
          if ((s === FIRE_EMPTY) !== (mat[a.base + i] === 0)) throw new Error(`fireGrid.load: area "${a.id}": cell ${i} does not match the content`);
          state[a.base + i] = s;
          fuel[a.base + i] = 0;
        }
      }
      if (i !== a.n) throw new Error(`fireGrid.load: area "${a.id}": state covers ${i} of ${a.n} cells`);
      for (let k = 0; k + 1 < sv.b.length; k += 2) fuel[a.base + sv.b[k]] = sv.b[k + 1];
      let burning = 0;
      for (let c = 0; c < a.n; c++) if (state[a.base + c] === FIRE_BURNING) burning++;
      a.burning = burning;
    }
    let total = 0;
    for (const a of areas) total += a.burning;
    grid.stats.burning = total;
    grid.stats.ticks = obj.tick | 0;
    counter = obj.counter | 0;
    rng.load(obj.rng);
    grid.changeCount = 0;
  };

  return grid;
}
