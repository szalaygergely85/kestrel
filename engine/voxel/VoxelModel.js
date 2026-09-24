// engine/voxel/VoxelModel.js - US-039 voxel model format (docs/architecture.md
// 15.1, normative). Constants, JSDoc typedefs (comments only, no runtime
// cost) and the format validator. `engine/voxel/**` imports only
// `../render/GBuffer.js` (for KIND/FACE constants) - never `game/`,
// `design/` or `render/gpu/*` (check-deps rule 1 still applies inside
// engine/). No GDD words live here (the test fixture is a generic
// "quadruped", see fixtures/quadruped12.js).

// ---- constants ---------------------------------------------------------
// KIND_MODEL/FACE_PACKED now live in ../render/GBuffer.js (US-040, 15.2
// item 1); re-exported here so existing `./VoxelModel.js` imports keep
// working without a repo-wide rename.
export { KIND_MODEL, FACE_PACKED } from '../render/GBuffer.js';
export const MAX_VOX_PARTS = 8;
export const MAX_VOX_STEPS = 48;
export const MAX_VOX_DIM = 32;
export const MAX_VOX_INSTANCES = 16;
export const RESERVED_EVENTS = ['animEnd', 'arrive', 'interact', 'removed'];

// Float64Array stride used both for the packed `parts` row (voxelPack.js)
// and the per-part pose output of computeVoxelPose (voxelPose.js) - see
// 15.1's PackedVoxelModel.parts field and the pose L_k layout.
export const PART_STRIDE = 16;

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;

/**
 * @typedef {Object} VoxelModelDef
 * @property {1} version
 * @property {number} cellM                       metres per voxel, 0.01..1
 * @property {[number,number,number]} size         [sx, sy, sz] ints 1..32, sx*sy*sz <= 4096
 * @property {[number,number,number]} anchor       voxel units, feet centre
 * @property {Object<string,string|null>} mats     1 char (0x21..0x7E) -> material key, or null
 * @property {string[][]} layers                   layers[z][y] = row string of sx chars
 * @property {Object<string,VoxelPartDef>} parts    insertion order = part index 0..7
 * @property {Object<string,VoxelClipDef>} [animations]
 *
 * @typedef {Object} VoxelPartDef
 * @property {[number,number,number,number,number,number]} box   [x0,y0,z0,x1,y1,z1] ints, half-open
 * @property {[number,number,number]} pivot
 * @property {string} [parent]                                   an EARLIER part
 *
 * @typedef {Object} VoxelClipDef
 * @property {number} [fps]
 * @property {number[]} [durations]
 * @property {boolean} loop
 * @property {'linear'|'step'} [interp]
 * @property {Object<string,number|number[]>} [events]
 * @property {Array<Object<string,{rot?:[number,number,number], pos?:[number,number,number]}>>} frames
 */

// ---- JSON-safety (rule 1) ---------------------------------------------------

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Recursively checks that `v` contains only JSON-safe values, pushing one
 * error per bad node into `errors` (path-prefixed). Returns true if clean. */
function checkJsonSafe(v, path, errors) {
  if (v === null) return true;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return true;
  if (t === 'number') {
    if (!Number.isFinite(v)) { errors.push(`${path}: not finite (${v})`); return false; }
    return true;
  }
  if (Array.isArray(v)) {
    let ok = true;
    for (let i = 0; i < v.length; i++) ok = checkJsonSafe(v[i], `${path}[${i}]`, errors) && ok;
    return ok;
  }
  if (t === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    let ok = true;
    for (const k of Object.keys(v)) ok = checkJsonSafe(v[k], `${path}.${k}`, errors) && ok;
    return ok;
  }
  errors.push(`${path}: not JSON-safe (${t === 'object' ? Object.prototype.toString.call(v) : t})`);
  return false;
}

