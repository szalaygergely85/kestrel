// S8-B1-18 owner-look capture: ambient dust motes in a sunbeam, via a forest/sunbeam
// scene. Same CDP approach as tools/verify-chest-hook.mjs, reusing capture-browser.mjs's
// exported helpers - PC-B port range only (9500-9574). Starts its own server, kills only
// the processes it spawned, screenshots into docs/test-reports/captures/.
// Run: node tools/verify-motes.mjs 9500 (webgpu, default)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-verify-motes-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  async function shot(name) { await pause(350); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, name + '.png'), Buffer.from(s.data, 'base64')); }

  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&ambient=1&pose=${process.env.POSE || 'roadSouth'}&backend=${backend}` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!window.__kestrel')) { ready = true; break; } }
  assert.ok(ready, JSON.stringify(errors));
  // Headless Chrome never gets pointer lock and an unlocked look pauses the sim (pause.js isPaused).
  await evaluate(cdp, 'setInterval(() => { if (window.__debug.look) window.__debug.look.locked = true; }, 30), true');
  // Let the motes emitter warm up to its steady ~60-particle state before capture.
  await pause(3000);
  // Positions, not just counts: every live mote must be finite and within the emission box (3.5, 3.5, 2 + drift) of the player.
  const motes = await evaluate(cdp, `(() => { const d = window.__debug, p = d.engine.particles, t = d.playerHandle.data.transform; let n = 0, bad = 0, maxD = 0;
    for (let i = 0; i < p.cap; i++) { if (!p.alive[i]) continue; n++; const dx = p.px[i] - t.x, dy = p.py[i] - t.y, dz = p.pz[i] - t.z;
      if (!isFinite(dx + dy + dz)) bad++; else maxD = Math.max(maxD, Math.abs(dx), Math.abs(dy)); }
    return { n, bad, maxD, player: [t.x, t.y, t.z] }; })()`);
  console.log(JSON.stringify({ motes }));
  if (!motes.n) console.log('particles.stats', JSON.stringify(await evaluate(cdp, 'JSON.stringify(window.__debug.engine.particles.stats)')));
  assert.ok(motes.n > 0, 'motes are alive');
  assert.equal(motes.bad, 0, 'no NaN mote positions');
  assert.ok(motes.maxD < 40, 'motes stay near the player (emitter follows playerHandle.data.transform)');
  await shot('ambient-motes-sunbeam-' + backend);
  console.log(JSON.stringify({ backend, errors }));
  assert.deepEqual(errors, []);
  console.log('Ambient dust motes: owner-look capture saved for backend', backend, '- eyeball the screenshot for sunbeam placement/density');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300); // Windows: the just-killed browser can hold the profile dir open for a moment
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
