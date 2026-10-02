// @ts-check
// engine/mesh/waterMesh.js - US-055a2a (docs/architecture.md 35.3): the water clipmap builder + the vertex-stage JS twin.
//
// ONE static indexed mesh, built once and uploaded once (never per frame): 4 nested rings of 64 x 64 quads at steps
// 0.5 / 1 / 2 / 4 m (half-sizes 16 / 32 / 64 / 128 m; rings 1..3 have a 32 x 32 quad hole where the finer ring sits)
// plus a flat skirt from +-128 m to +-1900 m. Vertices are LOCAL (lx, ly) around an origin `O` = the eye xy snapped to
// 8 m (every vertex therefore sits on a fixed world grid: the surface is world-anchored, it does not swim).
//
// Vertex attributes (4 floats, 16 B): lx, ly, ring (0..3, skirt = 4), stitch (0 | 1 = neighbours along x | 2 = along y).
// `stitch` marks the vertices on a ring boundary that touch the next coarser ring at a T-junction: ring k's odd outer
// boundary vertices AND the coarse ring's own edge midpoints (added here so the topology is CONFORMING: both sides of a
// seam share the same vertices, so the rasteriser can never leave a sliver gap or double-cover a pixel). Once waves
// displace z (US-143b1) a stitch vertex takes the mean z of its two neighbours; with flat water (this story) it is inert.
//
// Winding: CCW seen from above (normal +z) -> screen-space A2 > 0 from above, < 0 from below (the "back" bit of 35.3).
//
// Conforming extras vs the 35.3 text (a deviation, noted in the story): the skirt's inner edge carries the 65 ring-3
// boundary vertices (a fan from the outer corner) instead of a single 8-triangle frame.

export const WATER_RING_COUNT = 4;
export const WATER_RING_QUADS = 64;
/** Ring step (m) and half-size (m); `WATER_RING_HALF[k] = 32 * WATER_RING_STEP[k]`. */
export const WATER_RING_STEP = Object.freeze([0.5, 1, 2, 4]);
export const WATER_RING_HALF = Object.freeze([16, 32, 64, 128]);
export const WATER_SKIRT_HALF = 1900;
/** The clipmap origin snap (m): the eye is always within 4 m of `O`. */
export const WATER_SNAP = 8;
/** Floats per clipmap vertex. */
export const WATER_VERT_STRIDE = 4;

/**
 * @typedef {Object} Clipmap
 * @property {Float32Array} verts - lx, ly, ring, stitch per vertex
 * @property {Uint16Array} index - triangle list (CCW from above)
 * @property {Int32Array} rangeStart - index offset where range r starts (ring 0..3, skirt = 4); length 6 (cumulative)
 * @property {number} vertCount
 * @property {number} triCount
 */

/** @type {Clipmap|null} */
let _clipmap = null;

/** The shared clipmap (built on first use; static content, safe to share between the GPU upload and the JS twin). */
export function getClipmap() {
  if (!_clipmap) _clipmap = buildClipmap();
  return _clipmap;
}

