// game/js/platform/platform.test.js (US-060)
//
// Headless Node ESM test for the platform storage adapter (web.js) - no
// browser needed. `window`/`window.localStorage` are faked per-scenario by
// assigning `globalThis.window` before each check (web.js reads
// `window.localStorage` fresh on every call, so swapping it works without
// re-importing the module). Matches the project's no-framework test
// pattern (see game/js/physics/jump.test.js): plain asserts, pass/fail
// counters, "ALL PASS" + exit 0, or a failure list + exit 1.
//
// Run with: node game/js/platform/platform.test.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './web.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
const failures = [];
function check(name, cond) {
  if (cond) pass++;
  else failures.push(name);
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- fake storage helpers -------------------------------------------------

/** A working in-memory Storage-like object. */
function makeFakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    _raw: data,
  };
}

function withStorage(storage, fn) {
  const prevWindow = globalThis.window;
  globalThis.window = { localStorage: storage };
  try {
    return fn();
  } finally {
    globalThis.window = prevWindow;
  }
}

// ---- 1. no window at all (e.g. some non-browser eval context) ------------

(function noWindowAtAll() {
  const prevWindow = globalThis.window;
  delete globalThis.window;
  try {
    const s = loadSettings();
    check('no window: loadSettings returns defaults', deepEqual(s, DEFAULT_SETTINGS));
    const saved = saveSettings({ muted: true });
    check('no window: saveSettings returns a valid object without throwing', saved.muted === true && typeof saved.volume === 'number');
  } finally {
    globalThis.window = prevWindow;
  }
})();

// ---- 2. empty storage (key never written) ---------------------------------

withStorage(makeFakeStorage(), () => {
  const s = loadSettings();
  check('empty storage: loadSettings returns defaults', deepEqual(s, DEFAULT_SETTINGS));
});

// ---- 3. corrupt JSON --------------------------------------------------------

withStorage(makeFakeStorage({ 'kestrel.settings': '{not valid json' }), () => {
  const s = loadSettings();
  check('corrupt JSON: falls back to defaults', deepEqual(s, DEFAULT_SETTINGS));
});

withStorage(makeFakeStorage({ 'kestrel.settings': '"just a string"' }), () => {
  const s = loadSettings();
  check('non-object JSON (string): falls back to defaults', deepEqual(s, DEFAULT_SETTINGS));
});

withStorage(makeFakeStorage({ 'kestrel.settings': 'null' }), () => {
  const s = loadSettings();
  check('non-object JSON (null): falls back to defaults', deepEqual(s, DEFAULT_SETTINGS));
});

// ---- 4. wrong field types (field-by-field fallback, not whole-object reject)

withStorage(makeFakeStorage({ 'kestrel.settings': JSON.stringify({ settingsVersion: 1, muted: 'yes', volume: 0.7 }) }), () => {
  const s = loadSettings();
  check('wrong-type muted falls back, good volume kept', s.muted === false && s.volume === 0.7);
});

withStorage(makeFakeStorage({ 'kestrel.settings': JSON.stringify({ settingsVersion: 1, muted: true, volume: 'loud' }) }), () => {
  const s = loadSettings();
  check('wrong-type volume falls back, good muted kept', s.muted === true && s.volume === DEFAULT_SETTINGS.volume);
});

withStorage(makeFakeStorage({ 'kestrel.settings': JSON.stringify({ muted: true, volume: NaN }) }), () => {
  const s = loadSettings();
  check('NaN volume treated as invalid, falls back', s.muted === true && s.volume === DEFAULT_SETTINGS.volume);
});

withStorage(makeFakeStorage({ 'kestrel.settings': JSON.stringify({ unknownField: 123, extra: 'x' }) }), () => {
  const s = loadSettings();
  check('unknown fields ignored, known fields default', deepEqual(s, DEFAULT_SETTINGS));
});

// ---- 5. storage that throws on get/set ------------------------------------

(function throwingStorage() {
  const throwing = {
    getItem() { throw new Error('boom: get'); },
    setItem() { throw new Error('boom: set'); },
  };
  withStorage(throwing, () => {
    let threw = false;
    let s;
    try { s = loadSettings(); } catch { threw = true; }
    check('throwing getItem: loadSettings does not throw', !threw);
    check('throwing getItem: falls back to defaults', deepEqual(s, DEFAULT_SETTINGS));

    threw = false;
    let saved;
    try { saved = saveSettings({ muted: true }); } catch { threw = true; }
    check('throwing setItem: saveSettings does not throw', !threw);
    check('throwing setItem: still returns the intended merged object', saved && saved.muted === true);
  });
})();

// a window whose .localStorage getter itself throws (real-world private-mode case)
(function throwingLocalStorageGetter() {
  const prevWindow = globalThis.window;
  globalThis.window = {
    get localStorage() { throw new Error('SecurityError'); },
  };
  try {
    let threw = false;
    let s;
    try { s = loadSettings(); } catch { threw = true; }
    check('throwing localStorage getter: loadSettings does not throw', !threw);
    check('throwing localStorage getter: falls back to defaults', deepEqual(s, DEFAULT_SETTINGS));
  } finally {
    globalThis.window = prevWindow;
  }
})();

