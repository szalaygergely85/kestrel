// EQ-12 + D-068: headless quick-bar check. Keys 1/3 swap sword/bow set, 2 toggles the shield, 4 drinks the assigned potion (+2 hearts, 0.6 s sip, movement
// never locked), H drinks from the HUD button, an empty stack toasts instead. Reuses capture-browser.mjs helpers; PC-B ports 9500-9574.
// Run ONCE: node tools/verify-quickbar.mjs {port}   (e.g. node tools/verify-quickbar.mjs 9520)
// The dialogue/digit routing (AC4) is covered in Node by game/js/quest/dialogueCtl.test.js.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-verify-qb-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!window.__kestrel && !!window.__debug.quickbar')) { ready = true; break; } }
  assert.ok(ready, JSON.stringify(errors));
  await evaluate(cdp, 'Object.defineProperty(window.__debug.look, "locked", { get: () => true, set() {}, configurable: true }), true'); // headless never gets pointer lock: pin it
  for (let i = 0; i < 120; i++) { if (!(await evaluate(cdp, 'window.__debug.wakeOut.inputLocked'))) break; await pause(500); } // intro wake-up locks input
  await pause(500);
  const mouse = (type, button) => cdp.send('Input.dispatchMouseEvent', { type, button, buttons: button === 'right' ? 2 : 1, clickCount: 1, x: 550, y: 350 });
  const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k }); await pause(60); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); };

  const ev = (js) => evaluate(cdp, js);
  const S = `(() => { const c = window.__debug.playerHandle.data.components, n = c.inventory.slots.reduce((a, s) => a + (s.id === 'potion.hp' ? s.n : 0), 0); return { set: c.equipment.set, off: c.equipment.off, hp: c.health.hp, max: c.health.max, potions: n, sipping: window.__debug.quickbar.sipping, bar: c.quickbar.slice() }; })()`;
  await ev(`(() => { const c = window.__debug.playerHandle.data.components, eq = c.equipment; eq.main = 'sword'; eq.off = null; eq.ranged = 'bow'; eq.quiver = { id: 'arrow', n: 5 }; eq.set = 'melee';
    c.inventory.slots.forEach((s) => { s.id = null; s.n = 0; }); c.inventory.slots[0].id = 'shield'; c.inventory.slots[0].n = 1; c.inventory.slots[1].id = 'potion.hp'; c.inventory.slots[1].n = 2;
    c.quickbar = ['sword', 'shield', 'bow', 'potion.hp']; c.health.hp = 5; return true; })()`);
  await pause(300);
  await key('Digit3', '3'); await pause(200);
  const a = await ev(S); assert.equal(a.set, 'ranged', 'key 3 = bow set');
  await key('Digit1', '1'); await pause(200);
  const b = await ev(S); assert.equal(b.set, 'melee', 'key 1 = sword / melee set');
  await key('Digit2', '2'); await pause(200);
  const c2 = await ev(S); assert.equal(c2.off, 'shield', 'key 2 puts the shield on');
  await key('Digit4', '4'); await pause(150);
  const d = await ev(S); assert.equal(d.hp, 25, 'key 4 drinks: 5 + 2 hearts'); assert.equal(d.potions, 1); assert.ok(d.sipping, 'sip running');
  await pause(900);
  const e = await ev(S); assert.equal(e.sipping, false, 'sip ends after ~0.6 s');
  await ev(`(() => { window.__debug.playerHandle.data.components.health.hp = 3; return true; })()`);
  await key('KeyH', 'h'); await pause(150);
  const f = await ev(S); assert.equal(f.hp, 23, 'H drinks from the HUD button'); assert.equal(f.potions, 0);
  await pause(900); await ev(`(() => { window.__debug.playerHandle.data.components.health.hp = 3; return true; })()`);
  await key('KeyH', 'h'); await pause(150);
  const g = await ev(S); assert.equal(g.hp, 3, 'no potions: nothing happens (toast)'); assert.equal(g.bar[3], 'potion.hp', 'empty stack keeps its slot');
  console.log(JSON.stringify({ a, b, c2, d, e, f, g, errors: errors.length }));
  assert.deepEqual(errors, []);
  console.log('Quickbar: 1-4 per kind, potion sip (movement free), H button, empty toast PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