/** @returns {Clipmap} */
export function buildClipmap() {
  const N = WATER_RING_QUADS, H = N / 2; // 32 quads each side of the centre
  const verts = [];
  const index = [];
  const rangeStart = new Int32Array(WATER_RING_COUNT + 2);
  const _poly = [0, 0, 0, 0];
  const pushVert = (x, y, ring, stitch) => { verts.push(x, y, ring, stitch); return verts.length / 4 - 1; };
  /** per ring: grid (i, j) -> vertex id, -1 = none. i, j in [-H, H]. */
  const ringIds = [];
  for (let k = 0; k < WATER_RING_COUNT; k++) {
    const s = WATER_RING_STEP[k];
    const ids = new Int32Array((N + 1) * (N + 1)).fill(-1);
    ringIds.push(ids);
    const at = (i, j) => (j + H) * (N + 1) + (i + H);
    const stitchOf = (i, j) => {
      if (k > 2) return 0; // ring 3's outer edge meets the flat skirt (waves are faded to 0 there)
      const onY = Math.abs(j) === H, onX = Math.abs(i) === H;
      if (onY && !onX && (i & 1)) return 1; // top/bottom edge, odd: neighbours along x
      if (onX && !onY && (j & 1)) return 2; // left/right edge, odd: neighbours along y
      return 0;
    };
    const vert = (i, j) => {
      const a = at(i, j);
      if (ids[a] < 0) ids[a] = pushVert(i * s, j * s, k, stitchOf(i, j));
      return ids[a];
    };
    const inHole = (i, j) => k > 0 && i >= -H / 2 && i < H / 2 && j >= -H / 2 && j < H / 2; // quad (i,j) = [i,i+1] x [j,j+1]
    const hq = H / 2; // hole half-width in quads of this ring
    /** Midpoint vertex of a hole-boundary edge at half-step (conforming seam), id cached in a side map. */
    const mids = new Map();
    const mid = (x, y) => { // x, y in half-step units of this ring (world = * s / 2)
      const key = (y + 4 * N) * (8 * N) + (x + 4 * N);
      let id = mids.get(key);
      if (id === undefined) {
        // along-edge direction: a vertical hole edge (x = +-hq*2 in half units) has neighbours along y (stitch 2), horizontal -> x (1)
        const vertical = Math.abs(x) === hq * 2;
        id = pushVert(x * s / 2, y * s / 2, k, vertical ? 2 : 1);
        mids.set(key, id);
      }
      return id;
    };
    rangeStart[k] = index.length;
    for (let j = -H; j < H; j++) {
      for (let i = -H; i < H; i++) {
        if (inHole(i, j)) continue;
        const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
        // Hole-boundary quads (k > 0): the finer ring's midpoint on the shared edge, so every seam is T-junction free.
        // The hole is convex, so a quad touches it with at most ONE edge: a pentagon, fanned from the vertex opposite that
        // edge (no zero-area triangles). The quad lies directly below / above / left / right of the hole.
        if (k > 0) {
          const hx = i >= -hq && i < hq, hy = j >= -hq && j < hq;
          let m = -1, pivot = 0; // poly (CCW): [a, b, c, d] with m inserted after the edge's first vertex
          const poly = _poly;
          poly[0] = a; poly[1] = b; poly[2] = c; poly[3] = d;
          if (j === hq && hx) { m = mid(2 * i + 1, 2 * j); pivot = 2; poly.splice(1, 0, m); } // bottom edge a-b on the hole
          else if (i === -hq - 1 && hy) { m = mid(2 * (i + 1), 2 * j + 1); pivot = 3; poly.splice(2, 0, m); } // right edge b-c
          else if (j === -hq - 1 && hx) { m = mid(2 * i + 1, 2 * (j + 1)); pivot = 0; poly.splice(3, 0, m); } // top edge c-d
          else if (i === hq && hy) { m = mid(2 * i, 2 * j + 1); pivot = 1; poly.splice(4, 0, m); } // left edge d-a
          if (m >= 0) {
            // `pivot` named a corner of the original quad; find it in the (now 5 long) polygon
            const pv = poly.indexOf(pivot === 0 ? a : pivot === 1 ? b : pivot === 2 ? c : d);
            for (let t = 1; t < 4; t++) index.push(poly[pv], poly[(pv + t) % 5], poly[(pv + t + 1) % 5]);
            poly.length = 4;
            continue;
          }
        }
        index.push(a, b, c, a, c, d);
      }
    }
  }
  rangeStart[WATER_RING_COUNT] = index.length;

  // Skirt: four trapezoids, each a fan from the outer corner over [outer corner B, inner chain reversed].
  // The inner chain reuses the ring-3 boundary grid (65 verts per side) so the seam has no T-junctions.
  const S = WATER_SKIRT_HALF, h3 = WATER_RING_HALF[3];
  const sk = (x, y) => pushVert(x, y, WATER_RING_COUNT, 0);
  const oBL = sk(-S, -S), oBR = sk(S, -S), oTR = sk(S, S), oTL = sk(-S, S);
  const chain = (fx, fy, tx, ty) => { // 65 inner vertices from (fx,fy) to (tx,ty), ring-3 spacing
    const c = [];
    for (let t = 0; t <= N; t++) c.push(sk(fx + (tx - fx) * t / N, fy + (ty - fy) * t / N));
    return c;
  };
  const side = (oA, oB, c) => { // polygon CCW: oA, oB, then the inner chain from the B end back to the A end
    const poly = [oB];
    for (let t = c.length - 1; t >= 0; t--) poly.push(c[t]);
    for (let p = 0; p < poly.length - 1; p++) index.push(oA, poly[p], poly[p + 1]);
  };
  side(oBL, oBR, chain(-h3, -h3, h3, -h3)); // bottom (y = -h3), A end = left
  side(oBR, oTR, chain(h3, -h3, h3, h3));   // right
  side(oTR, oTL, chain(h3, h3, -h3, h3));   // top
  side(oTL, oBL, chain(-h3, h3, -h3, -h3)); // left
  rangeStart[WATER_RING_COUNT + 1] = index.length;

  const vertCount = verts.length / 4;
  if (vertCount > 65535) throw new Error('buildClipmap: more than 65535 vertices');
  return {
    verts: new Float32Array(verts), index: new Uint16Array(index), rangeStart,
    vertCount, triCount: index.length / 3,
  };
}

/** Per-slot uniform layout in a selection's `u` block (Float64, `WATER_U_STRIDE` floats per slot). */
export const WATER_U_STRIDE = 16;
export const U_KIND = 0, U_Z = 1, U_AABB = 2, U_SHAPE = 6, U_SLOT = 10, U_UNDER = 11, U_REGION = 12;

/**
 * Vertex stage twin (35.3, flat water): `l' = clamp(l, aabbLocal)` (outside vertices collapse onto the grown region AABB so
 * their triangles degenerate), z = the region's z. Local coordinates: the CPU already subtracted `O` from the AABB in f64.
 * @param {Float64Array} u - the selection's slot block
 * @param {number} base - slot * WATER_U_STRIDE
 * @param {number} lx @param {number} ly - clipmap vertex (local)
 * @param {Float64Array} out3 - x', y' (local), z (world)
 */
export function waterVertexJS(u, base, lx, ly, out3) {
  const x0 = u[base + U_AABB], y0 = u[base + U_AABB + 1], x1 = u[base + U_AABB + 2], y1 = u[base + U_AABB + 3];
  out3[0] = lx < x0 ? x0 : (lx > x1 ? x1 : lx);
  out3[1] = ly < y0 ? y0 : (ly > y1 ? y1 : ly);
  out3[2] = u[base + U_Z];
}

/**
 * Region shape test (fragment stage twin), LOCAL coordinates. Rect is half-open [x0,x1) x [y0,y1) like `waterAt`;
 * the circle is inclusive.
 * @param {Float64Array} u @param {number} base @param {number} x @param {number} y
 */
export function waterInsideJS(u, base, x, y) {
  if (u[base + U_KIND] === 0) {
    return x >= u[base + U_SHAPE] && x < u[base + U_SHAPE + 2] && y >= u[base + U_SHAPE + 1] && y < u[base + U_SHAPE + 3];
  }
  const dx = x - u[base + U_SHAPE], dy = y - u[base + U_SHAPE + 1];
  return dx * dx + dy * dy <= u[base + U_SHAPE + 2];
}