// ---- 6. full round-trip: save then load matches ---------------------------

withStorage(makeFakeStorage(), () => {
  const saved = saveSettings({ muted: true });
  check('round-trip: saveSettings reports muted true', saved.muted === true);
  const loaded = loadSettings();
  check('round-trip: loadSettings matches saveSettings', deepEqual(loaded, saved));
  check('round-trip: settingsVersion is 1', loaded.settingsVersion === 1);

  // toggling back off persists too (not just "always true")
  const saved2 = saveSettings({ muted: false });
  const loaded2 = loadSettings();
  check('round-trip: mute-off also persists', saved2.muted === false && loaded2.muted === false);
});

// saveSettings should preserve fields it wasn't given (merge, not replace)
withStorage(makeFakeStorage(), () => {
  saveSettings({ muted: true, volume: 0.5 });
  const merged = saveSettings({ muted: false }); // volume omitted - should be kept from prior save
  check('saveSettings merges: omitted volume keeps prior saved value', merged.volume === 0.5 && merged.muted === false);
});

// ---- 6b. US-038b fields: grid / fullscreen / mouseSensitivity / invertY ----

withStorage(makeFakeStorage(), () => {
  const saved = saveSettings({ grid: '400x150', fullscreen: true, mouseSensitivity: 0.225, invertY: true });
  check('US-038b round-trip: saveSettings reports the new fields', saved.grid === '400x150' && saved.fullscreen === true
    && saved.mouseSensitivity === 0.225 && saved.invertY === true);
  const loaded = loadSettings();
  check('US-038b round-trip: loadSettings matches saveSettings', deepEqual(loaded, saved));

  // merge: a later save touching only `grid` keeps the other three fields
  const merged = saveSettings({ grid: '480x180' });
  check('US-038b merge: omitted fields keep their prior saved values', merged.fullscreen === true
    && merged.mouseSensitivity === 0.225 && merged.invertY === true && merged.grid === '480x180');
});

withStorage(makeFakeStorage({
  'kestrel.settings': JSON.stringify({
    settingsVersion: 1, muted: true, volume: 0.8,
    grid: '999x999', fullscreen: 'yes', mouseSensitivity: 99, invertY: 'nope',
  }),
}), () => {
  const s = loadSettings();
  check('US-038b: unknown grid string falls back to default grid', s.grid === DEFAULT_SETTINGS.grid);
  check('US-038b: wrong-type fullscreen falls back to default', s.fullscreen === DEFAULT_SETTINGS.fullscreen);
  check('US-038b: out-of-range mouseSensitivity falls back to default', s.mouseSensitivity === DEFAULT_SETTINGS.mouseSensitivity);
  check('US-038b: wrong-type invertY falls back to default', s.invertY === DEFAULT_SETTINGS.invertY);
  check('US-038b: a bad new field does not clobber a good pre-existing one (muted/volume kept)',
    s.muted === true && s.volume === 0.8);
});

withStorage(makeFakeStorage({ 'kestrel.settings': JSON.stringify({ grid: '320x120' }) }), () => {
  const s = loadSettings();
  check('US-038b: a valid grid string in an otherwise-empty blob is accepted', s.grid === '320x120');
});

// ---- 7. no direct localStorage use anywhere else in game/ -----------------

(function noDirectLocalStorageElsewhere() {
  const gameDir = path.resolve(__dirname, '..', '..'); // game/
  const offenders = [];
  // Files allowed to mention "localStorage" in source: web.js (the one file
  // that actually calls it) and this test file (fakes it) and index.js
  // (doc-comment only, re-exports web.js, calls nothing itself).
  const exempt = new Set([
    path.resolve(__dirname, 'web.js'),
    path.resolve(__dirname, 'platform.test.js'),
    path.resolve(__dirname, 'index.js'),
  ]);
  // Only flags actual USE (a `.localStorage` property access / call), not
  // mentions of the word in prose comments elsewhere.
  const usePattern = /\.localStorage\b|window\.localStorage|globalThis\.localStorage/;

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) {
        if (exempt.has(path.resolve(full))) continue;
        const text = fs.readFileSync(full, 'utf8');
        if (usePattern.test(text)) offenders.push(full);
      }
    }
  }
  walk(gameDir);
  check('no direct localStorage use outside platform/web.js', offenders.length === 0);
  if (offenders.length) failures.push('offenders: ' + offenders.join(', '));
})();

// ---- report -----------------------------------------------------------

if (failures.length) {
  console.error(`FAIL (${failures.length} of ${pass + failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
} else {
  console.log(`ALL PASS (${pass} checks)`);
  process.exit(0);
}
