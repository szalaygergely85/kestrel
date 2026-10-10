// @ts-check
// engine/mesh/levelMesh.js - ME-01 (docs/backlog.md, docs/architecture.md
// 27.15.2). Converts a `Level` (engine/world/Level.js) grid into MeshData
// quads for the mesh renderer: floors/ceils (planes), and walls/steps/
// uppers (boundaries), with planeId/zRef/aoEdgeBits chosen to reproduce
// `engine/render/sectorCaster.js`'s neighbour rules EXACTLY (kind, face,
// planeId, uv, z, aoD all match the caster's G-buffer output - that parity
// is what `levelMesh.test.js`'s caster-oracle test checks). Never imports
// the caster itself (27.15.0: "never import a caster... tests may").
import { isTerrainFloor } from '../world/Level.js';
import {
  KIND_WALL, KIND_STEP, KIND_UPPER, KIND_FLOOR, KIND_TOP, KIND_CEIL,
  FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_D,
} from '../render/GBuffer.js';
import {
  StaticMeshBuilder, packFlat1, wallPlaneIdBase, planePlaneIdBase,
  AO_WALL, AO_PLANE, AO_FAR, resolveMats,
} from './MeshData.js';

/** @typedef {import('./MeshData.js').MeshData} MeshData */
/** @typedef {{base: MeshData, dyn: {tag: string, mesh: MeshData}[], levelName: string}} LevelMeshSet */

// Relief bit masks (identical to sectorCaster.js's RELIEF_W/E/N/S) - one bit
// per level cell direction, "the neighbour in this direction rises against
// this cell's own floorH/ceilH".
const RELIEF_W = 1, RELIEF_E = 2, RELIEF_N = 4, RELIEF_S = 8;

/**
 * Literal copy of sectorCaster.js's `ensureRelief` (0.01 m epsilon, missing
 * neighbour = rises), returning a fresh `{w, h, floorRise, ceilDrop}` rather
 * than caching on the level object (levelMesh.js never mutates `level`).
 * @param {import('../world/Level.js').Level} level
 * @returns {{w: number, h: number, floorRise: Uint8Array, ceilDrop: Uint8Array}}
 */
export function computeRelief(level) {
  const w = level.width, h = level.height;
  const floorRise = new Uint8Array(w * h);
  const ceilDrop = new Uint8Array(w * h);
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const own = level.sectorAt(cx + 0.5, cy + 0.5);
      const i = cy * w + cx;
      if (!own) { floorRise[i] = 0; ceilDrop[i] = 0; continue; }
      const ownFloorH = own.floorH, ownCeilH = own.ceilH;
      let fb = 0, cb = 0;
      const west = level.sectorAt(cx - 1 + 0.5, cy + 0.5);
      const east = level.sectorAt(cx + 1 + 0.5, cy + 0.5);
      const north = level.sectorAt(cx + 0.5, cy - 1 + 0.5);
      const south = level.sectorAt(cx + 0.5, cy + 1 + 0.5);
      if (!west || west.floorH > ownFloorH + 0.01) fb |= RELIEF_W;
      if (!east || east.floorH > ownFloorH + 0.01) fb |= RELIEF_E;
      if (!north || north.floorH > ownFloorH + 0.01) fb |= RELIEF_N;
      if (!south || south.floorH > ownFloorH + 0.01) fb |= RELIEF_S;
      if (ownCeilH !== 'sky') {
        const rises = (q) => !q || q.solid || (q.ceilH !== 'sky' && q.ceilH < ownCeilH - 0.01);
        if (rises(west)) cb |= RELIEF_W;
        if (rises(east)) cb |= RELIEF_E;
        if (rises(north)) cb |= RELIEF_N;
        if (rises(south)) cb |= RELIEF_S;
      }
      floorRise[i] = fb;
      ceilDrop[i] = cb;
    }
  }
  return { w, h, floorRise, ceilDrop };
}

