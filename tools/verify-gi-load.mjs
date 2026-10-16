// GI-PATH-01: baked GI bins must load in the real game (200 for content/gi/*.gi.bin, no 404 for any gi bin).
// Boots game/index.html?title=0 (start meadow, quality=high so GI is on), listens to CDP Network events.
// Run: node tools/verify-gi-load.mjs 9730   (PC-B range 9500-9999; port+1 = CDP)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9730);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-gi-load-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  const gi = []; // {url, status}
  cdp.onEvent((m, p) => { if (m === 'Network.responseReceived' && /\/content\/gi\/.*\.gi\.bin/.test(p.response.url)) gi.push({ url: p.response.url, status: p.response.status }); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?save=0&nopause=1&quality=high&backend=webgpu&title=0` });
  for (let i = 0; i < 100; i++) { await pause(300); if (gi.some((r) => r.status === 200) && i > 10) break; }
  await pause(1500); // let the remaining zone bins arrive
  const bad = gi.filter((r) => r.status !== 200), ok = gi.filter((r) => r.status === 200);
  console.log(JSON.stringify({ requests: gi.length, ok: ok.length, bad, sample: ok.slice(0, 3).map((r) => r.url) }));
  assert.ok(ok.length >= 1, 'at least one content/gi/*.gi.bin answered 200');
  assert.deepEqual(bad, [], 'no non-200 gi bin');
  console.log('GI load: baked bins fetched with 200, no 404 PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}
