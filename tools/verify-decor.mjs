// ENV-01d (38.62): headless real-GPU check of the GPU decor scatter at a meadow pose: loads the game with ?decor=gpu, runs ~300 frames, asserts no page
// exceptions / frame errors and a decor count > 0. Same CDP shape as tools/verify-chest-hook.mjs / verify-ob111.mjs.
// Run: node tools/verify-decor.mjs 9575 [webgpu] [--at x,y,z,yaw,pitch]    (PC-B ports 9500-9999; port+1 = CDP). Default pose = the ford spot of verify-ob111.
// NEEDS B1-main: window.__debug.decorStats() -> { on:boolean, count:number (kept rows; debug readback), dispatches:number, frameErrors:number }.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const args = process.argv.slice(2);
const port = Number(args[0] || 9575);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const backend = args[1] && !args[1].startsWith('--') ? args[1] : 'webgpu';
assert.ok(backend === 'webgpu', 'backend must be webgpu');
const atIx = args.indexOf('--at'), at = atIx >= 0 ? args[atIx + 1] : '1045.96,1066.69,-87.13,246,-11';
const FRAMES = 300;

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-decor-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = async () => JSON.parse(await evaluate(cdp, 'JSON.stringify(window.__debug.decorStats())'));
let browser, cdp, failed = false, warns = [];
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; warns = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails.text); if (m === 'Runtime.consoleAPICalled' && (p.type === 'warning' || p.type === 'error')) warns.push(p.type + ': ' + p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=${backend}&decor=gpu&at=${at}` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.look && window.__debug.decorStats)')) { ready = true; break; } }
  assert.ok(ready, 'boot failed or window.__debug.decorStats missing (NEEDS B1-main) ' + JSON.stringify(errors));
  await evaluate(cdp, 'window.__debug.look.locked = true');
  const s0 = await stats();
  for (let i = 0; i < 100; i++) { await pause(500); const c = await stats(); if (c.dispatches - s0.dispatches >= FRAMES) break; }
  const s = await stats();
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, 'decor-gpu-' + backend + '.png'), Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify(s));
  assert.equal(s.on, true, 'decor pass on (?decor=gpu)');
  assert.ok(s.dispatches - s0.dispatches >= FRAMES, `>= ${FRAMES} frames with decor dispatches, got ${s.dispatches - s0.dispatches}`);
  assert.equal((s.frameErrors | 0) - (s0.frameErrors | 0), 0, 'no frame errors');
  assert.ok(s.count > 0, 'decor count > 0 at the meadow pose');
  assert.deepEqual(errors, []);
  console.log('Decor GPU: ' + FRAMES + ' frames without errors, count ' + s.count + ' PASS');
} catch (e) { failed = true; console.log('FAIL ' + (e && e.message)); for (const w of warns.filter((x) => /decor|WgCell|WebGPU|gpu/i.test(x)).concat(warns).slice(0, 12)) console.log('  console ' + w); }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
  process.exitCode = failed ? 1 : 0;
}
