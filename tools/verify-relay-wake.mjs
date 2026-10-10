// WS1-06b: one headless capture of the Bend Relay dead and awake (CDP helpers as tools/verify-travel.mjs). The sim does not run headless:
// the player is teleported 6 m west of the relay, E is replaced by __debug.relayWake.interact('ws_roadBend') and the wake is stepped by hand.
// Asserts: dead = anim 'dead', light off; without aether.attuned nothing wakes; with it: wake clip, woken flag, then awake + light on + 0 errors.
// Shots: docs/test-reports/captures/relay-dead.png / relay-awake.png.
// Run: node tools/verify-relay-wake.mjs <port 9500-9574> [backend]   (CDP = port+1; backend webgpu default)
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9530);
const backend = process.argv[3] || 'webgpu';
const outDir = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(outDir, { recursive: true });
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-relay-wake-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [];
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails);
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`dev=1&save=1&backend=${backend}`)}` });
  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.relayWake)')) { ready = true; break; } }
  assert.ok(ready, 'world / relayWake never ready: ' + JSON.stringify(errors));
  const shot = async (name) => { await pause(900); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(outDir, name + '.png'), Buffer.from(s.data, 'base64')); };
  const st = () => evaluate(cdp, `(()=>{const d=window.__debug,r=d.world.get('relayBend').data.components;return JSON.stringify({anim:r.voxel.anim,light:r.light.on,woken:!!d.world.state['waystone.ws_roadBend.woken'],phase:d.relayWake.relays.find(x=>x.wsId==='ws_roadBend').phase});})()`).then(JSON.parse);
  // stand 6 m west of the relay, facing it
  await evaluate(cdp, "(()=>{const d=window.__debug,r=d.world.get('relayBend').data.transform,t=d.playerHandle.data.transform;t.x=r.x-6;t.y=r.y;t.z=r.z+1;t.yawDeg=90;})()");
  const dead = await st(); assert.deepEqual(dead, { anim: 'dead', light: false, woken: false, phase: 0 }, 'dead at boot');
  await shot('relay-dead-' + backend);
  // crystal gate: no flag -> nothing wakes
  await evaluate(cdp, "window.__debug.relayWake.interact('ws_roadBend')");
  assert.deepEqual(await st(), dead, 'no aether.attuned -> E does nothing');
  assert.ok(await evaluate(cdp, 'window.__debug.relayWake.hintLeft > 0'), 'hint toast shown');
  await evaluate(cdp, "window.__debug.world.state['aether.attuned'] = true");
  await evaluate(cdp, "window.__debug.relayWake.interact('ws_roadBend')");
  assert.ok(await evaluate(cdp, 'window.__debug.notice.active && window.__debug.notice.title.length > 0'), 'CH1-MOUNT: wake pushes the notice banner (title ' + await evaluate(cdp, 'window.__debug.notice.title') + ')');
  assert.equal(await evaluate(cdp, 'window.__debug.relayWake.toastLeft'), 0, 'no old toast when the notice view is mounted');
  const waking = await st(); assert.equal(waking.anim, 'wake'); assert.equal(waking.woken, true);
  await evaluate(cdp, "(()=>{const rw=window.__debug.relayWake,c=window.__debug.world.get('relayBend').data.components.voxel;for(let i=0;i<180;i++){rw.step(1/60,null);if(c.anim==='wake'&&i===70)c.playing=false;}})()");
  const awake = await st(); assert.deepEqual(awake, { anim: 'awake', light: true, woken: true, phase: 2 }, 'awake after the wake');
  await shot('relay-awake-' + backend);
  console.log(JSON.stringify({ dead, waking, awake }));
  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
  console.log('Relay wake (WS1-06b): dead -> gated -> wake -> awake PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
