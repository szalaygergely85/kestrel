// engine/world/bandBake.js (OB109-B1, arch 38.58): one near-band bake as a resumable job that never touches the live band.
// Terrain rows (Terrain.stepBandState) then the 4 scatter/collider phases of 38.38 (trees, detail, trunk collider, detail collider).
// WM-03 (38.59): phase 4 = per-band nav tile (`world.navTiles` set; the world never imports engine/nav, the NavGrid comes from `navTiles.create`).
// `World._bandJob` is the job of the pending swap (it adopts `terrain._bb`); prebake / bake-ahead run their own job.
import { TreeScatterJob, DetailScatterJob } from './scatter.js';
import { buildTrunkCollider, buildDetailCollider } from './colliders.js';
import { minNormalZFromSlopeDeg } from '../core/transform.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Slope-ok (central difference over +-cell, edge-clamped) + structure mask of one near row. Normal rule = NavGrid.buildFromWorld's. */
function fillNavRow(w, b, cfg, v, r) {
  const W = b.w, H = b.h, e = b.cell, hh = b.height, cosT = cfg._cosT ?? (cfg._cosT = minNormalZFromSlopeDeg(cfg.maxSlopeDeg ?? 30));
  const y = b.y0 + (r + 0.5) * e, ru = r + 1 < H ? r + 1 : r, rd = r > 0 ? r - 1 : r, sy = (ru - rd) * e;
  for (let c = 0; c < W; c++) {
    const i = r * W + c, cr = c + 1 < W ? c + 1 : c, cl = c > 0 ? c - 1 : c;
    const dx = (hh[r * W + cr] - hh[r * W + cl]) / ((cr - cl) * e || 1), dy = (hh[ru * W + c] - hh[rd * W + c]) / (sy || 1);
    v.slopeOk[i] = 1 / Math.sqrt(dx * dx + dy * dy + 1) >= cosT ? 1 : 0;
    if (w.structureAt(b.x0 + (c + 0.5) * e, y)) v.mask[i] = 1;
  }
}

function finishNavTile(w, b, cfg, v) {
  const grid = cfg.create(b.x0, b.y0, b.w, b.h, b.cell);
  grid.buildFromArrays(b.height, v.slopeOk, b.type, { typeNames: w.terrain.typeNames, mask: v.mask, blockedTypes: cfg.blockedTypes ?? ['water'], typeCost: cfg.typeCost ?? {}, maxStepM: cfg.maxStepM ?? Infinity });
  return grid;
}

/** Whole nav tile for a finished near band in one call (load time / legacy cached bundles; allocates). */
export function buildNavTile(world, near) {
  const cfg = world.navTiles, v = { slopeOk: new Uint8Array(near.w * near.h), mask: new Uint8Array(near.w * near.h) };
  for (let r = 0; r < near.h; r++) fillNavRow(world, near, cfg, v, r);
  return finishNavTile(world, near, cfg, v);
}

/** Row-sliced nav tile for an already cached bundle (WM-03 arch fix: setNavTiles fills these during idle frames, never on a swap). */
export class NavTileFill {
  constructor(world, bundle) { this.world = world; this.bundle = bundle; const b = bundle.near; this.v = { row: 0, slopeOk: new Uint8Array(b.w * b.h), mask: new Uint8Array(b.w * b.h) }; }
  /** >= 1 row per call; true when `bundle.nav` is set. */
  step(ms) {
    const w = this.world, b = this.bundle.near, cfg = w.navTiles, v = this.v, t0 = now();
    while (v.row < b.h) { fillNavRow(w, b, cfg, v, v.row++); if (now() - t0 >= ms) return false; }
    this.bundle.nav = finishNavTile(w, b, cfg, v);
    return true;
  }
}

export class BandBakeJob {
  static DONE = 5;
  /**
   * @param {object} world World (reads terrain, structures, scatter/detail ctx, physicsMode)
   * @param {object} st Terrain band state (`terrain.newBandState`, or the adopted `terrain._bb`)
   */
  constructor(world, st) {
    this.world = world; this.st = st; this.cx0 = st.cx0; this.cy0 = st.cy0;
    this.phase = -1; // -1 terrain rows | 0 trees | 1 detail | 2 trunk collider | 3 detail collider | 4 nav tile | 5 done (BandBakeJob.DONE)
    this.view = null; this.trees = null; this.detail = null;
    this.scatter = world.scatter; this.detailSet = world.detail; this.trunks = null; this.detailCol = null;
    this.nav = null; this._nv = null;
  }

