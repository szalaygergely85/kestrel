// CUR-01 (D-121): the coin wallet. A plain integer 0..MAX, never negative, never lost on death. Pure, no imports.
// API for the trade screen (CUR-04): get() / add(n) / spend(n) -> bool. `onChange(value, delta)` feeds 'wallet:changed'.
export const MAX_COIN = 9999;
const clamp = (n) => Math.max(0, Math.min(MAX_COIN, Math.floor(Number.isFinite(n) ? n : 0)));

export function createWallet(n = 0, onChange = null) {
  let v = clamp(n);
  const w = {
    get value() { return v; },
    get() { return v; },
    /** Adds n (integer >= 1, else ignored); returns the amount really added (clamped at MAX_COIN). */
    add(n) {
      if (!Number.isInteger(n) || n < 1) return 0;
      const d = Math.min(n, MAX_COIN - v); if (d < 1) return 0;
      v += d; if (onChange) onChange(v, d); return d;
    },
    /** True and pays when the wallet holds n (integer >= 1); false and no change otherwise. */
    spend(n) {
      if (!Number.isInteger(n) || n < 1 || n > v) return false;
      v -= n; if (onChange) onChange(v, -n); return true;
    },
    /** Restore from a save (silent: no onChange). */
    set(n) { v = clamp(n); },
  };
  return w;
}

/** Toast line for a coin gain: "+1 coin", "+20 coins". */
export const coinText = (n) => '+' + n + (n === 1 ? ' coin' : ' coins');
