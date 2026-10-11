// EQ-12 + QB-6 (OB-011/OB-012): headless quick-bar check. Bar = [LMB][RMB][1][2][3][4]: L/R follow equipment (sword / shield), keys 1-4 start empty;
// hover + digit and drag-and-drop assign; the bar slot shows the stack count; the key drinks (+2 hearts, 0.6 s sip, movement never locks); Q swaps L to the bow; no H potion button.
// Reuses capture-browser.mjs helpers; PC-B ports 9500-9574.
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
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!window.__kestrel && !!window.__debug.quickbar')) { ready = true; break; } }
  assert.ok(ready, JSON.stringify(errors));
  await evaluate(cdp, 'Object.defineProperty(window.__debug.look, "locked", { get: () => true, set() {}, configurable: true }), true'); // headless never gets pointer lock: pin it
  for (let i = 0; i < 120; i++) { if (!(await evaluate(cdp, 'window.__debug.wakeOut.inputLocked'))) break; await pause(500); } // intro wake-up locks input
  await pause(500);
  const mouse = (type, button) => cdp.send('Input.dispatchMouseEvent', { type, button, buttons: button === 'right' ? 2 : 1, clickCount: 1, x: 550, y: 350 });
  const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k }); await pause(60); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); };

  const ev = (js) => evaluate(cdp, js);
  const S = `(() => { const c = window.__debug.playerHandle.data.components, n = c.inventory.slots.reduce((a, s) => a + (s.id === 'potion.hp' ? s.n : 0), 0); return { set: c.equipment.set, main: c.equipment.main, off: c.equipment.off, hp: c.health.hp, max: c.health.max, potions: n, sipping: window.__debug.quickbar.sipping, bar: c.quickbar.slice() }; })()`;
  // bar slot geometry (quickbarView: 6 slots 7 wide, gap 1, extra 2 after the hand pair; 4 high on the bottom rows) and the glyph text of a slot row
  const GEO = `(() => { const u = window.__debug.getUi(), x0 = ((u.cols - 49) >> 1); const sx = (i) => x0 + i * 8 + (i >= 2 ? 2 : 0), y = u.rows - 5;
    const txt = (i, r) => { let s = ''; for (let k = 0; k < 7; k++) s += String.fromCharCode(u.cells.glyphIdx[(y + r) * u.cols + sx(i) + k] + 32); return s; };
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { cols: u.cols, rows: u.rows, sx: [0, 1, 2, 3, 4, 5].map(sx), y, rect: { l: r.left, t: r.top, w: r.width, h: r.height }, txt3: [0, 1, 2, 3, 4, 5].map((i) => txt(i, 3)) }; })()`;
  // fresh state: sword + shield worn, bow worn as ranged, 2 potions + a spare bow in the pack; the bar starts at its defaults
  await ev(`(async () => { const c = window.__debug.playerHandle.data.components, eq = c.equipment, defs = window.ASSETS.items.defs, qbm = await import('/game/js/quest/sim/quickbar.js');
    eq.main = 'sword'; eq.off = 'shield'; eq.ranged = 'bow'; eq.quiver = { id: 'arrow', n: 5 }; eq.set = 'melee';
    c.inventory.slots.forEach((s) => { s.id = null; s.n = 0; }); c.inventory.slots[0].id = 'potion.hp'; c.inventory.slots[0].n = 2; c.inventory.slots[1].id = 'bow'; c.inventory.slots[1].n = 1;
    c.quickbar = [null, null, null, null, null, null]; qbm.ensureQuickbar(window.__debug.playerHandle.data, defs); c.health.hp = 5; return true; })()`);
  await pause(400);
  const a = await ev(S);
  assert.deepEqual(a.bar, ['sword', 'shield', null, null, null, null], 'default bar: L = sword, R = shield, keys 1-4 empty ' + JSON.stringify(a.bar));
  await key('Digit2', '2'); await pause(150); // empty key 2 does nothing
  const a2 = await ev(S); assert.equal(a2.off, 'shield', 'empty key 2 leaves the shield alone'); assert.equal(a2.hp, 5);
  // open the pack, hover the potion, 1 = assign it to key slot 1 (bar slot 2); later close and press 1 to drink
  const hoverItem = (id) => ev(`(() => { const v = window.__debug.invView, u = window.__debug.getUi(); for (let y = 0; y < u.rows; y++) for (let x = 0; x < u.cols; x++) { v.setPointer(x, y); if (v.hoverItemId === ${JSON.stringify(id)}) return [x, y]; } return null; })()`);
  await key('KeyI', 'i'); await pause(600);
  assert.equal(await ev('window.__debug.invView.isOpen'), true, 'pack open');
  const pc = await hoverItem('potion.hp'); assert.ok(pc, 'potion found in the pack grid');
  await key('Digit1', '1'); await pause(200);
  const b = await ev(S); assert.equal(b.bar[2], 'potion.hp', 'hover + 1 assigns the potion to key slot 1');
  // drag and drop (real mouse events): the spare bow from the pack to key slot 2 (bar slot 3)
  const g1 = await ev(GEO), bc = await hoverItem('bow'); assert.ok(bc, 'bow found in the pack grid');
  const px = (c, n, o) => o.l + (c + 0.5) / n * o.w, py = (c, n, o) => o.t + (c + 0.5) / n * o.h;
  const bx = px(bc[0], g1.cols, g1.rect), by = py(bc[1], g1.rows, g1.rect), tx = px(g1.sx[3] + 3, g1.cols, g1.rect), ty = py(g1.y + 1, g1.rows, g1.rect);
  const mev = (type, x, y, button, buttons) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 });
  await mev('mouseMoved', bx, by, 'none', 0); await pause(60); await mev('mousePressed', bx, by, 'left', 1); await pause(60);
  await mev('mouseMoved', (bx + tx) / 2, (by + ty) / 2, 'left', 1); await pause(60); await mev('mouseMoved', tx, ty, 'left', 1); await pause(60);
  await mev('mouseReleased', tx, ty, 'left', 0); await pause(250);
  const c2 = await ev(S); assert.equal(c2.bar[3], 'bow', 'drag and drop put the bow on key slot 2');
  await pause(300);
  const gz = await ev(GEO); // the bar is drawn inside the menu: the potion slot shows its stack count, a single item none
  assert.ok(/x2/.test(gz.txt3[2]), 'potion slot shows the count x2: ' + JSON.stringify(gz.txt3)); assert.ok(!/x\d/.test(gz.txt3[3]), 'bow slot shows no count');
  await key('KeyI', 'i'); await pause(500);
  assert.equal(await ev('window.__debug.invView.isOpen'), false, 'pack closed');
  await key('Digit1', '1'); await pause(150); // key 1 drinks one potion (+2 hearts, sip, never locks)
  const d = await ev(S); assert.equal(d.hp, 25, 'key 1 drinks: 5 + 2 hearts'); assert.equal(d.potions, 1); assert.ok(d.sipping, 'sip running');
  await pause(900);
  const e = await ev(S); assert.equal(e.sipping, false, 'sip ends after ~0.6 s');
  await ev(`(() => { window.__debug.playerHandle.data.components.health.hp = 3; return true; })()`); // OB-011: H no longer drinks (swap-hands again)
  await key('KeyH', 'h'); await pause(150);
  const f = await ev(S); assert.equal(f.hp, 3, 'H does not drink'); assert.equal(f.potions, 1);
  await key('Digit1', '1'); await pause(900); // last potion
  const g = await ev(S); assert.equal(g.hp, 23); assert.equal(g.potions, 0);
  await ev(`(() => { window.__debug.playerHandle.data.components.health.hp = 3; return true; })()`);
  await key('Digit1', '1'); await pause(150);
  const h = await ev(S); assert.equal(h.hp, 3, 'no potions: nothing happens (toast)'); assert.equal(h.bar[2], 'potion.hp', 'empty stack keeps its slot');
  await key('KeyQ', 'q'); await pause(700); // Q swaps L to the bow (and back)
  const q1 = await ev(S); assert.equal(q1.set, 'ranged', 'Q = bow set'); assert.equal(q1.bar[0], 'bow', 'L follows the equipment: bow');
  await key('KeyQ', 'q'); await pause(700);
  const q2 = await ev(S); assert.equal(q2.bar[0], 'sword', 'Q again: L = sword'); assert.equal(q2.bar[1], 'shield');
  console.log(JSON.stringify({ a, b, c2, d, e, f, g, h, q1, q2, errors: errors.length }));
  assert.deepEqual(errors, []);
  console.log('Quickbar (QB-6/OB-011/OB-012): L/R follow equipment, keys 1-4 start empty, hover+digit and drag-drop assign, bar count, key drinks, no H, Q swaps L PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
