import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9725);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-verify-plevel-'));
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
  for (let i = 0; i < 300; i++) { await pause(300); if (await evaluate(cdp, '!!window.__kestrel && !!window.__kestrel.giveItem && !!window.__debug.invView && !!window.__debug.playerHandle')) { ready = true; break; } }
  if (!ready) throw new Error('game not ready ' + JSON.stringify(errors));
  await evaluate(cdp, 'Object.defineProperty(window.__debug.look, "locked", { get: () => true, set() {}, configurable: true }), true'); // headless never gets pointer lock
  for (let i = 0; i < 120; i++) { if (!(await evaluate(cdp, 'window.__debug.wakeOut.inputLocked'))) break; await pause(500); }
  // PLAYER-LEVEL-01 / SPELL-R8 still: worn gear + spells -> HUD "Lv N", then the Character view header
  const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k }); await pause(60); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); };
  const outDir = path.join(ROOT, 'docs/test-reports/playerlevel'); mkdirSync(outDir, { recursive: true });
  const shot = async (name) => { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(outDir, name), Buffer.from(r.data, 'base64')); };
  const lv = () => evaluateAsync(cdp, `(async () => { const P = await import('/game/js/quest/sim/power.js'), d = window.__debug, st = d.playerHandle.data.components;
    return JSON.stringify({ eq: st.equipment, items: P.itemPowerTotal(st.equipment, window.ASSETS.items.defs) }); })()`);
  await evaluate(cdp, `(() => { const eq = window.__debug.playerHandle.data.components.equipment; eq.main = 'gear.main.sword.fine'; eq.off = 'gear.off.shield.sturdy'; eq.ranged = 'gear.ranged.bow.fine'; return true; })()`);
  console.log('state', await lv());
  await pause(1500); await shot('hud.png');
  await key('KeyC', 'c'); await pause(1200);
  check('character view open', await evaluate(cdp, 'window.__debug.invView.isOpen'), null);
  await shot('character.png');
  check('no page errors', errors.length === 0, errors);
} catch (e) { failed = true; console.log('FAIL ' + e.message); }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  console.log(failed ? 'FAIL player level stills' : 'PASS backpack drag'); process.exitCode = failed ? 1 : 0;
}
