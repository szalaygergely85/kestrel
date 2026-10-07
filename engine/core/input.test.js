// engine/core/input.test.js (HANDS-01b, 37.8a): Mouse0/Mouse2 edges + blockContextMenu, with a fake EventTarget.
import { Input, blockContextMenu } from './input.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

class FakeTarget {
  constructor() { this.l = {}; }
  addEventListener(n, f) { (this.l[n] = this.l[n] || []).push(f); }
  removeEventListener(n, f) { this.l[n] = (this.l[n] || []).filter((x) => x !== f); }
  fire(n, e) { const ev = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...e }; (this.l[n] || []).slice().forEach((f) => f(ev)); return ev; }
}
globalThis.window = globalThis.window || new FakeTarget(); // Input listens for blur on `window`
const t = new FakeTarget();
const input = new Input(t);

t.fire('mousedown', { button: 2 });
ok('Mouse2 down + pressed', input.isDown('Mouse2') && input.pressed('Mouse2') && !input.isDown('Mouse0'));
input.endFrame();
ok('Mouse2 held, edge cleared', input.isDown('Mouse2') && !input.pressed('Mouse2'));
t.fire('mousedown', { button: 0 });
ok('Mouse0 independent', input.isDown('Mouse0') && input.pressed('Mouse0') && input.isDown('Mouse2'));
t.fire('mouseup', { button: 2 });
ok('Mouse2 up, Mouse0 still down', !input.isDown('Mouse2') && input.isDown('Mouse0'));
t.fire('mousedown', { button: 1 }); t.fire('mousedown', { button: 3 });
ok('middle/other buttons ignored', !input.isDown('Mouse1') && !input.isDown('Mouse3') && input.anyPressed() === true);
input.endFrame(); input.consumePressed();
t.fire('mousedown', { button: 2 });
input.consumePressed();
ok('consumed Mouse2 ignored until its own up', !input.isDown('Mouse2'));
t.fire('mousedown', { button: 2 });
ok('still ignored on repeat down', !input.isDown('Mouse2') && !input.pressed('Mouse2'));
t.fire('mouseup', { button: 2 }); t.fire('mousedown', { button: 2 });
ok('re-armed after up', input.isDown('Mouse2') && input.pressed('Mouse2'));
window.l.blur.forEach((f) => f());
ok('blur releases both', !input.isDown('Mouse2') && !input.isDown('Mouse0'));

const canvas = new FakeTarget(), win = new FakeTarget();
const off = blockContextMenu(canvas);
ok('contextmenu prevented on the element', canvas.fire('contextmenu', {}).defaultPrevented === true);
ok('contextmenu not blocked elsewhere (window)', win.fire('contextmenu', {}).defaultPrevented === false);
off();
ok('off() removes the listener', canvas.fire('contextmenu', {}).defaultPrevented === false);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
