// TOOLS-ROBUST: pure helpers shared by teaser-stills.mjs and visqa-sweep.mjs (per-shot timeout + one retry, option parsing, PASS/FAIL lines).
export const QUALITIES = ['low', 'medium', 'high', 'ultra'];
export const DEFAULT_QUALITY = 'high';

/** Quality from CLI value, then env QUALITY, then the default (high). Throws on an unknown preset. */
export function pickQuality(cli, env = {}) {
  const q = cli || env.QUALITY || DEFAULT_QUALITY;
  if (!QUALITIES.includes(q)) throw new Error(`unknown quality "${q}" (use ${QUALITIES.join('|')})`);
  return q;
}

/** "480x180" -> {w,h}; throws on junk. */
export function parseGrid(s) {
  const m = /^(\d+)x(\d+)$/.exec(String(s || ''));
  if (!m) throw new Error(`bad --grid "${s}" (use WxH, e.g. 480x180)`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

export const withTimeout = (p, ms, label = 'shot') => {
  let t;
  const guard = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timeout after ${ms} ms`)), ms); });
  return Promise.race([Promise.resolve(p), guard]).finally(() => clearTimeout(t));
};

/**
 * Run attempt(n) with a timeout; on failure call recover(err) (e.g. fresh page load) and try again, up to `retries` extra times.
 * Returns {ok, value|error, attempts}. Never throws.
 */
export async function runShot(attempt, { timeoutMs = 120000, retries = 1, recover = async () => {}, label = 'shot' } = {}) {
  let lastErr;
  for (let n = 0; n <= retries; n++) {
    try { return { ok: true, value: await withTimeout(attempt(n), timeoutMs, label), attempts: n + 1 }; }
    catch (e) { lastErr = e; if (n < retries) { try { await recover(e); } catch (e2) { lastErr = e2; } } }
  }
  return { ok: false, error: String(lastErr && lastErr.message || lastErr), attempts: retries + 1 };
}

/** One PASS/FAIL line per shot. */
export const resultLine = (name, r, extra = '') =>
  `${r.ok ? 'PASS' : 'FAIL'} ${name}${r.attempts > 1 ? ` (attempt ${r.attempts})` : ''}${r.ok ? '' : ` - ${r.error}`}${extra ? ' ' + extra : ''}`;