  /** Fresh job for zone `(cx0,cy0,cw,ch)`; `src` = band to copy the overlap from or null (bytes are identical either way). */
  static create(world, cx0, cy0, cw, ch, src) {
    return new BandBakeJob(world, world.terrain.newBandState(cx0, cy0, cw, ch, src || null));
  }

  get terrainReady() { return this.st.ready; }

  /** Advances the terrain rows only. Returns true when the near arrays are complete. */
  stepTerrain(ms) { return this.world.terrain.stepBandState(this.st, ms); }

  /** Advances the scatter/collider phases (terrain must be ready). Returns true when all four results are ready. >= 1 unit of progress per call. */
  stepScatter(msBudget) {
    const w = this.world, terrain = w.terrain, st = this.st;
    if (this.phase < 0) {
      if (msBudget < 1.2 && !this._wait) { this._wait = true; return false; } // WM-02b: the job constructors (~1 ms) start on a call with a fresh budget
      this.view = Object.create(terrain); this.view.near = st.b;
      this.phase = terrain.realTrees ? 0 : 1;
      if (terrain.realTrees) this.trees = new TreeScatterJob(this.view, w.structures);
      if (w._detailCtx) this.detail = new DetailScatterJob(this.view, w.structures, w._detailCtx.keepOut, w._detailCtx.cfg);
      if (msBudget < 3) return false; // WM-02b: constructors are one call of their own under a small budget (phase is already set)
    }
    const t0 = now(), mesh = w.physicsMode === 'mesh';
    while (this.phase < 5) {
      const left = msBudget - (now() - t0);
      if (this.phase === 0) { if (this.trees.step(left)) { this.scatter = this.trees.result; this.phase = 1; } }
      else if (this.phase === 1) { if (!this.detail || this.detail.step(left)) { this.detailSet = this.detail ? this.detail.result : null; this.phase = 2; } }
      else if (this.phase === 2) { this.trunks = mesh && this.scatter ? buildTrunkCollider(this.scatter, terrain.recipe.recipe.forest.trees) : null; this.phase = 3; }
      else if (this.phase === 3) { this.detailCol = mesh && this.detailSet ? buildDetailCollider(this.detailSet) : null; this.phase = 4; }
      else if (this._navStep(left)) this.phase = 5;
      if (msBudget - (now() - t0) <= 0) break;
    }
    return this.phase >= 5;
  }

  /** Phase 4: rows of slope-ok + structure mask (time-checked per row), then one `buildFromArrays`. True when `this.nav` is final (or no nav tiles). */
  _navStep(ms) {
    const w = this.world, cfg = w.navTiles, b = this.st.b;
    if (!cfg) return true;
    let v = this._nv;
    if (!v) { const n = b.w * b.h; v = this._nv = { row: 0, slopeOk: new Uint8Array(n), mask: new Uint8Array(n) }; }
    const t0 = now();
    while (v.row < b.h) {
      fillNavRow(w, b, cfg, v, v.row++);
      if (now() - t0 >= ms) return false;
    }
    this.nav = finishNavTile(w, b, cfg, v); this._nv = null;
    return true;
  }

  /** Terrain then scatter in one budget. Returns true when the whole bundle is ready. */
  step(msBudget) {
    const t0 = now();
    if (!this.st.ready && !this.stepTerrain(msBudget)) return false;
    const left = msBudget - (now() - t0);
    return this.stepScatter(left > 0 ? left : 0);
  }

  /** Finished bundle (bounds finalised, near version 0 until `Terrain.publishBand`). Throws if not done. */
  bundle() {
    if (this.phase < 5) throw new Error('BandBakeJob.bundle: not finished');
    const near = this.world.terrain.finishBandState(this.st);
    return { key: null, zone: -1, near, scatter: this.scatter, detail: this.detailSet, trunks: this.trunks, detailCol: this.detailCol, nav: this.nav, classMap: null, bytes: 0, pinned: false, lastUse: 0 };
  }
}
