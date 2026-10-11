// QL-WIRE: headless structural check of the Ch1-2 errand wiring: post / notePost [E] Inspect interactables, hillPath area trigger, 21 errand defs in the book,
// inspect hook live (window.__debug.errands). Loads game/index.html?dev=1 (saves on). Run: node tools/verify-errands.mjs <port>   (PC-B lane ports 9500-9574; CDP = port+1)
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9520);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-qui-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [];
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails);
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`dev=1&backend=webgpu`)}` });

  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle)')) { ready = true; break; } }
  assert.ok(ready, 'world never loaded: ' + JSON.stringify(errors));
  console.log('[1/2] world loaded');
  const ev = (js) => evaluate(cdp, js);
  const r = JSON.parse(await ev(`JSON.stringify((()=>{const d=window.__debug,w=d.world,b=d.questBook(); const ids=[]; for(let i=1;i<b.count;i++) ids.push(b.def(i).id);
    return {keys:w.interactables.map(r=>r.key).filter(k=>k.startsWith('qi.')), hill:!!w.triggers.find(t=>t.key==='world.hillPath'), errands:!!d.errands, n:ids.filter(x=>/^sq\.(tm|burl|post|straw|rb|fc)/.test(x)).length, nubMissing:b.statusOf('sq.tm.nub')};})())`));
  console.log('[2/2] wiring', JSON.stringify(r));
  assert.ok(r.keys.includes('qi.post') && r.keys.includes('qi.notePost'), 'post / notePost get [E] Inspect');
  assert.ok(r.hill && r.errands && r.n >= 21, 'hillPath trigger + errands object + 21 errand defs');
  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
  console.log('Errand wiring (QL-WIRE), PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
