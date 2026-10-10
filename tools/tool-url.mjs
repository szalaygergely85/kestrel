// DN-04a (docs/architecture.md 38.39 item 6): one shared place that pins the game clock for every dev tool URL.
// Tools load game/index.html with `timefreeze=1&time=8` (morning) so output stays deterministic once the game runs a day/night clock.
// Params already present in the query win (explicit --query / --extra), so a tool can still ask for another hour.
export const DEFAULT_TOOL_HOUR = 8;

/** Parse a `--time=<h>` value (0..24, may be fractional). Returns the default for undefined/empty. */
export function parseTimeArg(v) {
  if (v === undefined || v === null || v === '' || v === true) return DEFAULT_TOOL_HOUR;
  const h = Number(v);
  if (!Number.isFinite(h) || h < 0 || h > 24) throw new Error(`invalid --time ${v} (expected hour 0..24)`);
  return h;
}

/** Append `timefreeze=1&time=<h>` to a query string (no leading '?'), skipping params that are already there. */
export function withTimeFreeze(query, hour = DEFAULT_TOOL_HOUR) {
  const q = query ? String(query).replace(/^\?/, '') : '';
  const has = (k) => new RegExp(`(^|&)${k}=`).test(q);
  const add = [];
  if (!has('timefreeze')) add.push('timefreeze=1');
  if (!has('time')) add.push(`time=${hour}`);
  return [q, ...add].filter(Boolean).join('&');
}

/** Full game URL on the tool's own local server. */
export function gameUrl(port, query = '', hour = DEFAULT_TOOL_HOUR, page = 'game/index.html') {
  return `http://127.0.0.1:${port}/${page}?${withTimeFreeze(query, hour)}`;
}
