#!/usr/bin/env node
// WM-11: owner-look stills of the 10 opened regions on the DEFAULT world (WM-05 grid + polygon). Real-GPU headless Chrome over CDP, own server.
//   node tools/verify-wm-regions.mjs 9650        (PC-B range 9500-9999; port+1 = CDP)
// Boots game/index.html once (voxelbench=0 = no pause overlay), then per region: teleports the player to ground+0.2 at the pose (same pose list as
// tools/bench-life.mjs POSES), looks toward the tower, waits for the band/meshes, saves docs/test-reports/wm-regions/<slug>.png. Closes only its own processes.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

export const REGIONS = [['glasswater', 1200, 600], ['northwood', 1660, 600], ['high-pastures', 650, 600], ['ash-mile', 1780, 1100], ['downs', 1580, 1430],
  ['signal-hill', 720, 1300], ['heath', 450, 1350], ['reedmire', 1090, 1510], ['strand', 1590, 1720], ['whitecombs-foot', 150, 300]];
const TOWER = [1470, 1029];

const port = Number(process.argv[2] || 9650);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-wm-regions-'));
const out = path.join(ROOT, 'docs/test-reports/wm-regions'); mkdirSync(out, { recursive: true });
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
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?voxelbench=0` }); // default world: no grid flag needed (WM-05)
  let ready = false;
  for (let i = 0; i < 400 && !ready; i++) { await pause(500); ready = await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.look && window.__debug.world)'); }
  if (!ready) throw new Error('player never spawned: ' + JSON.stringify(errors).slice(0, 600));
  for (const [slug, x, y] of REGIONS) {
    const yaw = Math.atan2(TOWER[0] - x, -(TOWER[1] - y)) * 180 / Math.PI;
    const info = await evaluate(cdp, `(()=>{const D=window.__debug,w=D.world,t=D.playerHandle.data.transform,b=D.playerHandle.data.components.body;
      if (w.ensureBandFor) w.ensureBandFor(${x},${y}); const z=w.terrain.groundAt(${x},${y});
      t.x=${x}; t.y=${y}; t.z=z+0.2; b.vx=b.vy=b.vz=0; b.peakZ=t.z; b.grounded=true; D.look.yawDeg=${yaw}; D.look.pitchDeg=0; return {z:+z.toFixed(1), band:w.bandId};})()`);
    await pause(4000); // let the band swap + mesh/scatter feed settle
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(out, slug + '.png'), Buffer.from(s.data, 'base64'));
    console.log(slug.padEnd(16), x, y, JSON.stringify(info));
  }
  console.log(errors.length ? 'page errors: ' + JSON.stringify(errors).slice(0, 800) : 'no page errors', '- stills in docs/test-reports/wm-regions/');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
