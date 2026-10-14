// QFIX-S6: content entities now respawn from content on load (ground-snapped z (differs ~1e-5), content order),
// so round-trip tests compare states after rounding numbers to 0.1 (ground snap differs by ~2e-3) and sorting entities by id.
export function normState(s) {
  const r = (v) => Array.isArray(v) ? v.map(r) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).map((k) => [k, r(v[k])])) : typeof v === 'number' ? Math.round(v * 10) / 10 : v;
  const o = r(s);
  if (Array.isArray(o.entities)) o.entities.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return o;
}
