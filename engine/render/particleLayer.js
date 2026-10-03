// engine/render/particleLayer.js (US-053b, docs/architecture.md 32.1).
//
// JS-rasterised particle layer, read as ONE EXTRA CANDIDATE PER CELL by the
// sprite pass (both the GPU pass, spritesPass.js, and the JS twin,
// drawSprites in sprites.js) - the RE-07 overlay pattern (28.9): the cell
// decision is made once here, in JS, and both twins read the very same
// `part`/`partZ` arrays, so parity is exact by construction. Particles are
// NEVER added to the sprite pool's own SPR list (that loop is O(MAX_SPRITES)
// per cell - 500-2048 particles there would blow the per-cell budget; see
// the architecture note's "Reason").
//
// 1 particle = 1 cell by default; an emitter def `sizeM` (world diameter, m) grows the footprint with
// proximity to 1..3 x 1..3 cells (odd sizes centred, 2 -> anchor + right/down). Same glyph/colour/depth rule per cell.
//
// `build()` is called once per rendered frame, after `engine.particles.step()`:
//   1. clears the cells touched LAST frame (tracks which rows that wiped);
//   2. computes the camera basis once (`camBasis`, same as SpritePool);
//   3. per EMITTER (not per particle, <= MAX_EMITTERS = 64 calls/frame):
//      `lightAt` once at the emitter's own position -> an rgb multiplier,
//      run through the same gain curve `shadeSprite` uses (README 4);
//   4. per live slot, in slot order: ramp index (integer, stepped, no
//      lerp), skip glyph ' ', `projectSprite` (same function/depth
//      convention sprites use), "lower slot wins a tie" depth compare,
//      emissive-vs-lit colour + fog, write into `part`/`partZ`, track dirty
//      rows.
//
// Zero allocation after `bind()` (architecture.md 9) - `build()` never
// allocates, so `touched`/`part`/`partZ` are all sized once per grid change.
import { camBasis, projectSprite, resolveFogColor } from './sprites.js';
import { lightAt } from './lighting.js';
import { D, DEF_STRIDE, MAX_RAMP } from '../fx/emitterDef.js';
import { MAX_EMITTERS } from '../fx/particles.js';

function partEmpty8() { return new Uint8Array(0); }
function partEmptyF() { return new Float32Array(0); }
function partEmptyI() { return new Int32Array(0); }

const _ps = { depth: 0, fogDepth: 0, colCenter: 0, feetRow: 0, rowsOnScreen: 0 };
const _lightScratch = new Float64Array(3);
const _fog3 = new Float64Array(3);
// Per-emitter light multiplier cache (<= MAX_EMITTERS entries, rebuilt every
// `build()` - no per-particle `lightAt`, per the architect's "Known limit").
const _emMulR = new Float64Array(MAX_EMITTERS);
const _emMulG = new Float64Array(MAX_EMITTERS);
const _emMulB = new Float64Array(MAX_EMITTERS);
const _emDone = new Uint8Array(MAX_EMITTERS);

/**
 * `lightAt`'s raw rgb -> the same per-point gain curve `SpritePool.project`
 * applies to a sprite's own `lightAt` sample (shadeSprite's gain rule,
 * README 4) - an emitter is lit exactly like a sprite standing at the same
 * point would be.
 * @param {Object} S palette.shading
 * @param {number} r @param {number} g @param {number} b
 * @param {Float64Array} out length-3, written in place (mulR, mulG, mulB)
 */
function shadeMulFromLight(S, r, g, b, out) {
  const Lm = Math.max(r, g, b);
  const hr = Lm > 1e-6 ? r / Lm : 1, hg = Lm > 1e-6 ? g / Lm : 1, hb = Lm > 1e-6 ? b / Lm : 1;
  const bc = Lm < 0 ? 0 : Lm;
  let gain = S.fgMin + (1 - S.fgMin) * Math.pow(bc > 1 ? 1 : bc, S.fgGamma);
  if (bc > 1) gain = Math.min(S.fgMaxGain, gain + (bc - 1) * 0.5);
  const k = S.tint;
  out[0] = (1 + (hr - 1) * k) * gain;
  out[1] = (1 + (hg - 1) * k) * gain;
  out[2] = (1 + (hb - 1) * k) * gain;
}

