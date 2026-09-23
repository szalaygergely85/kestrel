// Stub (US-024 Phase A). Real implementation: US-016 (far LOD) / US-026
// (near LOD), per docs/architecture.md sections 5 and 7.
//
// Until US-016 lands this is a no-op: it must NOT touch `fb.spans` (per the
// architecture.md section 5 note - "castTerrain is a stub that returns
// without touching the spans"), so `fillSky` still gets to paint everything
// a `castSectors` pass left open, exactly like today's stand-alone
// `skyFallback: true` look.
export function castTerrain(fb, terrain, cam, opts = {}) {
  // intentionally empty
}
