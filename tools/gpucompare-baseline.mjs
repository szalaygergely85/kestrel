// tools/gpucompare-baseline.mjs (S8-B1-13) - pure helpers for `capture-browser --baseline <file>`.
// A baseline = row name -> 'PASS'|'FAIL' for one backend + adapter (D-048: Arc rows differ from the 4060).
// A row that is FAIL in the baseline is a recorded known-FAIL (D-039/D-045/D-048); it is reported only when it changes.

export function adapterSlug(s) {
  return String(s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'unknown';
}

export function rowVerdicts(rows) {
  const out = {};
  for (const r of rows || []) out[r.name] = r.pass ? 'PASS' : 'FAIL';
  return out;
}

export function makeBaseline(rows, { backend, adapter, sha, date, grid } = {}) {
  const rowsV = rowVerdicts(rows);
  const v = Object.values(rowsV);
  return {
    backend: backend || 'webgl2', adapter: adapter || 'unknown', sha: sha || null, date: date || null, grid: grid || null,
    pass: v.filter((x) => x === 'PASS').length, fail: v.filter((x) => x === 'FAIL').length,
    rows: rowsV,
  };
}

// null when the baseline matches this run's backend + adapter, else a message (different machine = different baseline).
export function baselineMismatch(baseline, { backend, adapter }) {
  if ((baseline.backend || 'webgl2') !== (backend || 'webgl2')) return `baseline backend '${baseline.backend}' != run backend '${backend}'`;
  if (baseline.adapter !== (adapter || 'unknown')) return `baseline adapter '${baseline.adapter}' != run adapter '${adapter}'`;
  return null;
}

export function diffBaseline(baseline, rows) {
  const cur = rowVerdicts(rows);
  const old = baseline.rows || {};
  const regress = [], fixed = [], added = [], removed = [];
  for (const [name, v] of Object.entries(cur)) {
    if (!(name in old)) added.push({ name, verdict: v });
    else if (old[name] === 'PASS' && v === 'FAIL') regress.push(name);
    else if (old[name] === 'FAIL' && v === 'PASS') fixed.push(name);
  }
  for (const name of Object.keys(old)) if (!(name in cur)) removed.push(name);
  return { regress, fixed, added, removed, ok: regress.length === 0 };
}

export function formatBaselineDiff(d) {
  const lines = [];
  for (const n of d.regress) lines.push(`PASS->FAIL  ${n}`);
  for (const n of d.fixed) lines.push(`FAIL->PASS  ${n}`);
  for (const a of d.added) lines.push(`NEW ${a.verdict}    ${a.name}`);
  for (const n of d.removed) lines.push(`MISSING     ${n}`);
  return lines.length ? lines.join('\n') : 'no changes vs baseline';
}
