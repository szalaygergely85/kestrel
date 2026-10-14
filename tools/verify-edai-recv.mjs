// ED-AI-RECV verify: node tools/verify-edai-recv.mjs <port 9500-9998>. One headless Chrome (CDP helpers of capture-browser.mjs):
// the game boots with ?playtest=1 (receiver on BroadcastChannel 'kestrel-ai-patch'); a second BroadcastChannel object in the
// same origin plays the editor, sends one ai-patch and expects the ai-patch-result. Same shape as verify-chest-hook.mjs.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-edai-recv-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?playtest=1&title=0` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.beasts)')) { ready = true; break; } }
  assert.ok(ready, 'game sim not ready ' + JSON.stringify(errors));
  const res = await evaluateAsync(cdp, `new Promise((ok) => { const c = new BroadcastChannel('kestrel-ai-patch'); c.onmessage = (e) => { if (e.data && e.data.type === 'ai-patch-result') ok(e.data); }; c.postMessage({ type: 'ai-patch', name: 'wolf', fields: {} }); setTimeout(() => ok(null), 5000); })`);
  assert.ok(res && res.type === 'ai-patch-result' && res.name === 'wolf' && Array.isArray(res.refused), 'no ai-patch-result: ' + JSON.stringify(res));
  console.log('verify-edai-recv OK ' + JSON.stringify(res));
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
