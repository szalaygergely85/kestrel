// OB-155 runtime: one floor query for everything the game places at runtime (drops, leftovers, area marks, return points) and a
// re-snap pass for things placed before terrain.near streamed in (OB-217: near can arrive after world:loaded).
// floorZ = the same support probe the player physics uses (mesh/structure top OR terrain), not terrain-only heightAt.

/** Floor height at (x, y) at or below refZ + reach (default 1.5 m: a bridge deck / floor the player could stand on). Falls back to
 *  World.floorAt / terrain.groundAt. Returns null when nothing is known. */
export function floorZ(world, x, y, refZ = null, reach = 1.5) {
  if (!world) return null;
  if (refZ !== null && Number.isFinite(refZ) && world.supportAt && world.colliders && world.colliders.length) { // colliders: a bare test world has none
    const s = world.supportAt(x, y, refZ + reach, false, null); // airborne+null opts = strict highest surface at or below footZ (World.js:1970)
    if (s && Number.isFinite(s.floorH)) return s.floorH;
  }
  if (world.floorAt) { const f = world.floorAt(x, y); if (f != null && Number.isFinite(f)) return f; }
  const t = world.terrain;
  if (t && t.groundAt) { const g = t.groundAt(x, y); if (Number.isFinite(g)) return g; }
  if (world.heightAt) { const h = world.heightAt(x, y); if (h != null && Number.isFinite(h)) return h; }
  return null;
}

/** Near-terrain stamp: changes whenever the near band (re)loads. 0 before it is ready. */
export const nearStamp = (world) => { const t = world && world.terrain; return t && t.nearReady && t.near ? (t.near.version || 1) : 0; };

/**
 * Tracks entities placed at (x, y, z); keeps their offset above the floor measured at track time and re-applies it once the
 * near band (or a new version of it) arrives. `get()` -> {x,y,z}; `set(z)` writes the new z. Offsets outside [-0.5, 3] m are
 * deliberate content heights (on a shelf, in a tree) and are left alone.
 */
export function createResnap(world) {
  const list = []; let stamp = nearStamp(world);
  return {
    track(get, set) {
      const p = get(), f = floorZ(world, p.x, p.y, p.z), off = f == null ? null : p.z - f;
      list.push({ get, set, off: off != null && off >= -0.5 && off <= 3 ? off : null });
    },
    /** Call every tick (cheap: one compare). Returns the number of re-snapped entries. */
    step() {
      const s = nearStamp(world); if (s === stamp) return 0;
      stamp = s; let n = 0;
      for (const e of list) {
        if (e.off === null) continue;
        const p = e.get(), f = floorZ(world, p.x, p.y, p.z + 4);
        if (f == null) continue;
        const z = f + e.off; if (Math.abs(z - p.z) > 0.02) { e.set(z); n++; }
      }
      return n;
    },
    get size() { return list.length; },
  };
}
