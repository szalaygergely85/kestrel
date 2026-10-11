// OB-052: headless sweep of interaction targeting near the start note. Stands 1.2 m from the interactable nearest the
// spawn (prefers a note), sweeps pitch -40..+20 (step 5) and yaw +-30 around the bearing to it (step 5) and reports the
// fraction of poses that still yield a prompt via the real engine findInteractTarget (no input/sim needed).
// Run: node tools/verify-interact-aim.mjs <port>   (PC-B lane B2 any validatePort range; the CDP port is port+1)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9660);
validatePort(port);
if (port + 1 > 9999) throw new Error('CDP port is port+1');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-aim-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1` });
  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle)')) { ready = true; break; } }
  assert.ok(ready, 'world never loaded');
  const r = JSON.parse(await evaluateAsync(cdp, `(async () => {
    const { findInteractTarget } = await import('/engine/index.js');
    const w = window.__debug.world, p = window.__debug.playerHandle.data.transform;
    const list = w.interactables.filter((r) => r.prompt);
    const d2 = (r) => (r.x - p.x) ** 2 + (r.y - p.y) ** 2;
    const notes = list.filter((r) => /note|read/i.test(r.prompt + r.name));
    const pool = notes.length ? notes : list;
    pool.sort((a, b) => d2(a) - d2(b));
    const t = pool[0]; if (!t) return JSON.stringify({ err: 'no interactable' });
    const out = { targetKey: null, prompt: '', dist: 0, angleDeg: 0 };
    let hit = 0, n = 0; const rows = {};
    for (let pitch = -40; pitch <= 20; pitch += 5) {
      let rowHit = 0, rowN = 0;
      for (let dyaw = -30; dyaw <= 30; dyaw += 5) {
        const ang = Math.atan2(t.x - p.x, -(t.y - p.y)) * 180 / Math.PI; // compass bearing p -> t
        const ex = t.x - 1.2 * Math.sin(ang * Math.PI / 180), ey = t.y + 1.2 * Math.cos(ang * Math.PI / 180);
        out.targetKey = null; // fresh: no hysteresis help
        findInteractTarget(w, { x: ex, y: ey, z: t.z + 0.9, yawDeg: ang + dyaw, pitchDeg: pitch }, null, out);
        rowN++; n++; if (out.targetKey === t.key) { rowHit++; hit++; }
      }
      rows[pitch] = (rowHit / rowN).toFixed(2);
    }
    return JSON.stringify({ target: t.key, prompt: t.prompt, fraction: hit / n, byPitch: rows });
  })()`));
  console.log(JSON.stringify(r));
  assert.ok(!r.err, r.err);
  assert.ok(r.fraction >= 0.6, 'prompt fraction too low: ' + r.fraction);
  console.log('Interact aim sweep PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
