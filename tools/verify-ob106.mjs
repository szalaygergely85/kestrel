// OB-106: real-game check that "[E] Open chest" shows at a chest. Stands 1.3 m in front of the hidden chest `secretRook`, aims at it,
// asserts world.interaction.prompt, then aims 1 m aside (no prompt), takes a still. NOT yet run in a browser (Node-only session).
// Run: node tools/verify-ob106.mjs 9500   (PC-B lane range 9500-9574; port+1 = CDP)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob106-'));
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!window.__kestrel && !!window.__debug && !!window.__debug.playerHandle')) { ready = true; break; } }
  assert.ok(ready, JSON.stringify(errors));
  await evaluate(cdp, 'Object.defineProperty(window.__debug.look, "locked", { get: () => true, set() {}, configurable: true }), true'); // headless never gets pointer lock
  for (let i = 0; i < 120; i++) { if (!(await evaluate(cdp, 'window.__debug.wakeOut.inputLocked'))) break; await pause(500); } // intro wake-up locks input
  // Stand 1.3 m in front of the chest (its local front = compass forward of its yaw) and aim `side` metres sideways of its centre.
  const aim = (side) => evaluate(cdp, `(() => { const d = window.__debug, w = d.engine.world, c = w.entity('secretRook'), t = c.transform, ya = (t.yawDeg || 0) * Math.PI / 180,
    fx = Math.sin(ya), fy = -Math.cos(ya), p = d.playerHandle.data.transform, eyeH = d.engine.physics.eyeHeight;
    p.x = t.x + fx * 1.3; p.y = t.y + fy * 1.3; p.z = t.z;
    const tx = t.x - fy * ${side}, ty = t.y + fx * ${side}, tz = t.z + 0.275, dx = tx - p.x, dy = ty - p.y;
    d.look.yawDeg = Math.atan2(dx, -dy) * 180 / Math.PI; d.look.pitchDeg = Math.atan2(tz - (p.z + eyeH), Math.hypot(dx, dy)) * 180 / Math.PI; return true; })()`);
  const prompt = () => evaluate(cdp, 'window.__debug.engine.world.interaction.prompt');
  await aim(0); await pause(600);
  const at = await prompt();
  await cdp.send('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(path.join(out, 'ob106-chest-prompt.png'), Buffer.from(s.data, 'base64')));
  await aim(1); await pause(600);
  const aside = await prompt();
  console.log(JSON.stringify({ at, aside }));
  assert.equal(at, '[E] Open chest', 'prompt when aimed at the chest');
  assert.equal(aside, '', 'no prompt when aimed 1 m aside');
  assert.deepEqual(errors, []);
  console.log('OB-106: [E] Open chest shows when aimed at a chest, not beside it PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
