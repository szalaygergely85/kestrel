// US-028 material id table (docs/backlog.md tech notes item 4). Assigns a
// small dense integer id to every material key the G-buffer can carry (id 0
// = unresolved/unwritten), and remembers, per id, which v1 key `fastShade`
// should use and which v2 key (if any) `design/detail-pass.js`'s reference
// shader should use.
//
// Resolution order per key (backlog item 4): `dp.materials[key]` (this key
// IS a v2 key; `.v1` on that record is the v1 fallback, e.g. `ceiling_timber`
// -> v1 'stone') else `dp.remap[key]` (a v1 key with a same/different-named
// v2 counterpart) else v1-only (no v2 entry at all - iron/grate/ash/rock).
//
// Simplification vs. the tech note's fuller vision: ids are resolved through
// one small `Map` (a handful of keys total) rather than pre-baked onto every
// sector object field. Correct and allocation-free per frame either way -
// `idFor` is only ever called during level bind and once per emitted sample
// (a Map.get on <20 keys), never inside a per-row loop.

export function bindShading(P, DP, cellAspect) {
  const idsByKey = new Map();
  const records = [null]; // id 0 = unresolved

  function idFor(key) {
    let id = idsByKey.get(key);
    if (id !== undefined) return id;
    let v1Key = key;
    let v2Key = null;
    if (DP) {
      if (DP.materials[key]) {
        v2Key = key;
        v1Key = DP.materials[key].v1 || key;
      } else if (DP.remap[key]) {
        v2Key = DP.remap[key];
        v1Key = key;
      }
    }
    id = records.length;
    records.push({ key, v1Key, v2Key });
    idsByKey.set(key, id);
    return id;
  }

  // Pre-register every known key so ids are stable across a session
  // regardless of which level binds first.
  for (const k of Object.keys(P.materials)) {
    if (P.materials[k].kind === 'sky') continue;
    idFor(k);
  }
  if (DP) {
    for (const k of Object.keys(DP.materials)) idFor(k);
  }

  return { idFor, records, cellAspect, DP, P };
}

/**
 * Pre-warms ids for every material key a level's legend references, so the
 * first frame that renders it doesn't pay for a handful of extra `idFor`
 * misses. Purely a cache warm - `idFor` remains safe to call for any key at
 * any time (US-006 point lights, US-010's tower, etc. all need nothing more).
 */
export function bindLevel(table, level) {
  for (const ch of Object.keys(level.legend)) {
    const s = level.legend[ch];
    table.idFor(s.wallMat);
    table.idFor(s.floorMat);
    if (s.ceilMat !== 'sky') table.idFor(s.ceilMat);
    if (s.upperMat) table.idFor(s.upperMat);
  }
}