/** A floor/top or ceiling quad (kind, face fixed by faceUp). */
function emitPlane(builder, kind, face, matKey, c, r, zRef, h, bits, faceUp) {
  const x0 = c, y0 = r, x1 = c + 1, y1 = r + 1;
  let p12, uv8;
  if (faceUp) {
    p12 = [x0, y0, h, x1, y0, h, x1, y1, h, x0, y1, h];
    uv8 = [x0, y0, x1, y0, x1, y1, x0, y1];
  } else {
    p12 = [x0, y0, h, x0, y1, h, x1, y1, h, x1, y0, h];
    uv8 = [x0, y0, x0, y1, x1, y1, x1, y0];
  }
  const matIdx = builder.matIndex(matKey);
  const flat1 = packFlat1(kind, face, matIdx);
  const flat0 = planePlaneIdBase(kind, h);
  // aux: [0] zRef [1] AO_PLANE [2] relief bits [3] cellX0 [4] cellY0 [5..7] 0
  const aux8 = [zRef, AO_PLANE, bits, x0, y0, 0, 0, 0];
  const nz = faceUp ? 1 : -1;
  builder.addQuad(p12, uv8, 0, 0, nz, flat0, flat1, aux8);
}

function emitFloor(builder, sec, c, r, relief, w) {
  if (isTerrainFloor(sec)) return; // GS-01a: terrain shows through (World.carveMask leaves this cell uncarved)
  const h = sec.floorH;
  const kind = sec.solid ? KIND_TOP : KIND_FLOOR;
  const bits = relief.floorRise[r * w + c];
  emitPlane(builder, kind, FACE_U, sec.floorMat, c, r, h, h, bits, true);
}

function emitCeil(builder, sec, c, r, relief, w) {
  if (typeof sec.ceilH !== 'number') return;
  const bits = relief.ceilDrop[r * w + c];
  emitPlane(builder, KIND_CEIL, FACE_D, sec.ceilMat, c, r, sec.floorH, sec.ceilH, bits, false);
}

/** V-side face for a boundary: EW -> W when V is the west/A side else E; NS -> N when V is north/A else S. */
function faceFor(orientation, sideIsA) {
  if (orientation === 'EW') return sideIsA ? FACE_W : FACE_E;
  return sideIsA ? FACE_N : FACE_S;
}

/** Along-wall AO neighbours on V's own side, plus the integer along-wall coordinate `u0`. */
function neighborsFor(orientation, sideIsA, c, r, S) {
  if (orientation === 'EW') {
    const vc = sideIsA ? c : c + 1;
    return { nbrA: S(vc, r - 1), nbrB: S(vc, r + 1), u0: r };
  }
  const vr = sideIsA ? r : r + 1;
  return { nbrA: S(c - 1, vr), nbrB: S(c + 1, vr), u0: c };
}

/**
 * The (up to 2) wall-type quads a boundary between A (west/north side) and B
 * (east/south side) produces, per 27.15.2 rules 1-3. `A`/`B` may be null
 * (grid edge). Never mutates its inputs.
 */
function boundaryQuads(orientation, c, r, A, B, footZ, S) {
  const quads = [];
  if (!A && !B) return quads;

  if (!A || !B) {
    // Rule 1: grid edge. V = the outside (null) side.
    const AisNull = !A;
    const X = AisNull ? B : A;
    if (X.solid) {
      const face = faceFor(orientation, AisNull);
      const u0 = orientation === 'EW' ? r : c;
      quads.push({
        kind: KIND_WALL, face, matKey: X.wallMat, z0: footZ, z1: X.floorH,
        zRef: 0, ceilZ: AO_FAR, nbrALo: AO_FAR, nbrBLo: AO_FAR, u0,
      });
    }
    return quads;
  }

  // Rule 2: floor riser (solid face / step front). V = the lower cell.
  if (A.floorH !== B.floorH) {
    const AisLower = A.floorH < B.floorH;
    const L = AisLower ? A : B, Hc = AisLower ? B : A;
    const face = faceFor(orientation, AisLower);
    const { nbrA, nbrB, u0 } = neighborsFor(orientation, AisLower, c, r, S);
    quads.push({
      kind: Hc.solid ? KIND_WALL : KIND_STEP, face, matKey: Hc.wallMat,
      z0: L.floorH, z1: Hc.floorH, zRef: L.floorH,
      ceilZ: typeof L.ceilH === 'number' ? L.ceilH : AO_FAR,
      nbrALo: nbrA ? nbrA.floorH : AO_FAR, nbrBLo: nbrB ? nbrB.floorH : AO_FAR, u0,
    });
  }

  // Rule 3: upper/lintel face. V = the higher-ceiling cell (looking across
  // at the underside of the beam over the lower-ceiling cell).
  if (!A.solid && !B.solid && typeof A.ceilH === 'number' && typeof B.ceilH === 'number' && A.ceilH !== B.ceilH) {
    const AisLowerCeil = A.ceilH < B.ceilH;
    const Lc = AisLowerCeil ? A : B, Hc2 = AisLowerCeil ? B : A;
    const sideIsA = !AisLowerCeil; // V = Hc2
    const face = faceFor(orientation, sideIsA);
    const { nbrA, nbrB, u0 } = neighborsFor(orientation, sideIsA, c, r, S);
    quads.push({
      kind: KIND_UPPER, face, matKey: Lc.upperMat,
      z0: Lc.ceilH, z1: Math.max(Lc.topH, Hc2.ceilH), zRef: Hc2.floorH,
      ceilZ: Hc2.ceilH,
      nbrALo: nbrA ? nbrA.floorH : AO_FAR, nbrBLo: nbrB ? nbrB.floorH : AO_FAR, u0,
    });
  }

  return quads;
}

