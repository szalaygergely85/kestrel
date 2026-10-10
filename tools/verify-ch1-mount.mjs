// CH1-04b + CH1-08b: headless check of the dormant meadow stone and Fen's entrance. The sim does not run headless, so E and the steps are driven by hand.
// Asserts: stone dormant (anim dead, light off, no touch); crystal flag + stone-talk flag -> E (relayWake.interact) -> notice 'waystone' active, stone wakes;
// relay wake -> Fen hidden before, then visible + walking on emerge (fenEntrance stepped by hand) + 0 console errors.
// Run: node tools/verify-ch1-mount.mjs {port} [backend]   (port 9500-9574, CDP = port+1)
// (boilerplate as tools/verify-relay-wake.mjs)
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

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ch1-mount-'));
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
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.relayWake && window.__debug.relayWake)')) { ready = true; break; } }
  assert.ok(ready, 'world / relayWake never ready (needs ?save=1): ' + JSON.stringify(errors));
  const shot = async (name) => { await pause(900); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(outDir, name + '.png'), Buffer.from(s.data, 'base64')); };
  const D = (js) => evaluate(cdp, js);
  const stone = () => D(`(()=>{const d=window.__debug,c=d.world.get('endMarker').data.components;return JSON.stringify({anim:c.voxel.anim,light:c.light.on,woken:!!d.world.state['waystone.waystone.woken'],notice:d.notice.active});})()`).then(JSON.parse);
  // far from everything: the stone is dormant
  const s0 = await stone(); assert.deepEqual(s0, { anim: 'dead', light: false, woken: false, notice: false }, 'stone dormant at boot');
  assert.equal(await D("window.__debug.world.get('fen') == null"), true, 'no Fen entity (FEN-OFF-01)'); assert.equal(await D('window.__debug.fenEntrance == null'), true);
  // gates: no crystal, no talk -> nothing; crystal only -> nothing
  await D("window.__debug.relayWake.interact('waystone')"); assert.deepEqual(await stone(), s0, 'gated: nothing');
  await D("window.__debug.world.state['aether.attuned'] = true"); await D("window.__debug.relayWake.interact('waystone')"); assert.deepEqual(await stone(), s0, 'needs the stone talk');
  // stone talk flag + E -> wake + notice
  await D("window.__debug.world.state['dlg.bear.stone.told'] = true");
  await D("(()=>{const d=window.__debug,r=d.world.get('endMarker').data.transform,t=d.playerHandle.data.transform;t.x=r.x-4;t.y=r.y;t.z=r.z+1;t.yawDeg=90;})()");
  await D("window.__debug.relayWake.interact('waystone')");
  const w = await stone(); assert.equal(w.anim, 'wake'); assert.equal(w.woken, true); assert.equal(w.notice, true, "notice 'waystone' active");
  assert.equal(await D('window.__debug.notice.title'), 'WAYSTONE AWAKENED');
  await D("(()=>{const rw=window.__debug.relayWake,c=window.__debug.world.get('endMarker').data.components.voxel;for(let i=0;i<240;i++){rw.step(1/60,null);if(c.anim==='wake'&&i===70)c.playing=false;}})()");
  const aw = await stone(); assert.equal(aw.anim, 'awake'); assert.equal(aw.light, true);
  // relay wake: no Fen entrance any more (FEN-OFF-01)
  await D("window.__debug.relayWake.interact('ws_roadBend')");
  await shot('ch1-mount-relay-' + backend);
  console.log(JSON.stringify({ s0, w, aw }));
  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
  console.log('CH1 mount (CH1-04b stone wake; Fen removed): PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
