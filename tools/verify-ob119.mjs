// OB-119: counts console messages containing 'used in submit while destroyed' while the player hops 4 poses 300+ m apart (band swaps), with and
// without ?decor=gpu. FAIL if any. Run: node tools/verify-ob119.mjs 9575 [webgpu] [--at x,y,z,yaw,pitch]   (port+1 = CDP; one server, 2 Chrome runs)
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
const HOPS = [[300, 0], [300, 300], [-300, 300], [0, -300]]; // metres relative to the start pose
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob119-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
async function run(decor) {
  const prof = path.join(profile, decor ? 'a' : 'b'); mkdirSync(prof, { recursive: true });
  const browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let cdp, bad = 0, other = [];
  try {
    cdp = await connectCdp(port + 1, 15000);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    cdp.onEvent((m, p) => { if (m === 'Runtime.consoleAPICalled') { const t = p.args.map((a) => a.value ?? a.description ?? '').join(' '); if (/used in submit while destroyed/.test(t)) bad++; else if (p.type === 'error' && other.length < 5) other.push(t.slice(0, 200)); } });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=${backend}${decor ? '&decor=gpu' : ''}&at=${at}` });
    let ready = false;
    for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.look)')) { ready = true; break; } }
    assert.ok(ready, 'boot failed');
    await pause(4000);
    for (const [dx, dy] of HOPS) {
      await evaluate(cdp, `(()=>{const t=window.__debug.playerHandle.data.transform;t.x+=${dx};t.y+=${dy};const b=window.__debug.playerHandle.data.components.body;if(b){b.vx=0;b.vy=0;b.vz=0;}})()`);
      await pause(4000);
    }
    await pause(2000);
  } finally { cdp?.close(); if (browser.pid) killTree(browser.pid); await pause(500); }
  console.log(`decor=${decor ? 'gpu' : 'off'}: "used in submit while destroyed" x${bad}` + (other.length ? ' | other errors: ' + other.join(' || ') : ''));
  return bad;
}
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  const off = await run(false), on = await run(true);
  assert.equal(off, 0, 'baseline (no ?decor=gpu) has the error');
  assert.equal(on, 0, '?decor=gpu has the error');
  console.log('OB-119 PASS');
} catch (e) { failed = true; console.log('FAIL ' + (e && e.message)); }
finally {
  if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
  process.exitCode = failed ? 1 : 0;
}
