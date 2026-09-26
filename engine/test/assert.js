// engine/test/assert.js (US-050, docs/backlog.md "PC-B QUEUE 3" item 9).
//
// This repo has no test framework - every `*.test.js`/`*.test.mjs` file is a
// plain Node script that hand-rolls its own tiny pass/fail tally and an
// `ok(name, cond, detail)` assertion helper (plus, in a few files,
// `approxEqual(a, b, eps)`). Dozens of files repeated the exact same
// `ok`/`approxEqual` bodies; this module is their single canonical home so
// the actual assertion LOGIC lives in one place, while each test file keeps
// its own local `pass`/`fail`/`failures` state and its own footer report
// (those differ enough file to file - some print a suite name, some don't -
// that centralizing them would risk changing a test's own output matching
// elsewhere, e.g. `tools/run-tests.mjs`'s "FAIL" line heuristic).
//
// Usage (per test file), unchanged pass/fail semantics and message format:
//
//   import { makeOk } from '<relative path>/engine/test/assert.js';
//   let pass = 0, fail = 0;
//   const failures = [];
//   const ok = makeOk(() => pass++, () => fail++, (msg) => failures.push(msg));
//   ...
//   ok('some check', cond, 'detail on failure');
//
// A file whose local `approxEqual` always supplies its own default `eps`
// (i.e. every call site passes `eps` explicitly) can import `approxEqual`
// directly. A file that relies on a default (some call sites omit `eps`)
// keeps a 1-line local wrapper supplying that exact default, e.g.:
//
//   import { approxEqual as approxEqualCore } from '<path>/engine/test/assert.js';
//   function approxEqual(a, b, eps = 1e-6) { return approxEqualCore(a, b, eps); }

/** Builds an `ok(name, cond, detail)` bound to this file's own tally
 * (`incPass`/`incFail`/`pushFailure` close over the caller's local
 * `pass`/`fail`/`failures` variables) - the exact same behaviour every local
 * copy had: on failure, push `${name}${detail ? ' - ' + detail : ''}`. */
export function makeOk(incPass, incFail, pushFailure) {
  return function ok(name, cond, detail) {
    if (cond) {
      incPass();
    } else {
      incFail();
      pushFailure(`${name}${detail ? ' - ' + detail : ''}`);
    }
  };
}

/** `|a - b| <= eps` - the formula every local `approxEqual` used. No default
 * `eps` here on purpose: the local copies disagreed on their default
 * (1e-3/1e-6/1e-9), so a file that needs one keeps a thin local wrapper
 * (see the module doc comment above) rather than this module picking one
 * default that would silently change another file's behaviour. */
export function approxEqual(a, b, eps) {
  return Math.abs(a - b) <= eps;
}
