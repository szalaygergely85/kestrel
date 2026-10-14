// engine/world/bandCache.js (OB109-B2, arch 38.58): per-World cache of finished band bundles.
// A bundle is never mutated after bake except `near.version` at publish (and editor invalidation drops it first).
// Authored zones are pinned; the rest is a byte-capped LRU. Never serialised.

/** Sum of byteLength of every typed array reachable one/two levels deep in an object (scatter/detail sets, collider arrays). */
function sumBytes(o, depth = 0, seen = new Set()) {
  if (!o || typeof o !== 'object' || seen.has(o)) return 0;
  seen.add(o);
  if (ArrayBuffer.isView(o)) return o.byteLength;
  if (depth > 2) return 0;
  let n = 0;
  for (const k in o) { const v = o[k]; if (v && typeof v === 'object') n += sumBytes(v, depth + 1, seen); }
  return n;
}
export const bundleBytes = (b) => sumBytes(b.near) + sumBytes(b.scatter) + sumBytes(b.detail) + sumBytes(b.decor) + sumBytes(b.trunks) + sumBytes(b.detailCol) + sumBytes(b.nav) + sumBytes(b.gi) + (b.classMap ? b.classMap.byteLength : 0);

/** Squared distance from a bundle's zone centre (near rect) to a point. */
function zoneDist2(b, x, y) {
  const g = b.near, dx = g.x0 + g.w * g.cell * 0.5 - x, dy = g.y0 + g.h * g.cell * 0.5 - y;
  return dx * dx + dy * dy;
}

export class BandCache {
  constructor({ maxBytes = 24 * 1048576 } = {}) {
    this.maxBytes = maxBytes; this.map = new Map(); this.tick = 0; this.ver = 0; // ver: bumps on every put / delete (bake-ahead idle memo)
    this._stats = { entries: 0, bytes: 0, hits: 0, misses: 0, bakes: 0, evictions: 0 };
    this.bytes = 0;
    this.focusX = NaN; this.focusY = NaN; // player position: eviction drops the zone whose centre is farthest from it
  }
  setFocus(x, y) { this.focusX = x; this.focusY = y; }
  /** After a bundle grew outside put() (nav tiles): re-count its bytes and trim back under the cap. */
  regrow(b, keep1, keep2) {
    if (this.map.get(b.key) !== b) return;
    const nb = bundleBytes(b); this.bytes += nb - b.bytes; b.bytes = nb;
    this.evict(keep1, keep2, b.key);
  }
  /** Bundle or null; counts a hit/miss and refreshes LRU. */
  get(key) {
    const b = this.map.get(key);
    if (!b) { this._stats.misses++; return null; }
    this._stats.hits++; b.lastUse = ++this.tick; return b;
  }
  /** Presence test without stats or LRU change. */
  has(key) { return this.map.has(key); }
  /** Stores a bundle (computes `bytes`), replaces a same-key entry, then evicts unpinned LRU over the cap (never `protect*` keys). */
  put(b, protect1, protect2) {
    const old = this.map.get(b.key);
    if (old) this.bytes -= old.bytes;
    b.bytes = bundleBytes(b); b.lastUse = ++this.tick;
    this.map.set(b.key, b); this.bytes += b.bytes; this._stats.bakes++; this.ver++;
    this.evict(protect1, protect2, b.key); // the entry just stored is always safe
    return b;
  }
  pin(key, on) { const b = this.map.get(key); if (b) b.pinned = !!on; }
  /** Evicts least-recently-used unpinned entries until under the cap; never `keep1` / `keep2` / `keep3` (current / pending / newest). */
  evict(keep1, keep2, keep3) {
    const fx = this.focusX, fy = this.focusY, far = fx === fx && fy === fy; // WM-CACHE-01: NaN focus -> plain LRU
    while (this.bytes > this.maxBytes) {
      let victim = null, vd = -1;
      for (const b of this.map.values()) {
        if (b.pinned || b.key === keep1 || b.key === keep2 || b.key === keep3) continue;
        if (far) { const d = zoneDist2(b, fx, fy); if (d > vd) { vd = d; victim = b; } }
        else if (!victim || b.lastUse < victim.lastUse) victim = b;
      }
      if (!victim) break;
      this.map.delete(victim.key); this.bytes -= victim.bytes; this._stats.evictions++; this.ver++;
    }
  }
  /** Editor: drops every bundle whose near rect overlaps the world rect. Returns the number dropped. */
  invalidateRect(x0, y0, x1, y1) {
    let n = 0;
    for (const [k, b] of this.map) {
      const g = b.near;
      if (g.x0 < x1 && g.x0 + g.w * g.cell > x0 && g.y0 < y1 && g.y0 + g.h * g.cell > y0) { this.map.delete(k); this.bytes -= b.bytes; n++; this.ver++; }
    }
    return n;
  }
  clear() { this.map.clear(); this.bytes = 0; this.ver++; }
  /** Reused object. */
  stats() { const s = this._stats; s.entries = this.map.size; s.bytes = this.bytes; return s; }
}
