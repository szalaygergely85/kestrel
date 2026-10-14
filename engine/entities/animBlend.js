// engine/entities/animBlend.js - ANIM-BLEND-01b (architecture.md 38.68 section 3): the view-side blender that fills `inst.layers`
// (AnimLayers, voxelPose.js) from a request (clip or blend set) + speed + additive hit. View only, never in the sim, never serialized.
// Rule 38.61: after attach() update() allocates nothing (typed-array state, int-only helper args, no closures).
//
// io (Float64Array, set by the caller before update):
//   [0] request: clip index (>= 0) or -(set+1) for a blend set    [1] speed (m/s, sets only)
//   [2] phase01 (>= 0 = take this phase, -1 = self-advance)       [3] hit: additive index (>= 0 (re)starts it, -1 none)
//   [4] rate (time scale, 0 = 1)
// outputs (written by update): [5] blended stride (m, 0 = no set), [6] dominant clip (footfall pattern; w2 < 0.5 ? A : B).
// `update(slot, pm, dtMs, driverIo)`: with a legDriver io, phase01 = driverIo[8] while its legs are active (io[10] = 1), and the blended
// stride is handed back via driverIo[11] (legDriver uses it from ANIM-BLEND-01c on; 0 = its own formula).
// Limit: a request change in the MIDDLE of a fade keeps the old pose only when the current source is a single clip (the from source
// is then {current, old-from} @ fromW); a mid-fade change out of a half-blended set collapses that set to its dominant clip.

const ST = 24; // per-slot state stride
const S_USED = 0, S_INIT = 1, S_REQ = 2, S_A = 3, S_B = 4, S_W2 = 5, S_PH = 6, S_SET = 7;
const S_FA = 8, S_FB = 9, S_FW2 = 10, S_FPA = 11, S_FPB = 12, S_FT = 13, S_FMS = 14, S_FROMW = 15;
const S_AIDX = 16, S_AT = 17, S_AW = 18;
const L_N = 20;
const RATE_LO = 0.6, RATE_HI = 1.6;
const NONE16 = 0xFFFF;


// total clip length (ms), cached on the clip object at attach() (cold) so the hot path reads a field, no summing / call result boxing
function cacheTotals(pm) {
  const all = pm.blend ? pm.clips.concat(pm.blend.addClips) : pm.clips;
  for (const c of all) if (c.totMs === undefined) { let t = 0; for (let i = 0; i < c.n; i++) t += c.durMs[i]; c.totMs = t; }
}

// Writes frame / tMs for a clip position into L[li], L[li+1]. `pos` is read from S[si]: looping = phase01, else ms (held at the end).
function place(clip, S, si, L, li) {
  let t;
  if (clip.loop) { const p = S[si]; t = (p - Math.floor(p)) * clip.totMs; }
  else { t = S[si]; }
  let f = 0;
  while (f < clip.n - 1 && t >= clip.durMs[f]) { t -= clip.durMs[f]; f++; }
  if (!clip.loop && f === clip.n - 1) t = 0; // held on the last key
  L[li] = f; L[li + 1] = t;
}
// Advances S[si] by dtMs (looping: phase01 wrap; else ms capped at the clip length).
const _dt = new Float64Array(2); // [0] scaled dt (ms), [1] start phase for enter(): typed so no call boxes a double (38.61)
function step(clip, S, si) {
  const dtMs = _dt[0];
  if (clip.loop) { const p = S[si] + dtMs / clip.totMs; S[si] = p - Math.floor(p); }
  else { const t = S[si] + dtMs, tot = clip.totMs; S[si] = t > tot ? tot : t; }
}

