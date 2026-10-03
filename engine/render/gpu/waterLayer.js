// @ts-check
// engine/render/gpu/waterLayer.js - US-055a2a (docs/architecture.md 35.3): the GPU resources of the water layer, through
// GpuDevice only (check-deps rule 9): the static clipmap buffers (built and uploaded ONCE, never per frame) and the
// WATER target (RGBA32UI at cell resolution + its own depth24, cleared every frame by the pass).
//
// WATER texel (cols x rows, n = 1): x = floatBits(vD), y = oct normal (up), z = floatBits(h) (sheets: arc metres),
// w = slot | back << 4 | sheet << 5. Cleared to x = +Inf (0x7f800000): "no water here" (the composite's dW < rawDepth test).
import { getClipmap } from '../../mesh/waterMesh.js';

/** Clipmap vertex: one vec4 (lx, ly, ring, stitch), 16 B. */
export const WATER_VERTEX_STRIDE_BYTES = 16;
export const WATER_VERTEX_LAYOUT = Object.freeze([{ name: 'aL', location: 0, components: 4, type: 'float', offsetBytes: 0 }]);
/** Bit pattern of +Infinity as written into the cleared WATER.x. */
export const WATER_CLEAR_X = 0x7f800000;

export class WaterLayer {
  /** @param {import('./device/GpuDevice.js').GpuDevice} device */
  constructor(device) {
    this.device = device;
    /** @type {{vertexBuffer: any, indexBuffer: any, indexType: 'u16', indexCount: number}|null} */
    this._clip = null;
    this._sheets = new Map();
    this.cols = 0; this.rows = 0;
    this.texture = null; this.depth = null; this.target = null;
    // US-055a2b: the composite pass output (shade fg/bg composited with the water; the edge pass reads these instead of the shade output)
    this.compFg = null; this.compBg = null; this.compTarget = null;
  }

  /** The static clipmap buffers; created on the first call, the same object afterwards. */
  clipmap() {
    if (!this._clip) {
      const cm = getClipmap();
      this._clip = {
        vertexBuffer: this.device.createBuffer({ usage: 'vertex', data: cm.verts }),
        indexBuffer: this.device.createBuffer({ usage: 'index', data: cm.index }),
        indexType: /** @type {'u16'} */ ('u16'), indexCount: cm.index.length,
      };
    }
    return this._clip;
  }

  // Static buffers cached by mesh identity; uploads happen only when a world first draws.
  sheet(mesh) {
    let buffers = this._sheets.get(mesh);
    if (!buffers) {
      buffers = { vertexBuffer: this.device.createBuffer({ usage: 'vertex', data: mesh.verts }),
        indexBuffer: this.device.createBuffer({ usage: 'index', data: mesh.index }) };
      this._sheets.set(mesh, buffers);
    }
    return buffers;
  }

  /** (Re)creates the WATER target for a `cols x rows` grid; a no-op when the size is unchanged. */
  resize(cols, rows) {
    if (this.target && this.cols === cols && this.rows === rows) return;
    this._freeTarget();
    this.cols = cols; this.rows = rows;
    this.texture = this.device.createTexture({ format: 'rgba32ui', width: cols, height: rows });
    this.depth = this.device.createTexture({ format: 'depth24', width: cols, height: rows });
    this.target = this.device.createTarget({ color: [this.texture], depth: this.depth });
    this.compFg = this.device.createTexture({ format: 'rgba8', width: cols, height: rows });
    this.compBg = this.device.createTexture({ format: 'rgba8', width: cols, height: rows });
    this.compTarget = this.device.createTarget({ color: [this.compFg, this.compBg] });
  }

  _freeTarget() {
    for (const h of [this.compTarget, this.compBg, this.compFg, this.target, this.depth, this.texture]) if (h) this.device.dispose(h);
    this.target = this.depth = this.texture = null;
    this.compFg = this.compBg = this.compTarget = null;
    this.cols = this.rows = 0;
  }

  dispose() {
    this._freeTarget();
    for (const b of this._sheets.values()) { this.device.dispose(b.vertexBuffer); this.device.dispose(b.indexBuffer); }
    this._sheets.clear();
    if (this._clip) { this.device.dispose(this._clip.vertexBuffer); this.device.dispose(this._clip.indexBuffer); this._clip = null; }
  }
}