/** Builds and adds one wall-type quad's geometry (skips z1-z0 <= 1e-9 slivers). */
function emitWall(builder, kind, face, matKey, orientation, boundary, a0, a1, z0, z1, zRef, ceilZ, nbrALo, nbrBLo, u0) {
  if (z1 - z0 <= 1e-9) return;
  let p12, uv8, nx = 0, ny = 0;
  if (orientation === 'EW') {
    if (face === FACE_W) {
      p12 = [boundary, a0, z0, boundary, a0, z1, boundary, a1, z1, boundary, a1, z0];
      uv8 = [a0, z0, a0, z1, a1, z1, a1, z0];
      nx = -1;
    } else {
      p12 = [boundary, a1, z0, boundary, a1, z1, boundary, a0, z1, boundary, a0, z0];
      uv8 = [a1, z0, a1, z1, a0, z1, a0, z0];
      nx = 1;
    }
  } else {
    if (face === FACE_S) {
      p12 = [a0, boundary, z0, a0, boundary, z1, a1, boundary, z1, a1, boundary, z0];
      uv8 = [a0, z0, a0, z1, a1, z1, a1, z0];
      ny = 1;
    } else {
      p12 = [a1, boundary, z0, a1, boundary, z1, a0, boundary, z1, a0, boundary, z0];
      uv8 = [a1, z0, a1, z1, a0, z1, a0, z0];
      ny = -1;
    }
  }
  const matIdx = builder.matIndex(matKey);
  const flat1 = packFlat1(kind, face, matIdx);
  const flat0 = wallPlaneIdBase(face, boundary);
  // aux: [0] zRef [1] AO_WALL [2] ceilZ [3] nbrALo [4] nbrBLo [5] u0 [6..7] 0
  const aux8 = [zRef, AO_WALL, ceilZ, nbrALo, nbrBLo, u0, 0, 0];
  builder.addQuad(p12, uv8, nx, ny, 0, flat0, flat1, aux8);
}

/**
 * `level:<name>` (or `level:<name>#<tag>` for a dynamic split builder) mesh
 * accumulator, plus the tag-picking rule (27.15.2 "Dynamic split": a quad
 * goes to `dyn[tag]` when its own cell (planes) or either side (boundaries)
 * is a legend entry with `dynamic` - the smallest tag wins if both sides are
 * dynamic with different tags - else it goes to `base`).
 */
function pickTag(...secs) {
  let tag = null;
  for (const s of secs) {
    if (s && s.dynamic && s.tag && (tag === null || s.tag < tag)) tag = s.tag;
  }
  return tag;
}

/**
 * Runs the full grid walk once, producing the base builder plus one builder
 * per dynamic tag found. Shared by `buildLevelMesh` and `rebuildLevelMeshDyn`
 * (both just re-run this - it is cheap and deterministic, so "re-run and
 * keep only what changed" needs no incremental bookkeeping).
 * @param {import('../world/Level.js').Level} level
 * @param {{matIdFor?: (key: string) => number, footZ?: number}} opts
 */
