// game/js/occlGate.js - OCCL-MAIN-01: `?occl=1` parsing + HZB invalidation on camera cuts (S8-B2-10c NEEDS B1-main).
// Default OFF everywhere (gpucompare/capture/bench included); only an explicit `?occl=1` on WebGPU turns it on.
export function parseOccl(params, backend) {
  const requested = params.get('occl') === '1';
  return { requested, enabled: requested && backend === 'webgpu' };
}

/**
 * Calls `pipeline.invalidateHzb()` on every cut. `getPipeline()` may return null (gl2 / occl off / not ready) = no-op.
 * `trackPose` catches any pose jump nobody announced (waystone, save load, dev pose) when the eye moves > jumpM in one frame.
 */
export function createHzbInvalidator(getPipeline, { jumpM = 6 } = {}) {
  let count = 0, lastReason = '', px = NaN, py = NaN, pz = NaN;
  function invalidate(reason) {
    const p = getPipeline();
    if (!p || typeof p.invalidateHzb !== 'function') return false;
    p.invalidateHzb(); count++; lastReason = reason || '';
    px = NaN; // forget the pose so the next trackPose does not double-fire
    return true;
  }
  function trackPose(x, y, z) {
    if (Number.isFinite(px)) {
      const dx = x - px, dy = y - py, dz = z - pz;
      if (dx * dx + dy * dy + dz * dz > jumpM * jumpM) { invalidate('pose-jump'); }
    }
    px = x; py = y; pz = z;
  }
  return { invalidate, trackPose, get count() { return count; }, get lastReason() { return lastReason; } };
}
