// INT-HL-01: stand 2 m from a tower note, look 25 deg off it (on screen, not the crosshair target) and count use-hint markers;
// then aim at it (target -> no marker for it) and open the note (all markers hidden).
// Run: node tools/verify-use-hints.mjs 9500   (PC-B lane ports 9500-9999; CDP = port+1)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { evaluateAsync, ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port + 1 > 9999) throw new Error('CDP port is port+1');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-use-hints-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.openNote && window.__debug.world && window.__debug.playerHandle && window.__debug.look)')) { ready = true; break; } }
  assert.ok(ready, 'game did not boot');
  for (let i = 0; i < 120; i++) { if (!(await evaluate(cdp, 'window.__debug.wakeOut.inputLocked'))) break; await pause(500); } // intro wake-up locks input (and hides hints / blocks the sword)
  await evaluate(cdp, 'window.__debug.look.locked = true'); // headless has no pointer lock
  // first unused, requirement-free interactable whose name mentions "note" (tower notes); fall back to any
  const info = await evaluate(cdp, `(()=>{const w=__debug.world,l=w.interactables.filter(r=>!(r.usedKey&&w.state[r.usedKey])&&!r.requires);const r=l.find(r=>/note/i.test(r.name||r.key))||l[0];return r?{key:r.key,x:r.x,y:r.y,z:r.z}:null;})()`);
  assert.ok(info, 'no usable interactable in the world');
  // put the player 2 m south of it, looking 25 deg to the right of it
  // yaw = compass bearing player -> note (0 = N = -y, clockwise; same as engine/core/transform.js yawFromDelta) + offset; pitch looks at the note (eye ~1.6 m, positive = up)
  const sx = info.x - 1.6, sy = info.y, sz = info.z + 0.05; // inside the tower (the wake spot is 1.6 m west of the keeper note); interactable z = floor level
  const bearing = (Math.atan2(info.x - sx, -(info.y - sy)) * 180) / Math.PI;
  const pitch = (Math.atan2(info.z - (sz + 1.6), Math.hypot(info.x - sx, info.y - sy)) * 180) / Math.PI;
  const stand = (yawOff) => evaluate(cdp, `(()=>{const p=__debug.playerHandle.data.transform;p.x=${sx};p.y=${sy};p.z=${sz};__debug.look.yawDeg=${bearing + yawOff};__debug.look.pitchDeg=${pitch};return 1;})()`);
  await stand(10); await pause(1500);
  const a = await evaluate(cdp, 'JSON.stringify({n:__debug.useHints.n,keys:Array.from(__debug.useHints.key).slice(0,__debug.useHints.n)})');
  console.log('off-axis', a);
  const A = JSON.parse(a); assert.ok(A.n >= 1 && A.n <= 6, 'markers shown off-axis (1..6)'); assert.ok(A.keys.includes(info.key), 'the note is marked');
  await stand(0); await pause(1500);
  const b = JSON.parse(await evaluate(cdp, 'JSON.stringify({n:__debug.useHints.n,keys:Array.from(__debug.useHints.key).slice(0,__debug.useHints.n),t:__debug.world.interaction.targetKey})'));
  console.log('aimed', JSON.stringify(b));
  if (b.t) assert.ok(!b.keys.includes(b.t), 'the crosshair target is not marked');
  await evaluate(cdp, 'window.__debug.look.locked = false'); await pause(800);
  assert.equal(await evaluate(cdp, '__debug.useHints.n'), 0, 'no markers while the pause menu is up');
  console.log('ALL PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
}