function computeLevelMeshData(level, opts) {
  const matIdFor = opts.matIdFor;
  const footZ = opts.footZ !== undefined ? opts.footZ : -2;
  const relief = computeRelief(level);
  const w = level.width, h = level.height;
  const S = (c, r) => level.sectorAt(c + 0.5, r + 0.5);

  const baseBuilder = new StaticMeshBuilder(`level:${level.name}`);
  /** @type {Map<string, StaticMeshBuilder>} */
  const dynBuilders = new Map();
  function builderFor(tag) {
    if (tag === null) return baseBuilder;
    let b = dynBuilders.get(tag);
    if (!b) { b = new StaticMeshBuilder(`level:${level.name}#${tag}`); dynBuilders.set(tag, b); }
    return b;
  }

  function doBoundary(orientation, c, r, A, B, boundaryCoord) {
    const quads = boundaryQuads(orientation, c, r, A, B, footZ, S);
    if (quads.length === 0) return;
    const builder = builderFor(pickTag(A, B));
    const a0 = orientation === 'EW' ? r : c;
    const a1 = a0 + 1;
    for (const q of quads) {
      emitWall(builder, q.kind, q.face, q.matKey, orientation, boundaryCoord, a0, a1,
        q.z0, q.z1, q.zRef, q.ceilZ, q.nbrALo, q.nbrBLo, q.u0);
    }
  }

  // Emission order (determinism, 27.15.2): r 0..h-1, c 0..w-1; per cell its
  // planes, west boundary if c==0, north boundary if r==0, east boundary,
  // south boundary (interior west/north boundaries are covered by the
  // neighbour cell's own east/south call - each boundary emitted exactly once).
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const own = S(c, r);
      if (own) {
        const builder = builderFor(pickTag(own));
        emitFloor(builder, own, c, r, relief, w);
        emitCeil(builder, own, c, r, relief, w);
      }
      if (c === 0) doBoundary('EW', c, r, S(c - 1, r), own, c);
      if (r === 0) doBoundary('NS', c, r, S(c, r - 1), own, r);
      doBoundary('EW', c, r, own, S(c + 1, r), c + 1);
      doBoundary('NS', c, r, own, S(c, r + 1), r + 1);
    }
  }

  const finalize = (builder) => {
    const mesh = builder.build();
    if (matIdFor) resolveMats(mesh, matIdFor);
    return mesh;
  };

  const base = finalize(baseBuilder);
  const tags = Array.from(dynBuilders.keys()).sort();
  const dynList = tags.map((tag) => ({ tag, mesh: finalize(dynBuilders.get(tag)) }));
  return { base, dynList };
}

/**
 * Converts a level grid into a base MeshData plus one MeshData per dynamic
 * legend tag (grates, drawbridges, ...). `level`'s own coordinates ARE the
 * mesh-local frame (1 cell = 1 m) - moving the level's world placement never
 * touches these vertices (uv anchoring AC).
 * @param {import('../world/Level.js').Level} level
 * @param {{matIdFor?: (key: string) => number, footZ?: number}} [opts]
 * @returns {LevelMeshSet}
 */
export function buildLevelMesh(level, opts = {}) {
  const { base, dynList } = computeLevelMeshData(level, opts);
  return { base, dyn: dynList, levelName: level.name };
}

/**
 * Rebuilds only `set.dyn[tag]`'s MeshData from the level's CURRENT legend
 * values (e.g. after `World.animateSector` mutates `sector.ceilH` in place).
 * Event-driven - allocation is fine here, never call this per frame. `base`
 * is left untouched (re-derived internally but discarded: the level's
 * non-dynamic cells never change, so it comes out byte-identical).
 * @param {LevelMeshSet} set
 * @param {import('../world/Level.js').Level} level
 * @param {string} tag
 * @param {{matIdFor?: (key: string) => number, footZ?: number}} [opts]
 * @returns {LevelMeshSet}
 */
export function rebuildLevelMeshDyn(set, level, tag, opts = {}) {
  const { dynList } = computeLevelMeshData(level, opts);
  const fresh = dynList.find((d) => d.tag === tag);
  const idx = set.dyn.findIndex((d) => d.tag === tag);
  if (fresh) {
    if (idx >= 0) set.dyn[idx] = fresh; else set.dyn.push(fresh);
  } else if (idx >= 0) {
    set.dyn.splice(idx, 1);
  }
  return set;
}
