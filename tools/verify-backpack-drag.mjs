// OB-203 (reopened): headless real-mouse drag of a pack item into an EMPTY pack cell with a gap. Give 3 items (dev hook),
// open the inventory (I), drag cell 0 -> cell 5 with CDP mouse events, read the inventory state. PASS/FAIL.
// Run: node tools/verify-backpack-drag.mjs 9510   (PC-B ports 9500-9574; kills only its own server + Chrome)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9510);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-verify-backpack-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, failed = false;
const check = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(info))); if (!cond) failed = true; };
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!window.__kestrel && !!window.__kestrel.giveItem && !!window.__debug.invView && !!window.__debug.playerHandle')) { ready = true; break; } }
  if (!ready) throw new Error('game not ready ' + JSON.stringify(errors));
  await evaluate(cdp, 'Object.defineProperty(window.__debug.look, "locked", { get: () => true, set() {}, configurable: true }), true'); // headless never gets pointer lock
  for (let i = 0; i < 120; i++) { if (!(await evaluate(cdp, 'window.__debug.wakeOut.inputLocked'))) break; await pause(500); }
  const slots = () => evaluate(cdp, 'JSON.stringify(window.__debug.playerHandle.data.components.inventory.slots.map((s) => s.id ? s.id + "x" + s.n : null))').then((s) => JSON.parse(s));
  // clean pack, then exactly three items in cells 0..2
  await evaluate(cdp, '(() => { const inv = window.__debug.playerHandle.data.components.inventory; inv.slots.forEach((s) => { s.id = null; s.n = 0; }); return true; })()');
  for (const id of ['boar.meat', 'boar.hide', 'brass.scrap']) await evaluate(cdp, `window.__kestrel.giveItem('${id}', 1)`);
  console.log('before', JSON.stringify((await slots()).slice(0, 8)));
  const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k }); await pause(60); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); };
  await key('KeyI', 'i'); await pause(800);
  check('inventory open', await evaluate(cdp, 'window.__debug.invView.isOpen'), null);
  // pixel centre of pack cell i = canvas rect + (UI cell -> px)
  const pix = (i) => evaluateAsync(cdp, `(async () => { const d = window.__debug, S = window.ASSETS.uiStyle.inventory, M = await import('/game/js/quest/inventoryScreen.js'), u = d.getUi(), cv = document.querySelector('canvas'), r = cv.getBoundingClientRect();
    const cx = S.panel.x + M.LAYOUT.pack.x + 3 + (${i} % 6) * S.grid.pitchX, cy = S.panel.y + M.LAYOUT.pack.y + 1 + ((${i} / 6) | 0) * S.grid.pitchY;
    return { x: r.left + (cx + 0.5) / u.cols * r.width, y: r.top + (cy + 0.5) / u.rows * r.height }; })()`);
  const mouse = (type, p, buttons) => cdp.send('Input.dispatchMouseEvent', { type, button: 'left', buttons, clickCount: 1, x: p.x, y: p.y });
  const from = await pix(0), to = await pix(5);
  await mouse('mouseMoved', from, 0); await pause(150);
  const st = () => evaluate(cdp, 'JSON.stringify({cur: window.__debug.invView.cursor, drag: window.__debug.invView.dragging, hov: window.__debug.invView.hoverItemId})');
  console.log('hover', await st());
  await mouse('mousePressed', from, 1); await pause(150);
  console.log('pressed', await st());
  for (let k = 1; k <= 8; k++) { await mouse('mouseMoved', { x: from.x + (to.x - from.x) * k / 8, y: from.y + (to.y - from.y) * k / 8 }, 1); await pause(60); }
  console.log('moved', await st(), JSON.stringify({ from, to }));
  await pause(150); await mouse('mouseReleased', to, 0); await pause(400);
  const after = await slots();
  console.log('after ', JSON.stringify(after.slice(0, 8)));
  check('item 0 moved to cell 5', after[0] === null && after[5] === 'boar.meatx1', after.slice(0, 8));
  check('cells 1,2 kept, 3,4 empty (gap)', after[1] === 'boar.hidex1' && after[2] === 'brass.scrapx1' && !after[3] && !after[4], after.slice(0, 8));
  await evaluate(cdp, 'window.__kestrel.giveItem("boar.hide", 1)'); await pause(100);
  const next = await slots();
  check('next pickup stacks / uses first empty, moved item stays at 5', next[5] === 'boar.meatx1', next.slice(0, 8));
  check('no page errors', errors.length === 0, errors);
} catch (e) { failed = true; console.log('FAIL ' + e.message); }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  console.log(failed ? 'FAIL backpack drag' : 'PASS backpack drag'); process.exitCode = failed ? 1 : 0;
}
