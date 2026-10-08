// GFX-02: pure auto-pick of the quality preset (D-047 point 3). No DOM, no engine import.
// pickQuality(adapterInfo, samples, opts) -> { name, reason, tier }
//   tier = candidate preset from the adapter alone ('low' integrated/software, 'medium' unknown, 'high' discrete)
//   samples = per-frame ms measured at the candidate (GPU ms preferred; opts.kind 'frame' = wall-clock frame interval)
// Steps: p95 > 14 ms -> one step down (at most twice in total); p95 < 7 ms on 'high' -> 'ultra' once.
// Frame-interval samples are vsync-capped (16.7 ms at 60 Hz), so with kind 'frame' only a clear miss (> 22 ms) steps down and never up.

export const TIERS = Object.freeze(['low', 'medium', 'high', 'ultra']);
export const HOLD_MS = 18.5; // wall-clock frame p95 at or under this = 60 fps is held
export const DOWN_MS = 14, UP_MS = 7, FRAME_DOWN_MS = 22, MAX_DOWN = 2;

/** Candidate tier from adapter info ({vendor, architecture, description, fallback, label}). */
export function tierFromAdapter(info) {
  if (!info) return { tier: 'medium', why: 'no adapter info' };
  const text = [info.vendor, info.architecture, info.description, info.label].filter(Boolean).join(' ').toLowerCase();
  if (info.fallback || /swiftshader|llvmpipe|software|basic render|softpipe/.test(text)) return { tier: 'low', why: 'software adapter' };
  if (/nvidia|geforce|\brtx\b|\bgtx\b|quadro/.test(text)) return { tier: 'high', why: 'discrete NVIDIA' };
  if (/\barc\(?(tm)?\)?\s*[ab]\d{3}/.test(text)) return { tier: 'high', why: 'discrete Intel Arc' };
  if (/intel/.test(text)) {
    if (/xe-lpg|xe2|arc\(?(tm)?\)? graphics|0x0*7d|0x0*64/.test(text)) return { tier: 'medium', why: 'Intel Arc integrated' };
    return { tier: 'low', why: 'integrated Intel' };
  }
  if (/amd|radeon|\bati\b/.test(text)) {
    if (/radeon\(?(tm)?\)? (rx|pro|vii)|\brx ?\d{3,4}|rdna|gcn/.test(text) && !/radeon\(?(tm)?\)? graphics/.test(text)) return { tier: 'high', why: 'discrete AMD' };
    return { tier: 'low', why: 'integrated AMD' };
  }
  return { tier: 'medium', why: 'unknown adapter' };
}

export function p95(samples) {
  const v = (samples || []).filter(x => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return NaN;
  return v[Math.min(v.length - 1, Math.ceil(0.95 * v.length) - 1)];
}

/**
 * @param {object|null} adapterInfo
 * @param {number[]} samples  ms per frame measured at the candidate tier
 * @param {{kind?:'gpu'|'frame', minSamples?:number, at?:string, frameSamples?:number[]}} [opts]
 */
export function pickQuality(adapterInfo, samples, opts = {}) {
  const cand = tierFromAdapter(adapterInfo), why = cand.why;
  const tier = TIERS.includes(opts.at) ? opts.at : cand.tier; // opts.at = the preset the samples were measured at (redetect)
  const kind = opts.kind === 'frame' ? 'frame' : 'gpu';
  const minSamples = opts.minSamples ?? 20;
  const valid = (samples || []).filter(x => Number.isFinite(x) && x >= 0);
  if (valid.length < minSamples) return { name: tier, tier, reason: `${why}${valid.length ? `, only ${valid.length} samples` : ', no benchmark'}` };
  const q = p95(valid), down = kind === 'frame' ? FRAME_DOWN_MS : DOWN_MS;
  let idx = TIERS.indexOf(tier), steps = 0;
  // GPU timestamps can include the vsync wait (seen: cast pass p95 = 16.7 ms on an RTX 4060 with vsync on, 4 ms with vsync off).
  // So a GPU-timer step down needs corroboration: the frames must actually miss 60 fps (frame p95 > HOLD_MS) when frame samples are given.
  const fq = opts.frameSamples ? p95(opts.frameSamples) : NaN;
  const vsyncSuspect = kind === 'gpu' && Number.isFinite(fq) && fq <= HOLD_MS;
  if (q > down && vsyncSuspect) return { name: tier, tier, reason: `${why}, gpu p95 ${q.toFixed(1)} ms looks vsync-padded, frames p95 ${fq.toFixed(1)} ms hold 60 fps at ${tier}` };
  if (q > down) {
    // The next tier is cheaper but unmeasured: assume ~2x per step, stop once the estimate is under the limit (max MAX_DOWN steps).
    let est = q;
    while (est > down && steps < MAX_DOWN && idx > 0) { idx--; steps++; est /= 2; }
    return { name: TIERS[idx], tier, reason: `${why}, p95 ${q.toFixed(1)} ms ${kind} > ${down} at ${tier} -> ${TIERS[idx]}` };
  }
  if (kind === 'gpu' && tier === 'high' && q < UP_MS) return { name: 'ultra', tier, reason: `${why}, p95 ${q.toFixed(1)} ms gpu < ${UP_MS} at high -> ultra` };
  return { name: tier, tier, reason: `${why}, p95 ${q.toFixed(1)} ms ${kind} at ${tier}` };
}
