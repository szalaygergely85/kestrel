// WG-3c: the test-only 'upload' source of `?gpucompare=shade` (GpuCellPipeline._repackAndUpload twin, docs/architecture.md 14.2 item 7):
// packs the CPU `fb.gbuf` + `fb.depth` into the same uint G-buffer textures resolve/deriv would have written (and mirrors the cell-res
// values into the sub-sample textures' (0,0,cols,rows) sub-rect so shade's group average at uN = 1 finds exactly one sample per cell),
// isolating shade/edge parity from raster precision. Buffers are allocated once per grid size.
import { KIND_TERRAIN } from '../../GBuffer.js';

export class WgUploadSource {
  constructor(device) {
    this.device = device;
    this.n = 0;
  }

  _alloc(n) {
    if (this.n === n) return;
    this.n = n;
    this.GI = new Uint32Array(4 * n);
    const gaBuf = new ArrayBuffer(16 * n); this.GAf = new Float32Array(gaBuf); this.GA = new Uint32Array(gaBuf);
    const gdBuf = new ArrayBuffer(16 * n); this.GDf = new Float32Array(gdBuf); this.GD = new Uint32Array(gdBuf);
    const dBuf = new ArrayBuffer(4 * n); this.DepthF = new Float32Array(dBuf); this.Depth = new Uint32Array(dBuf);
  }

  /** @param {any} p WgCellPipeline (_fb, cols, rows) @param {any} t its targets */
  run(p, t) {
    const fb = p._fb, d = this.device;
    if (!fb || !fb.gbuf || !fb.depth) return false;
    const gbuf = fb.gbuf, depth = fb.depth.depth;
    const n = p.cols * p.rows;
    this._alloc(n);
    const { GI, GAf, GDf, DepthF } = this;
    const kind = gbuf.kind, mat = gbuf.mat, face = gbuf.face, planeId = gbuf.planeId;
    const uArr = gbuf.u, vArr = gbuf.v, zArr = gbuf.z, aoDArr = gbuf.aoD;
    const dudx = gbuf.dudx, dvdx = gbuf.dvdx, dudy = gbuf.dudy, dvdy = gbuf.dvdy;
    const mask = fb.rt.cells.mask;
    const aoAlias = new Uint32Array(aoDArr.buffer, aoDArr.byteOffset, aoDArr.length); // terrain: normal bits ride in aoD (ME-06)
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      GI[o] = planeId[i] >>> 0;
      GI[o + 1] = (kind[i] & 0xff) | ((face[i] & 0xf) << 8) | ((mask[i] & 0xf) << 12) | ((mat[i] & 0xffff) << 16);
      GI[o + 2] = kind[i] === KIND_TERRAIN ? aoAlias[i] : 0;
      GI[o + 3] = 0;
      GAf[o] = uArr[i]; GAf[o + 1] = vArr[i]; GAf[o + 2] = zArr[i];
      GAf[o + 3] = kind[i] === KIND_TERRAIN ? 1.0e30 : aoDArr[i];
      GDf[o] = dudx[i]; GDf[o + 1] = dvdx[i]; GDf[o + 2] = dudy[i]; GDf[o + 3] = dvdy[i];
      DepthF[i] = depth[i];
    }
    const rect = { x: 0, y: 0, w: p.cols, h: p.rows };
    d.writeTexture(t.texGI, GI); d.writeTexture(t.texGA, this.GA); d.writeTexture(t.texGD, this.GD); d.writeTexture(t.texDepth, this.Depth);
    d.writeTexture(t.texSGI, GI, rect); d.writeTexture(t.texSGA, this.GA, rect); d.writeTexture(t.texSDepth, this.Depth, rect);
    return true;
  }
}
