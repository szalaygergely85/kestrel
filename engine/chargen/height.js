// engine/chargen/height.js (CHARGEN-05, docs/architecture.md 38.29 item 4): height rows.
// heightBase(base, h) -> a copy of the kit base with |h| z rows (from base.stretchRows) duplicated (h > 0) or deleted
// (h < 0); size, layers, bone boxes, joints, anchors and mounts are remapped. Pure and deterministic.

/** Number of output rows per source row (1 normal, 2 duplicated, 0 deleted): picks spread evenly over the sorted stretchRows. */
export function rowCounts(base, h) {
  const sz = base.size[2];
  const counts = new Array(sz).fill(1);
  const rows = [...new Set(base.stretchRows || [])].sort((a, b) => a - b);
  const n = Math.abs(h);
  if (!n) return counts;
  if (!rows.length) throw new Error('heightBase: base has no stretchRows');
  if (h < 0 && n > rows.length - 1) throw new Error(`heightBase: cannot delete ${n} of ${rows.length} stretch rows`);
  for (let k = 0; k < n; k++) {
    const r = rows[Math.floor(((k + 0.5) * rows.length) / n)];
    counts[r] += h > 0 ? 1 : -1;
  }
  return counts;
}

/** Maps a source z (cell index or boundary, may be fractional) to the new grid. first[z] = first output row of source row z. */
function mapZ(first, z) {
  const i = Math.max(0, Math.min(first.length - 2, Math.floor(z)));
  const rowsHere = first[i + 1] - first[i];
  return first[i] + (z - i) * rowsHere;
}

export function heightBase(base, h) {
  if (!h) return base;
  const counts = rowCounts(base, h);
  const [sx, sy, sz] = base.size;
  const first = new Array(sz + 1);
  first[0] = 0;
  for (let z = 0; z < sz; z++) first[z + 1] = first[z] + counts[z];
  const layers = [];
  for (let z = 0; z < sz; z++) for (let c = 0; c < counts[z]; c++) layers.push(base.layers[z]);
  const pt = (p) => [p[0], p[1], mapZ(first, p[2])];
  const bones = {};
  for (const name in base.bones) {
    const b = base.bones[name];
    const q = b.box;
    const z0 = first[q[2]], z1 = first[q[5] + 1] - 1;
    if (z1 < z0) throw new Error(`heightBase: bone ${name} lost all its rows`);
    bones[name] = { ...b, joint: pt(b.joint), box: [q[0], q[1], z0, q[3], q[4], z1] };
  }
  const mapAll = (o) => { if (!o) return o; const r = {}; for (const k in o) r[k] = pt(o[k]); return r; };
  return {
    ...base,
    size: [sx, sy, first[sz]],
    layers,
    bones,
    anchors: mapAll(base.anchors),
    mounts: mapAll(base.mounts),
    anchor: base.anchor.slice(),
    stretchRows: [],
  };
}
