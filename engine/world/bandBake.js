// engine/world/bandBake.js (OB109-B1, arch 38.58): one near-band bake as a resumable job that never touches the live band.
// Terrain rows (Terrain.stepBandState) then the 4 scatter/collider phases of 38.38 (trees, detail, trunk collider, detail collider).
// `World._bandJob` is the job of the pending swap (it adopts `terrain._bb`); prebake / bake-ahead run their own job.
import { TreeScatterJob, DetailScatterJob } from './scatter.js';
import { buildTrunkCollider, buildDetailCollider } from './colliders.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class BandBakeJob {
  /**
   * @param {object} world World (reads terrain, structures, scatter/detail ctx, physicsMode)
   * @param {object} st Terrain band state (`terrain.newBandState`, or the adopted `terrain._bb`)
   */
  constructor(world, st) {
    this.world = world; this.st = st; this.cx0 = st.cx0; this.cy0 = st.cy0;
    this.phase = -1; // -1 terrain rows | 0 trees | 1 detail | 2 trunk collider | 3 detail collider | 4 done
    this.view = null; this.trees = null; this.detail = null;
    this.scatter = world.scatter; this.detailSet = world.detail; this.trunks = null; this.detailCol = null;
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
      this.view = Object.create(terrain); this.view.near = st.b;
      this.phase = terrain.realTrees ? 0 : 1;
      if (terrain.realTrees) this.trees = new TreeScatterJob(this.view, w.structures);
      if (w._detailCtx) this.detail = new DetailScatterJob(this.view, w.structures, w._detailCtx.keepOut, w._detailCtx.cfg);
    }
    const t0 = now(), mesh = w.physicsMode === 'mesh';
    while (this.phase < 4) {
      const left = msBudget - (now() - t0);
      if (this.phase === 0) { if (this.trees.step(left)) { this.scatter = this.trees.result; this.phase = 1; } }
      else if (this.phase === 1) { if (!this.detail || this.detail.step(left)) { this.detailSet = this.detail ? this.detail.result : null; this.phase = 2; } }
      else if (this.phase === 2) { this.trunks = mesh && this.scatter ? buildTrunkCollider(this.scatter, terrain.recipe.recipe.forest.trees) : null; this.phase = 3; }
      else { this.detailCol = mesh && this.detailSet ? buildDetailCollider(this.detailSet) : null; this.phase = 4; }
      if (msBudget - (now() - t0) <= 0) break;
    }
    return this.phase >= 4;
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
    if (this.phase < 4) throw new Error('BandBakeJob.bundle: not finished');
    const near = this.world.terrain.finishBandState(this.st);
    return { key: null, zone: -1, near, scatter: this.scatter, detail: this.detailSet, trunks: this.trunks, detailCol: this.detailCol, classMap: null, bytes: 0, pinned: false, lastUse: 0 };
  }
}
