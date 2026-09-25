// engine/ui/debugOverlay.test.js
//
// Headless test suite for US-018 (docs/architecture.md section 16) step 3:
// `DebugOverlay.shouldRefresh()`'s 250 ms / visible-only throttle. Plain
// Node ESM, no test framework, no build step. Run with:
//
//   node engine/ui/debugOverlay.test.js
//
// A minimal fake DOM stands in for `document`/`Element`/`MutationObserver`
// (DebugOverlay's only globals) - just enough for its constructor to run
// without throwing; nothing here needs the fake elements to actually
// render anything.

class FakeStyle {}
class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.style = new FakeStyle();
    this.children = [];
    this.textContent = '';
  }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener() {}
}

globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  body: new FakeElement('body'),
};
globalThis.MutationObserver = class { observe() {} };

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  }
}

const { DebugOverlay } = await import('./debugOverlay.js');

// ---- hidden: never refreshes -------------------------------------------
{
  const o = new DebugOverlay(new FakeElement('root'));
  ok('hidden overlay never refreshes', o.shouldRefresh(0) === false);
  ok('hidden overlay never refreshes (later time)', o.shouldRefresh(10000) === false);
}

// ---- visible: refreshes immediately, then throttles to 250 ms ----------
{
  const o = new DebugOverlay(new FakeElement('root'));
  o.toggle(); // -> visible
  ok('first call after becoming visible refreshes', o.shouldRefresh(1000) === true);
  ok('a call 1 ms later does not refresh', o.shouldRefresh(1001) === false);
  ok('a call 100 ms later does not refresh', o.shouldRefresh(1100) === false);
  ok('a call at exactly +250 ms refreshes', o.shouldRefresh(1250) === true);
  ok('immediately after that, does not refresh again', o.shouldRefresh(1251) === false);
  ok('a call at +249 ms from the last refresh does not refresh', o.shouldRefresh(1499) === false);
  ok('a call at +250 ms from the last refresh refreshes', o.shouldRefresh(1500) === true);
}

// ---- toggling off mid-stream stops refreshing ---------------------------
{
  const o = new DebugOverlay(new FakeElement('root'));
  o.toggle(); // visible
  ok('visible refresh', o.shouldRefresh(0) === true);
  o.toggle(); // hidden again
  ok('hidden after toggle off: no refresh even past the interval', o.shouldRefresh(1000) === false);
  o.toggle(); // visible again
  ok('visible again: refreshes right away regardless of the old timer', o.shouldRefresh(1001) === true);
}

// ---- setText() bypasses the fps/frame prefix ----------------------------
{
  const o = new DebugOverlay(new FakeElement('root'));
  o.setText('hello');
  ok('setText writes the raw string', o.el.textContent === 'hello', `textContent=${o.el.textContent}`);
}

// ---------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
