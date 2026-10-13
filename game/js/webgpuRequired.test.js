import assert from 'node:assert/strict';
import { webGpuMissingReason, showWebGpuRequired, REASON_TEXT } from './webgpuRequired.js';

assert.equal(webGpuMissingReason({}), 'no-api');
assert.equal(webGpuMissingReason(null), 'no-api');
assert.equal(webGpuMissingReason({ gpu: {} }, { adapter: null }), 'no-adapter');
assert.equal(webGpuMissingReason({ gpu: {} }, { deviceFailed: true }), 'device-failed');

// minimal DOM stub
function mk(tag) {
  const e = { tag, children: [], style: {}, attrs: {}, listeners: {}, textContent: '', focused: false };
  e.setAttribute = (k, v) => { e.attrs[k] = v; };
  e.append = (...c) => { e.children.push(...c); };
  e.appendChild = (c) => { e.children.push(c); return c; };
  e.addEventListener = (t, f) => { e.listeners[t] = f; };
  e.focus = () => { e.focused = true; };
  return e;
}
let reloads = 0;
const doc = { createElement: mk, defaultView: { location: { reload: () => { reloads++; } } } };
const root = mk('body'); root.ownerDocument = doc;
const find = (e, tag, out = []) => { if (e.tag === tag) out.push(e); e.children.forEach((c) => find(c, tag, out)); return out; };

const el = showWebGpuRequired(root, { reason: 'no-adapter' });
assert.equal(root.children.length, 1);
assert.equal(find(el, 'h1').length, 1);
assert.match(find(el, 'p')[0].textContent, /no graphics adapter/);
const btn = find(el, 'button')[0];
assert.equal(btn.type, 'button'); assert.ok(btn.focused);
btn.listeners.click(); assert.equal(reloads, 1);
assert.equal(showWebGpuRequired(root, { reason: 'no-api' }), el); // idempotent
assert.equal(root.children.length, 1);
for (const k of ['no-api', 'no-adapter', 'device-failed']) assert.ok(REASON_TEXT[k]);
console.log('webgpuRequired.test.js ok');