/**
 * @returns {any} the particle layer (`engine.particleLayer`)
 */
export function createParticleLayer() {
  let cols = 0, rows = 0;
  const cb = { dirX: 0, dirY: 0, rightX: 0, rightY: 0, tanHalfHFov: 0, planeDistY: 0, horizonRow: 0, cols: 0, rows: 0 };

  const layer = {
    renderer: 'dda',
    cols: 0, rows: 0,
    part: partEmpty8(), partZ: partEmptyF(),
    touched: partEmptyI(), // first `stats.cells` entries are valid (RE-07 precedent)
    minRow: 0, maxRow: -1, prevMinRow: 0, prevMaxRow: -1,
    stats: { cells: 0 },

    /** (Re)allocates the layer for a scene grid (engine grid:changed), like overlay.bind. */
    bind(c, r) {
      cols = c; rows = r;
      layer.cols = c; layer.rows = r;
      layer.part = new Uint8Array(c * r * 4);
      layer.partZ = new Float32Array(c * r);
      // Worst case every live particle lands on a distinct cell - bounded by
      // the grid itself (never more than cols*rows distinct touched cells).
      layer.touched = new Int32Array(c * r);
      layer.minRow = 0; layer.maxRow = -1; layer.prevMinRow = 0; layer.prevMaxRow = -1;
      layer.stats.cells = 0;
    },

    /**
     * @param {import('../fx/particles.js').ParticleSystem} ps engine.particles
     * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} cam
     * @param {{cols:number,rows:number,pxCellW?:number,pxCellH?:number}} rt
     * @param {import('./lighting.js').LightSet} lights
     * @param {any} world
     * @param {Object} palette assets.palette
     * @param {string} [renderer] 'dda' | 'mesh' (resolves cam.projection, as SpritePool.project)
     */
    build(ps, cam, rt, lights, world, palette, renderer = layer.renderer) {
      const part = layer.part, partZ = layer.partZ, touched = layer.touched;
      // 1. Clear the cells touched LAST frame (track which rows that wiped).
      let pMin = rows, pMax = -1;
      const prevCount = layer.stats.cells;
      for (let t = 0; t < prevCount; t++) {
        const i = touched[t];
        partZ[i] = 0;
        const row = (i / cols) | 0;
        if (row < pMin) pMin = row;
        if (row > pMax) pMax = row;
      }
      layer.prevMinRow = pMin; layer.prevMaxRow = pMax;

      // 2. Camera basis once.
      camBasis(cam, rt, cb, renderer);

      // 3. Per-emitter light sample (<= MAX_EMITTERS calls), gain-shaded like a sprite.
      const em = ps.emitters;
      _emDone.fill(0, 0, MAX_EMITTERS);
      for (let s = 0; s < MAX_EMITTERS; s++) {
        if (!em.used[s] || em.live[s] <= 0) continue;
        lightAt(lights, world, em.x[s], em.y[s], em.z[s] + 0.1, 0, 0, 1, _lightScratch);
        shadeMulFromLight(palette.shading, _lightScratch[0], _lightScratch[1], _lightScratch[2], _lightScratch);
        _emMulR[s] = _lightScratch[0]; _emMulG[s] = _lightScratch[1]; _emMulB[s] = _lightScratch[2];
        _emDone[s] = 1;
      }

      // 4. Per live slot, in slot order.
      let nTouched = 0;
      let minRow = rows, maxRow = -1;
      const P = palette;
      const px = ps.px, py = ps.py, pz = ps.pz, age = ps.age, life = ps.life, defOf = ps.def, emOf = ps.em, alive = ps.alive;
      const defRec = ps.defRec, defGlyphs = ps.defGlyphs, defColors = ps.defColors;
      const cap = ps.cap;
      // US-053c AC7 nit (053b nit 1): `resolveFogColor(P, false, f, out)` ignores its `f0` arg entirely on the
      // `isFar=false` branch (it always returns the single `fog.interior` colour) - every particle in this build()
      // would recompute the exact same 3 bytes. Hoisted above the loop (was inside it, keyed on each particle's own
      // `f`, which never mattered).
      resolveFogColor(P, false, 0, _fog3);
      for (let i = 0; i < cap; i++) {
        if (!alive[i]) continue;
        const d = defOf[i], o = d * DEF_STRIDE;
        const n = defRec[o + D.RAMP_LEN];
        let ri = Math.floor((age[i] * n) / life[i]);
        if (ri >= n) ri = n - 1; else if (ri < 0) ri = 0;
        const glyphBase = d * MAX_RAMP;
        const code = defGlyphs[glyphBase + ri];
        if (code === 32) continue; // ' ' = invisible step
        const sizeM = defRec[o + D.SIZE_M];
        // sizeM > 0: worldH = sizeM makes rowsOnScreen the projected diameter in rows (aspect baked into planeDistY).
        if (!projectSprite(cb, cam, px[i], py[i], pz[i], sizeM, _ps)) continue;
        // Compare at layer (f32) precision, like overlay's `put` - so two
        // particles whose f64 depths differ only below f32 precision are a
        // real tie (lower slot wins), not an arbitrary float64 ordering.
        const depth = Math.fround(_ps.depth);
        const c = Math.floor(_ps.colCenter), r = Math.floor(_ps.feetRow);
        // Footprint in cells (odd sizes centred, 2 -> anchor + right/down), clamped 1..3.
        let nx = 1, ny = 1;
        if (sizeM > 0) {
          nx = Math.round(sizeM * cols / (2 * cb.tanHalfHFov * _ps.depth));
          ny = Math.round(_ps.rowsOnScreen);
          nx = nx < 1 ? 1 : nx > 3 ? 3 : nx;
          ny = ny < 1 ? 1 : ny > 3 ? 3 : ny;
        }
        const x0 = nx === 3 ? c - 1 : c, y0 = ny === 3 ? r - 1 : r;
        if (x0 >= cols || x0 + nx <= 0 || y0 >= rows || y0 + ny <= 0) continue;

        const colorBase = (d * MAX_RAMP + ri) * 3;
        let rr = defColors[colorBase], gg = defColors[colorBase + 1], bb = defColors[colorBase + 2];
        const emissive = defRec[o + D.EMISSIVE] !== 0;
        const f = P.util.fogFactor(_ps.fogDepth);
        if (emissive) {
          const fe = Math.min(f, defRec[o + D.EMISSIVE_FOG]);
          if (fe > 0) { rr += (_fog3[0] - rr) * fe; gg += (_fog3[1] - gg) * fe; bb += (_fog3[2] - bb) * fe; }
        } else {
          const s = emOf[i];
          const mr = _emDone[s] ? _emMulR[s] : 1, mg = _emDone[s] ? _emMulG[s] : 1, mb = _emDone[s] ? _emMulB[s] : 1;
          rr *= mr; gg *= mg; bb *= mb;
          if (f > 0) { rr += (_fog3[0] - rr) * f; gg += (_fog3[1] - gg) * f; bb += (_fog3[2] - bb) * f; }
        }
        const br = toByte(rr), bg = toByte(gg), bbb = toByte(bb);
        const gl = code < 32 || code > 126 ? 0 : code - 32; // CellBuffer glyphIdx convention (printable ASCII only)
        for (let yy = y0; yy < y0 + ny; yy++) {
          if (yy < 0 || yy >= rows) continue;
          for (let xx = x0; xx < x0 + nx; xx++) {
            if (xx < 0 || xx >= cols) continue;
            const idx = yy * cols + xx;
            const cur = partZ[idx];
            if (cur !== 0) {
              if (!(depth < cur)) continue; // strict: the lower slot (already written) wins a tie
            } else {
              touched[nTouched++] = idx;
            }
            const o4 = idx * 4;
            part[o4] = br; part[o4 + 1] = bg; part[o4 + 2] = bbb; part[o4 + 3] = gl;
            partZ[idx] = depth;
            if (yy < minRow) minRow = yy;
            if (yy > maxRow) maxRow = yy;
          }
        }
      }
      layer.minRow = minRow; layer.maxRow = maxRow;
      layer.stats.cells = nTouched;
    },
  };

  if (cols > 0 && rows > 0) layer.bind(cols, rows);
  return layer;
}

function toByte(v) { v = Math.floor(v + 0.5); return v < 0 ? 0 : v > 255 ? 255 : v; }