export function createAnimBlender(capacity = 64) {
  const S = new Float64Array(capacity * ST);
  const layers = new Float64Array(capacity * L_N);
  const views = [];
  for (let i = 0; i < capacity; i++) views.push(layers.subarray(i * L_N, (i + 1) * L_N));
  const pms = new Array(capacity).fill(null);
  const io = new Float64Array(8);
  const bl = { io, capacity, attach, release, reset, layersOf, update };

  function attach(pm) {
    if (!pm || !pm.clips) return -1;
    for (let s = 0; s < capacity; s++) {
      if (S[s * ST + S_USED] === 0) { S.fill(0, s * ST, (s + 1) * ST); S[s * ST + S_USED] = 1; pms[s] = pm; cacheTotals(pm); clear(s); return s; }
    }
    return -1;
  }
  function release(slot) { if (slot >= 0 && slot < capacity) { S[slot * ST + S_USED] = 0; pms[slot] = null; views[slot][0] = 0; } }
  function layersOf(slot) { return views[slot]; }
  function clear(slot) {
    const o = slot * ST;
    S[o + S_INIT] = 0; S[o + S_A] = -1; S[o + S_B] = -1; S[o + S_FA] = -1; S[o + S_FB] = -1; S[o + S_AIDX] = -1; S[o + S_SET] = -1;
    S[o + S_W2] = 0; S[o + S_PH] = 0; S[o + S_FROMW] = 0; S[o + S_FMS] = 0; S[o + S_FT] = 0; S[o + S_AW] = 0; S[o + S_AT] = 0;
    views[slot][0] = 0;
  }
  /** Spawn / load / teleport: no fade, starts on `clipIdx` (or -(set+1)) at phase 0. */
  function reset(slot, clipIdx) {
    if (slot < 0 || !pms[slot]) return;
    clear(slot);
    const o = slot * ST;
    S[o + S_REQ] = clipIdx; S[o + S_INIT] = 1;
    _dt[1] = 0; io[1] = 0; enter(slot, pms[slot], clipIdx);
    write(slot, pms[slot]);
  }

  // Sets the current source for request `req`; `speed` picks the set weights. Does not touch the from source.
  function enter(slot, pm, req) {
    const o = slot * ST, ph = _dt[1];
    if (req < 0) { S[o + S_SET] = -req - 1; S[o + S_PH] = ph; weights(slot, pm); }
    else { S[o + S_SET] = -1; S[o + S_A] = req; S[o + S_B] = -1; S[o + S_W2] = 0; S[o + S_PH] = pm.clips[req] && pm.clips[req].loop ? ph : 0; }
  }
  // Set weights from the speed: at_i <= speed < at_(i+1) -> smoothstep blend of clips i, i+1; below / above: the end clip only.
  function weights(slot, pm) {
    const o = slot * ST, b = pm.blend, si = S[o + S_SET], speed = io[1];
    const a = b.setStart[si], e = b.setStart[si + 1];
    let k = a;
    while (k < e - 1 && speed >= b.setAt[k + 1]) k++;
    S[o + S_A] = b.setClip[k];
    if (k >= e - 1 || speed <= b.setAt[k]) { S[o + S_B] = -1; S[o + S_W2] = 0; return; }
    S[o + S_B] = b.setClip[k + 1];
    const u = (speed - b.setAt[k]) / (b.setAt[k + 1] - b.setAt[k]); // in (0,1) here: k is the segment holding speed
    S[o + S_W2] = u * u * (3 - 2 * u);
  }
  function domClip(o) { return S[o + S_W2] < 0.5 || S[o + S_B] < 0 ? S[o + S_A] | 0 : S[o + S_B] | 0; } // clip index (int: no boxing)
  function fadeMs(pm, from, to) {
    const b = pm.blend;
    if (!b) return 150;
    const n = pm.clips.length;
    if (from >= 0 && to >= 0) { const p = b.fadePair[from * n + to]; if (p !== NONE16) return p; }
    if (to >= 0) { const i = b.fadeInto[to]; if (i !== NONE16) return i; }
    return b.fadeDefault;
  }

  function update(slot, pm, dtMs, driverIo) {
    if (slot < 0 || !pm) return;
    const o = slot * ST, clips = pm.clips;
    const req = io[0], speed = io[1];
    let ph = io[2];
    const hit = io[3];
    const rate = io[4] > 0 ? io[4] : 1;
    const dt = dtMs * rate;
    _dt[0] = dt;
    const b = pm.blend;
    if (driverIo && driverIo[10] === 1) ph = driverIo[8];
    if (S[o + S_INIT] === 0) { S[o + S_REQ] = req; S[o + S_INIT] = 1; _dt[1] = ph >= 0 ? ph : 0; enter(slot, pm, req); }
    else {
      // 1. advance the from source and the fade
      if (S[o + S_FA] >= 0) {
        step(clips[S[o + S_FA]], S, o + S_FPA);
        if (S[o + S_FB] >= 0) step(clips[S[o + S_FB]], S, o + S_FPB);
        S[o + S_FT] += dt;
        if (S[o + S_FT] >= S[o + S_FMS]) { S[o + S_FA] = -1; S[o + S_FB] = -1; S[o + S_FROMW] = 0; }
        else { const u = S[o + S_FT] / S[o + S_FMS]; S[o + S_FROMW] = 1 - u * u * (3 - 2 * u); } // smoothstep inlined (no boxed call result)
      }
      // 2. advance the current source (old target) - phase from the leg driver / caller, else self-advance
      const A = S[o + S_A], B = S[o + S_B], w2 = S[o + S_W2], si = S[o + S_SET];
      if (ph >= 0) S[o + S_PH] = clips[A].loop ? ph - Math.floor(ph) : S[o + S_PH] + dt;
      else if (si >= 0 && b) {
        // set: both clips share one phase; rate = speed / blended `at` clamped, so the feet keep the stride
        const sa = b.setStart[si];
        let atB = 0, tB = clips[A].totMs;
        if (B >= 0) {
          let ka = sa; while (b.setClip[ka] !== A) ka++;
          atB = b.setAt[ka] + (b.setAt[ka + 1] - b.setAt[ka]) * w2;
          tB += (clips[B].totMs - tB) * w2;
        } else { let ka = sa; while (b.setClip[ka] !== A) ka++; atB = b.setAt[ka]; }
        let r = atB > 1e-6 ? speed / atB : 1;
        r = r < RATE_LO ? RATE_LO : r > RATE_HI ? RATE_HI : r;
        const p = S[o + S_PH] + (r * dt) / tB;
        S[o + S_PH] = p - Math.floor(p);
      } else step(clips[A], S, o + S_PH);
      // 3. a new request: copy the current source into the from slot, fade by the table
      if (req !== S[o + S_REQ]) {
        const midFade = S[o + S_FA] >= 0 && S[o + S_FROMW] > 0;
        const oldDom = domClip(o);
        const oA = S[o + S_A], oB = S[o + S_B], oW = S[o + S_W2], oPh = S[o + S_PH];
        const fA = S[o + S_FA], fB = S[o + S_FB], fW2 = S[o + S_FW2], fPA = S[o + S_FPA], fPB = S[o + S_FPB], fromW = S[o + S_FROMW];
        _dt[1] = ph >= 0 ? ph : 0; enter(slot, pm, req);
        S[o + S_REQ] = req;
        const ms = fadeMs(pm, oldDom, domClip(o));
        if (ms > 0) {
          if (midFade) { // {current dominant, old-from dominant} @ fromW: exact for single-clip sources
            const cA = oW < 0.5 || oB < 0 ? oA : oB;
            const fD = fW2 < 0.5 || fB < 0 ? fA : fB, fPh = fW2 < 0.5 || fB < 0 ? fPA : fPB;
            S[o + S_FA] = cA; S[o + S_FPA] = oPh;
            S[o + S_FB] = fD; S[o + S_FPB] = fPh; S[o + S_FW2] = fromW;
          } else {
            S[o + S_FA] = oA; S[o + S_FB] = oB; S[o + S_FW2] = oW; S[o + S_FPA] = oPh; S[o + S_FPB] = oPh;
          }
          S[o + S_FT] = 0; S[o + S_FMS] = ms; S[o + S_FROMW] = 1;
        } else { S[o + S_FA] = -1; S[o + S_FB] = -1; S[o + S_FROMW] = 0; }
      }
    }
    if (S[o + S_SET] >= 0 && b) weights(slot, pm);
    // 4. additive envelope: hit (re)starts; up in inMs, clip time runs, down in outMs; addW = gain * env
    if (hit >= 0 && b && hit < b.addClips.length) { S[o + S_AIDX] = hit; S[o + S_AT] = 0; }
    else if (S[o + S_AIDX] >= 0) S[o + S_AT] += dt;
    const ai = S[o + S_AIDX];
    S[o + S_AW] = 0;
    if (ai >= 0 && b) {
      const tot = b.addClips[ai].totMs, t = S[o + S_AT];
      if (t >= tot) S[o + S_AIDX] = -1;
      else {
        let e = 1;
        const inM = b.addIn[ai], outM = b.addOut[ai];
        if (inM > 0 && t < inM) e = t / inM;
        if (outM > 0 && tot - t < outM) { const d = (tot - t) / outM; if (d < e) e = d; }
        S[o + S_AW] = b.addGain[ai] * (e * e * (3 - 2 * e)); // e in [0,1]
      }
    }
    // outputs
    const dA = domClip(o);
    io[6] = dA;
    let stride = 0;
    if (S[o + S_SET] >= 0 && b) {
      const sa = b.setStart[S[o + S_SET]];
      let ka = sa; while (b.setClip[ka] !== S[o + S_A]) ka++;
      const A = S[o + S_A], B = S[o + S_B], w2 = S[o + S_W2];
      stride = b.setAt[ka] * clips[A].totMs * 0.001;
      if (B >= 0) stride += (b.setAt[ka + 1] * clips[B].totMs * 0.001 - stride) * w2;
    }
    io[5] = stride;
    if (driverIo) driverIo[11] = stride;
    write(slot, pm);
  }

  // Fills AnimLayers from the state.
  function write(slot, pm) {
    const o = slot * ST, L = views[slot], clips = pm.clips;
    const A = S[o + S_A];
    L[0] = 1;
    L[1] = A; place(clips[A], S, o + S_PH, L, 2);
    const B = S[o + S_B];
    L[4] = B; L[7] = S[o + S_W2];
    if (B >= 0) place(clips[B], S, o + S_PH, L, 5); else { L[5] = 0; L[6] = 0; }
    const fA = S[o + S_FA];
    if (fA >= 0 && S[o + S_FROMW] > 0) {
      L[8] = fA; place(clips[fA], S, o + S_FPA, L, 9);
      const fB = S[o + S_FB];
      L[11] = fB; L[14] = S[o + S_FW2];
      if (fB >= 0) place(clips[fB], S, o + S_FPB, L, 12); else { L[12] = 0; L[13] = 0; }
      L[15] = S[o + S_FROMW];
    } else { L[8] = -1; L[11] = -1; L[14] = 0; L[15] = 0; }
    const ai = S[o + S_AIDX];
    if (ai >= 0 && S[o + S_AW] !== 0) {
      L[16] = ai; L[19] = S[o + S_AW];
      const ac = pm.blend.addClips[ai];
      let t = S[o + S_AT], f = 0;
      while (f < ac.n - 1 && t >= ac.durMs[f]) { t -= ac.durMs[f]; f++; }
      L[17] = f; L[18] = t;
    } else { L[16] = -1; L[19] = 0; }
  }
  return bl;
}