/**
 * Validates a VoxelModelDef against architecture.md 15.1. Collects ALL
 * problems (does not stop at the first). `opts.materialKeys`, if given, is
 * an Iterable<string> of known material keys - every non-null `mats` value
 * must be one of them.
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateVoxelModel(def, opts) {
  const errors = [];
  const warnings = [];
  const materialKeys = opts && opts.materialKeys ? new Set(opts.materialKeys) : null;

  if (def === null || typeof def !== 'object' || Array.isArray(def)) {
    errors.push('voxel: expected an object');
    return { errors, warnings };
  }
  // Logs every not-JSON-safe leaf (rule 1) but does NOT stop here - the
  // other rules below still run (and produce their own, usually more
  // specific, errors for the same bad value) so a def with several
  // independent faults reports several errors, not just the first one.
  checkJsonSafe(def, 'voxel', errors);

  if (def.version !== 1) errors.push(`voxel.version: expected 1, got ${JSON.stringify(def.version)}`);

  if (!isFiniteNumber(def.cellM) || def.cellM < 0.01 || def.cellM > 1) {
    errors.push(`voxel.cellM: expected a number in [0.01, 1], got ${JSON.stringify(def.cellM)}`);
  }

  let sx = 0, sy = 0, sz = 0, sizeOk = false;
  if (Array.isArray(def.size) && def.size.length === 3) {
    sizeOk = true;
    for (let i = 0; i < 3; i++) {
      const v = def.size[i];
      if (!Number.isInteger(v) || v < 1 || v > MAX_VOX_DIM) {
        errors.push(`voxel.size[${i}]: expected an int in [1, ${MAX_VOX_DIM}], got ${JSON.stringify(v)}`);
        sizeOk = false;
      }
    }
    if (sizeOk) {
      sx = def.size[0]; sy = def.size[1]; sz = def.size[2];
      if (sx * sy * sz > 4096) { errors.push(`voxel.size: product ${sx * sy * sz} exceeds 4096`); sizeOk = false; }
    }
  } else {
    errors.push('voxel.size: expected [sx, sy, sz]');
  }

  if (Array.isArray(def.anchor) && def.anchor.length === 3) {
    for (let i = 0; i < 3; i++) {
      const v = def.anchor[i];
      const lim = sizeOk ? def.size[i] : Infinity;
      if (!isFiniteNumber(v) || v < 0 || v > lim) {
        errors.push(`voxel.anchor[${i}]: expected a number in [0, ${sizeOk ? lim : 'size'}], got ${JSON.stringify(v)}`);
      }
    }
  } else {
    errors.push('voxel.anchor: expected [ax, ay, az]');
  }

  // ---- mats (rule 3) --------------------------------------------------------
  const validChars = new Set(['.', ' ']);
  let matsOk = false;
  if (def.mats !== null && typeof def.mats === 'object' && !Array.isArray(def.mats)) {
    matsOk = true;
    let nonNull = 0;
    for (const k of Object.keys(def.mats)) {
      const v = def.mats[k];
      if (k.length !== 1 || k.charCodeAt(0) < 0x21 || k.charCodeAt(0) > 0x7E) {
        errors.push(`voxel.mats['${k}']: key must be one char 0x21..0x7E`);
        continue;
      }
      if (k === '.' && v !== null) {
        errors.push(`voxel.mats['.']: must be null`);
        continue;
      }
      if (v === null) { validChars.add(k); continue; }
      if (typeof v !== 'string') {
        errors.push(`voxel.mats['${k}']: expected a string or null, got ${JSON.stringify(v)}`);
        continue;
      }
      nonNull++;
      if (materialKeys && !materialKeys.has(v)) {
        errors.push(`voxel.mats['${k}']: unknown material key '${v}'`);
      }
      validChars.add(k);
    }
    if (nonNull > 255) errors.push(`voxel.mats: ${nonNull} non-null entries, expected <= 255`);
  } else {
    errors.push('voxel.mats: expected an object');
  }

  // ---- layers (rule 4) -------------------------------------------------------
  const claimedOwner = sizeOk ? new Int16Array(sx * sy * sz).fill(-1) : null; // -1 = unclaimed; used by rule 5 below too
  if (sizeOk && Array.isArray(def.layers)) {
    if (def.layers.length !== sz) {
      errors.push(`voxel.layers: ${def.layers.length} layers, expected ${sz}`);
    }
    for (let z = 0; z < def.layers.length; z++) {
      const layer = def.layers[z];
      if (!Array.isArray(layer)) { errors.push(`voxel.layers[${z}]: expected an array of row strings`); continue; }
      if (layer.length !== sy) {
        errors.push(`voxel.layers[${z}]: ${layer.length} rows, expected ${sy}`);
      }
      for (let y = 0; y < layer.length; y++) {
        const row = layer[y];
        if (typeof row !== 'string') { errors.push(`voxel.layers[${z}][${y}]: expected a string`); continue; }
        if (row.length !== sx) {
          errors.push(`voxel.layers[${z}][${y}]: row length ${row.length}, expected ${sx}`);
        }
        for (let x = 0; x < row.length && x < sx; x++) {
          const ch = row[x];
          if (!validChars.has(ch)) {
            errors.push(`voxel.layers[${z}][${y}][${x}]: unknown voxel char '${ch}'`);
          } else if (claimedOwner && ch !== '.' && ch !== ' ') {
            claimedOwner[x + sx * (y + sy * z)] = -2; // -2 = "non-empty, not yet assigned to a part"
          }
        }
      }
    }
  } else if (!sizeOk) {
    // size itself is broken; skip layers checks (would just cascade noise)
  } else {
    errors.push('voxel.layers: expected an array of z-layers');
  }

  // ---- parts (rule 5) --------------------------------------------------------
  const partNames = [];
  if (def.parts !== null && typeof def.parts === 'object' && !Array.isArray(def.parts)) {
    const names = Object.keys(def.parts);
    if (names.length < 1) errors.push('voxel.parts: expected 1..8 parts, got 0');
    if (names.length > 8) errors.push(`voxel.parts: ${names.length} parts, expected <= 8 (> 8 parts)`);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      partNames.push(name);
      const pd = def.parts[name];
      const path = `voxel.parts['${name}']`;
      if (!NAME_RE.test(name)) errors.push(`${path}: invalid part name`);
      if (!pd || typeof pd !== 'object') { errors.push(`${path}: expected an object`); continue; }

      let boxOk = false;
      if (Array.isArray(pd.box) && pd.box.length === 6) {
        const [x0, y0, z0, x1, y1, z1] = pd.box;
        const intsOk = [x0, y0, z0, x1, y1, z1].every(Number.isInteger);
        if (!intsOk) {
          errors.push(`${path}.box: expected 6 ints`);
        } else if (!(x0 >= 0 && x0 < x1 && (!sizeOk || x1 <= sx)
          && y0 >= 0 && y0 < y1 && (!sizeOk || y1 <= sy)
          && z0 >= 0 && z0 < z1 && (!sizeOk || z1 <= sz))) {
          errors.push(`${path}.box: part box outside the grid`);
        } else {
          boxOk = true;
          const bx = x1 - x0, by = y1 - y0, bz = z1 - z0;
          if (bx + by + bz > 48) errors.push(`${path}.box: box extent ${bx + by + bz} exceeds 48`);
          if (claimedOwner && sizeOk) {
            let owns = 0;
            for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
              const gi = x + sx * (y + sy * z);
              if (claimedOwner[gi] === -2) { claimedOwner[gi] = i; owns++; }
              else if (claimedOwner[gi] === -2) { /* unreachable, kept for clarity */ }
            }
            if (owns === 0) warnings.push(`${path}: owns no voxels`);
          }
        }
      } else {
        errors.push(`${path}.box: expected [x0,y0,z0,x1,y1,z1]`);
      }

      if (Array.isArray(pd.pivot) && pd.pivot.length === 3) {
        for (let k = 0; k < 3; k++) if (!isFiniteNumber(pd.pivot[k])) errors.push(`${path}.pivot[${k}]: expected a finite number`);
      } else {
        errors.push(`${path}.pivot: expected [px,py,pz]`);
      }

      if (pd.parent !== undefined) {
        const parentIdx = partNames.indexOf(pd.parent);
        // partNames so far includes names[0..i] (this one just pushed) - an
        // earlier part is any index < i.
        const earlierIdx = names.slice(0, i).indexOf(pd.parent);
        if (earlierIdx < 0) errors.push(`${path}.parent: bad parent '${pd.parent}' (unknown or later)`);
        void parentIdx;
      }
      void boxOk;
    }
  } else {
    errors.push('voxel.parts: expected an object');
  }
  if (claimedOwner) {
    for (let gi = 0; gi < claimedOwner.length; gi++) {
      if (claimedOwner[gi] === -2) {
        const z = Math.floor(gi / (sx * sy));
        const rem = gi - z * sx * sy;
        const y = Math.floor(rem / sx);
        const x = rem - y * sx;
        errors.push(`voxel.layers[${z}][${y}][${x}]: orphan voxel at [${z}][${y}][${x}]`);
      }
    }
  }

  // ---- animations (rule 6) ---------------------------------------------------
  if (def.animations !== undefined) {
    if (def.animations === null || typeof def.animations !== 'object' || Array.isArray(def.animations)) {
      errors.push('voxel.animations: expected an object');
    } else {
      for (const clipName of Object.keys(def.animations)) {
        const clip = def.animations[clipName];
        const path = `voxel.animations['${clipName}']`;
        if (!NAME_RE.test(clipName)) errors.push(`${path}: invalid clip name`);
        if (!clip || typeof clip !== 'object') { errors.push(`${path}: expected an object`); continue; }

        const hasFps = clip.fps !== undefined;
        const hasDur = clip.durations !== undefined;
        if (hasFps === hasDur) {
          errors.push(`${path}: expected exactly one of fps | durations`);
        } else if (hasFps) {
          if (!isFiniteNumber(clip.fps) || clip.fps <= 0 || clip.fps > 60) errors.push(`${path}.fps: expected 0 < fps <= 60`);
        }

        let n = 0;
        if (!Array.isArray(clip.frames) || clip.frames.length < 1 || clip.frames.length > 64) {
          errors.push(`${path}.frames: expected 1..64 frames`);
        } else {
          n = clip.frames.length;
        }

        if (hasDur) {
          if (!Array.isArray(clip.durations) || (n && clip.durations.length !== n)) {
            errors.push(`${path}.durations: expected ${n || 'frames.length'} entries`);
          } else {
            for (let i = 0; i < clip.durations.length; i++) {
              if (!isFiniteNumber(clip.durations[i]) || clip.durations[i] <= 0) errors.push(`${path}.durations[${i}]: expected > 0`);
            }
          }
        }

        if (typeof clip.loop !== 'boolean') errors.push(`${path}.loop: expected a boolean`);
        if (clip.interp !== undefined && clip.interp !== 'linear' && clip.interp !== 'step') {
          errors.push(`${path}.interp: expected 'linear' or 'step'`);
        }

        if (Array.isArray(clip.frames)) {
          for (let f = 0; f < clip.frames.length; f++) {
            const frame = clip.frames[f];
            const fpath = `${path}.frames[${f}]`;
            if (!frame || typeof frame !== 'object') { errors.push(`${fpath}: expected an object`); continue; }
            for (const partName of Object.keys(frame)) {
              if (partNames.length && partNames.indexOf(partName) < 0) {
                errors.push(`${fpath}: unknown part name '${partName}'`);
                continue;
              }
              const pf = frame[partName];
              if (!pf || typeof pf !== 'object') { errors.push(`${fpath}['${partName}']: expected an object`); continue; }
              for (const key of ['rot', 'pos']) {
                if (pf[key] === undefined) continue;
                if (!Array.isArray(pf[key]) || pf[key].length !== 3) {
                  errors.push(`${fpath}['${partName}'].${key}: expected [x,y,z]`);
                  continue;
                }
                for (let k = 0; k < 3; k++) {
                  const v = pf[key][k];
                  if (!isFiniteNumber(v)) errors.push(`${fpath}['${partName}'].${key}[${k}]: expected a finite number`);
                  else if (key === 'rot' && Math.abs(v) > 180) errors.push(`${fpath}['${partName}'].rot[${k}]: |rot| must be <= 180`);
                }
              }
            }
          }
        }

        if (clip.events !== undefined) {
          if (clip.events === null || typeof clip.events !== 'object' || Array.isArray(clip.events)) {
            errors.push(`${path}.events: expected an object`);
          } else {
            for (const tag of Object.keys(clip.events)) {
              const epath = `${path}.events['${tag}']`;
              if (!NAME_RE.test(tag)) errors.push(`${epath}: invalid event tag`);
              if (RESERVED_EVENTS.indexOf(tag) >= 0) errors.push(`${epath}: reserved event name '${tag}'`);
              const val = clip.events[tag];
              const indices = Array.isArray(val) ? val : [val];
              for (const idx of indices) {
                if (!Number.isInteger(idx) || idx < 0 || (n && idx >= n)) {
                  errors.push(`${epath}: event index ${JSON.stringify(idx)} out of range [0, ${n})`);
                }
              }
            }
          }
        }
      }
    }
  }

  return { errors, warnings };
}

/** Throws one Error listing every validation problem (errors only). */
export function assertVoxelModel(def, opts) {
  const { errors } = validateVoxelModel(def, opts);
  if (errors.length) {
    throw new Error(`VoxelModelDef invalid:\n${errors.join('\n')}`);
  }
}
