// CHARGEN-15: headless check that the add-on villager boots. The sim does not run headless, so this only asserts the
// `char.villager_01` model is registered from content/packages/villager_01.kestrel, the entity exists, 0 console errors.
// Run: node tools/verify-villager.mjs <port>   (PC-B lane ports 9500-9574; the CDP port is port+1)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9530);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B range is 9500-9574 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-villager-'));
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
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&save=0&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle)')) { ready = true; break; } }
  assert.ok(ready, 'world never loaded: ' + JSON.stringify(errors));
  console.log('[1/3] world loaded');
  const ent = await evaluate(cdp, 'JSON.stringify((()=>{ const w=window.__debug.world; const e=w.get&&w.get("villager1"); return e ? { id: "villager1", model: e.getComponent ? (e.getComponent("voxel")||{}).model : null } : null; })())');
  assert.ok(ent && ent !== 'null', 'villager entity villager1 not found via world.get');
  const reg = await evaluate(cdp, 'JSON.stringify((()=>{ const R=window.__debug.wildRaw; const p=R&&R.pool; return { pool: !!(p&&p.models&&p.models.get&&p.models.get("char.villager_01")) }; })())');
  assert.ok(JSON.parse(reg).pool, 'char.villager_01 not in the game voxel pool: ' + reg + ' entity ' + ent);
  console.log('[2/3] villager entity + model registered');
  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
  console.log('[3/3] 0 console errors');
  console.log('Villager (CHARGEN-15): add-on package loaded, PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
