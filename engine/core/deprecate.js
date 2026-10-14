// @ts-check
// ENG-API-01b (architecture.md 38.74): deprecation wrapper for the public engine API.
// deprecated(name, fn, replacedBy) returns a function that behaves exactly like fn (same `this`,
// arguments, return value) and, only after setApiWarnings(true), logs ONE console.warn per name.
// Disabled path = one boolean test + fn.apply(this, arguments): no per-call allocation.
// The engine never reads `location`; game/js/main.js turns warnings on under its own dev flag.
let enabled = false;
const warned = new Set();

/** @param {boolean} on */
export function setApiWarnings(on) { enabled = !!on; }
export function apiWarningsEnabled() { return enabled; }
/** Forget which names already warned (tests). */
export function resetApiWarnings() { warned.clear(); }

/**
 * @template {Function} F
 * @param {string} name old (deprecated) export name
 * @param {F} fn the implementation to forward to
 * @param {string} replacedBy new name or module path (shown in the warning)
 * @returns {F}
 */
export function deprecated(name, fn, replacedBy) {
  const wrapper = /** @type {any} */ (function () {
    if (enabled && !warned.has(name)) {
      warned.add(name);
      console.warn(`[engine api] ${name} is deprecated, use ${replacedBy}`);
    }
    // eslint-disable-next-line prefer-rest-params
    return fn.apply(this, arguments);
  });
  try { Object.defineProperty(wrapper, 'name', { value: name }); } catch { /* ignore */ }
  return wrapper;
}
