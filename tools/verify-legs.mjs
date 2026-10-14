// ANIM-C-05: headless check of the leg IK wiring on Burl (the 'bear' NPC) walking up a slope in the real game page.
// Boots game/index.html, finds Burl, drives him a few metres along the steepest-ascent direction (walk clip, yaw = heading),
// and reports: components.voxel.legPose is set (w > 0), body pitch, and foot slide (planted foot targets must not move).
// Run: node tools/verify-legs.mjs {port} [backend]   (PC-B port 9500-9574, port+1 = CDP; backend webgpu default)
// Same CDP approach as tools/verify-chest-hook.mjs (capture-browser.mjs helpers). ?legik=0 comparison: set LEGIK0=1 (expects legs unset).
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');
const legik0 = process.env.LEGIK0 === '1';

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-legs-'));
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?title=0&gpu=1${legik0 ? '&legik=0' : ''}` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.world.get && window.__debug.world.get("bear"))')) { ready = true; break; } }
  assert.ok(ready, 'Burl (entity "bear") not found: ' + JSON.stringify(errors));

  // In the page: pick the steepest-ascent heading around Burl, walk him 1.0 m/s for ~6 s (each rAF), sample legPose + terrain per frame.
  const report = await evaluateAsync(cdp, `(async () => {
    const w = window.__debug.world, h = w.get('bear'), d = h.data, t = d.transform, v = d.components.voxel, g = w.terrain;
    let best = 0, bestSlope = -1e9;
    for (let a = 0; a < 360; a += 15) { const r = a * Math.PI / 180, dx = -Math.sin(r), dy = Math.cos(r); const s = g.groundAt(t.x + dx * 6, t.y + dy * 6) - g.groundAt(t.x, t.y); if (s > bestSlope) { bestSlope = s; best = a; } }
    const r = best * Math.PI / 180, dx = -Math.sin(r), dy = Math.cos(r);
    if (h.play) h.play('walk'); else v.anim = 'walk';
    const x0 = t.x, y0 = t.y, feet = [null, null, null, null], rows = [];
    let last = performance.now(), setCount = 0, frames = 0, maxSlideMm = 0, planted = 0, maxPitchDeg = 0;
    const T = performance.now() + 6000;
    while (performance.now() < T) {
      await new Promise((res) => requestAnimationFrame(res));
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      t.x += dx * 1.0 * dt; t.y += dy * 1.0 * dt; t.z = g.groundAt(t.x, t.y); t.yawDeg = best;
      if (v.anim !== 'walk' && h.play) h.play('walk');
      frames++;
      const lp = v.legPose;
      if (lp && lp[0] > 0) {
        setCount++;
        maxPitchDeg = Math.max(maxPitchDeg, Math.abs(lp[1]) * 180 / Math.PI);
        for (let k = 0; k < 4; k++) {
          const fx = lp[4 + k * 3], fy = lp[5 + k * 3], fz = lp[6 + k * 3], on = fz - g.groundAt(fx, fy) < 0.02; // foot target on the ground = stance
          if (on && feet[k] && feet[k].on) { const m = Math.hypot(fx - feet[k].x, fy - feet[k].y) * 1000; if (m < 1) planted++; else if (m < 20) maxSlideMm = Math.max(maxSlideMm, m); } // < 1 mm = fixed; 1..20 mm = slide; larger = a lift-off/landing jump, not counted
          feet[k] = { x: fx, y: fy, on };
        }
      }
    }
    return { headingDeg: best, rise6m: bestSlope, walkedM: Math.hypot(t.x - x0, t.y - y0), frames, framesWithLegPose: setCount, plantedSamples: planted, maxSlideMm, maxBodyPitchDeg: maxPitchDeg, anim: v.anim };
  })()`);
  console.log('[verify-legs]', JSON.stringify(report));
  writeFileSync(path.join(out, 'legs-burl-' + (legik0 ? 'off' : 'on') + '.json'), JSON.stringify(report, null, 2));
  if (legik0) assert.equal(report.framesWithLegPose, 0, '?legik=0: legPose must never be set');
  else {
    assert.ok(report.framesWithLegPose > report.frames * 0.5, 'inst.legs (components.voxel.legPose) set while walking');
    assert.ok(report.maxSlideMm <= 12, 'foot slide <= 12 mm (got ' + report.maxSlideMm + ')');
  }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('[verify-legs] OK');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
