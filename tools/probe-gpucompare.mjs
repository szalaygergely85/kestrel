// BUG-WHITE-PIXELS-02 r3: run gpucompare for one pose + probe, print window.__gpuProbe. node tools/probe-gpucompare.mjs 9520 webgl2 "pose=pixels-02&probe=scan"
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const THR = Number(process.env.THR || 245);

const frames = Number(opt('--frames', 120)), motion = opt('--motion', 'idle'), keys = opt('--keys', ''); // --frames N: sample N screenshots; --motion idle|jitter|strafe; --keys 'f,1' pressed once before sampling
const port = Number(args[0] || 9520); validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574');
const backend = args[1] || 'webgl2';
assert.ok(['webgpu', 'webgl2'].includes(backend));

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-white-'));

const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const q = args[2] || 'pose=pixels-02&probe=scan';
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({ backend }), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails.text + ' ' + (p.exceptionDetails.exception && p.exceptionDetails.exception.description)); if (m === 'Runtime.consoleAPICalled' && /gpucompare|error/i.test(JSON.stringify(p.args))) errors.push(JSON.stringify(p.args.map((a) => a.value)).slice(0, 300)); });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?gpucompare=1&renderer=mesh&backend=${backend}&${q}` });
  for (let i = 0; i < 500; i++) { await pause(500); if (await evaluate(cdp, '!!window.__gpuCompare')) break; }
  console.log(JSON.stringify(errors.slice(0,3)).slice(0,600));
  console.log(await evaluate(cdp, 'JSON.stringify({ rows: (window.__gpuCompare||{}).rows && window.__gpuCompare.rows.map(r => [r.pose, r.ok]), probe: window.__gpuProbe })'));
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup]', e.message); }
}
