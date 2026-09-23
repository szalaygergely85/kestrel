// US-028 G-buffer: one surface sample per screen cell, struct-of-typed-
// arrays, allocated once (createEngine/resize) and reused every frame - see
// docs/architecture.md 8.1 items 1-2 and docs/backlog.md US-028 tech notes
// item 2 for the field-by-field spec. `depth`/`dist` is NOT duplicated here:
// `fb.depth` (DepthBuffer) already holds it.
//
// Kind codes: 0 none/sky, 1 wall, 2 step, 3 upper (lintel), 4 floor,
//             5 top (solid cap), 6 ceil.
// Face codes: 1 N, 2 E, 3 S, 4 W, 5 U, 6 D.
export const KIND_NONE = 0;
export const KIND_WALL = 1;
export const KIND_STEP = 2;
export const KIND_UPPER = 3;
export const KIND_FLOOR = 4;
export const KIND_TOP = 5;
export const KIND_CEIL = 6;

export const FACE_N = 1;
export const FACE_E = 2;
export const FACE_S = 3;
export const FACE_W = 4;
export const FACE_U = 5;
export const FACE_D = 6;

export class GBuffer {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.kind = new Uint8Array(n);
    this.mat = new Uint16Array(n);
    this.face = new Uint8Array(n);
    this.planeId = new Int32Array(n);
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.dudx = new Float32Array(n);
    this.dvdx = new Float32Array(n);
    this.dudy = new Float32Array(n);
    this.dvdy = new Float32Array(n);
    this.z = new Float32Array(n);
    this.aoD = new Float32Array(n);
    this.fogF = new Float32Array(n);
    this.rule = new Uint8Array(n);
    // Camera projection constants a structure's cast needs to hand to
    // computeDerivatives (architecture.md/backlog item 5) - same for every
    // structure cast this frame, set once by castSectors/fillFrameCam.
    this.cam = { tanHalfHFov: 0, cols: cols, planeDistY: 0 };
    this.structSeq = 0;
    this.writeCount = 0;
  }

  beginFrame() {
    this.kind.fill(0);
    this.rule.fill(0);
    this.writeCount = 0;
    this.structSeq = 0;
  }

  /** Reads sample `i` into a reused plain object (test/oracle helper - no allocation when `obj` is reused). */
  readSample(i, obj) {
    obj.kind = this.kind[i];
    obj.mat = this.mat[i];
    obj.face = this.face[i];
    obj.planeId = this.planeId[i];
    obj.u = this.u[i];
    obj.v = this.v[i];
    obj.dudx = this.dudx[i];
    obj.dvdx = this.dvdx[i];
    obj.dudy = this.dudy[i];
    obj.dvdy = this.dvdy[i];
    obj.z = this.z[i];
    obj.aoD = this.aoD[i];
    return obj;
  }

  writeSample(i, kind, mat, face, planeId, u, v, z, aoD) {
    this.kind[i] = kind;
    this.mat[i] = mat;
    this.face[i] = face;
    this.planeId[i] = planeId;
    this.u[i] = u;
    this.v[i] = v;
    this.z[i] = z;
    this.aoD[i] = aoD;
    this.writeCount++;
  }
}

// planeId packing (backlog US-028 item 2): (structSeq<<28) | (tag<<24) | (coord & 0xffffff).
export function packPlaneId(structSeq, tag, coord) {
  return ((structSeq & 0x7) << 28) | ((tag & 0xf) << 24) | (coord & 0xffffff);
}
