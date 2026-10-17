// ENG-API-01b: deprecated() wrapper (architecture.md 38.74).
import { deprecated, setApiWarnings, resetApiWarnings } from './deprecate.js';
import * as E from '../index.js';
const fails = [];
const chk = (c, m) => { if (!c) fails.push(m); };
const calls = []; const orig = console.warn; console.warn = (m) => calls.push(m);
try {
  const obj = { k: 7, f: deprecated('oldF', function (a, b) { return this.k + a + b; }, 'newF') };
  setApiWarnings(false); resetApiWarnings();
  chk(obj.f(1, 2) === 10, 'return value / this / args preserved (off)');
  chk(calls.length === 0, 'off = silent');
  setApiWarnings(true);
  chk(obj.f(1, 2) === 10, 'return value (on)');
  obj.f(1, 2); obj.f(3, 4);
  chk(calls.length === 1, `warn once per name, got ${calls.length}`);
  chk(/oldF/.test(calls[0]) && /newF/.test(calls[0]), 'message names old + new');
  const g = deprecated('oldG', () => 1, 'newG'); g();
  chk(calls.length === 2, 'second name warns separately');
  // alloc: disabled path should not grow the heap per call
  setApiWarnings(false);
  const h = deprecated('oldH', (a) => a + 1, 'newH');
  for (let i = 0; i < 1e5; i++) h(i & 255);
  const before = process.memoryUsage().heapUsed;
  let s = 0; for (let i = 0; i < 1e6; i++) s = (s + h(i & 255)) & 0xffff;
  const grew = process.memoryUsage().heapUsed - before;
  chk(grew < 4e6, `disabled path allocates ~nothing (heap +${grew})`);
  chk(s > 0, 'sink');
  // index.js wiring: old names forward + warn
  resetApiWarnings(); setApiWarnings(true); calls.length = 0;
  chk(typeof E.makeFrame === 'function' && typeof E.createFrame === 'function', 'makeFrame/createFrame exported');
  const fr = E.makeFrame(1, 2, 3, 0); chk(fr && fr.constructor === E.createFrame(1, 2, 3, 0).constructor, 'makeFrame forwards');
  chk(calls.length === 1, 'index makeFrame warns');
  chk(typeof E.selfTestDevice === 'function', 'selfTestDevice kept');
  const D = await import('../dev.js'); chk(typeof D.selfTestDevice === 'function', 'dev.js exports selfTestDevice');
} finally { console.warn = orig; setApiWarnings(false); }
console.log(`deprecate.test.js: ${fails.length} problems`);
if (fails.length) { for (const f of fails) console.log('  ' + f); process.exit(1); }
