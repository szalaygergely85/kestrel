// Shared per-cell depth buffer (D-007/D-008): a Float32Array(cols*rows) of
// camera distance in meters, written by the sector caster (US-004) and
// later also by the terrain caster (US-016/US-026), so the two passes can
// composite (nearer wins) and downstream passes (sprites, fades) can depth-
// test against real world distance. Depth is translation-invariant, so a
// structure's local `origin` offset (D-008 item 3) never affects it.

export class DepthBuffer {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.depth = new Float32Array(cols * rows);
    this.clear();
  }

  clear() {
    this.depth.fill(Infinity);
  }

  set(x, y, dist) {
    this.depth[y * this.cols + x] = dist;
  }

  get(x, y) {
    return this.depth[y * this.cols + x];
  }
}
