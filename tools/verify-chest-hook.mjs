// S8-B1-04: real-GPU owner-look capture of the chest hook (interact -> open clip -> item granted -> item-get
// card), via game/js/chestHook.preview.html. Same CDP approach as tools/verify-item-card.mjs (lane C), reusing
// capture-browser.mjs's exported helpers - PC-B port range only (9500-9574).
// Run: node tools/verify-chest-hook.mjs 9500 (webgpu, default) or: node tools/verify-chest-hook.mjs 9500 webgl2
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu', 'webgl2'].includes(backend), 'backend must be webgpu or webgl2');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-chest-hook-'));
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
  async function shot(name) { await pause(350); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, name + '.png'), Buffer.from(s.data, 'base64')); }

  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/js/chestHook.preview.html?backend=${backend}` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!window.__chestHookPreview')) { ready = true; break; } }
  assert.ok(ready, JSON.stringify(errors));
  const state0 = await evaluate(cdp, '(()=>{const p=__chestHookPreview;return {chest:p.world.get("chestEntity1").anim,cardOpen:p.hook.card.isOpen,count:p.count};})()');
  assert.deepEqual(state0, { chest: 'closed', cardOpen: false, count: 0 }, 'closed at boot');
  await shot('chest-hook-closed-' + backend);

  // Face away first: E must not open it (wrong facing).
  const away = await evaluate(cdp, '(()=>{const r=document.querySelector("#away").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...away });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...away });
  await pause(200);
  assert.equal(await evaluate(cdp, '__chestHookPreview.world.get("chestEntity1").anim'), 'closed', 'facing away does not open it');

  // Face the chest and press E: opens, grants the item, shows the card.
  const face = await evaluate(cdp, '(()=>{const r=document.querySelector("#face").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...face });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...face });
  for (let i = 0; i < 40; i++) { await pause(50); if (await evaluate(cdp, '__chestHookPreview.hook.card.isOpen')) break; }
  const state1 = await evaluate(cdp, '(()=>{const p=__chestHookPreview;return {chest:p.world.get("chestEntity1").anim,cardOpen:p.hook.card.isOpen,count:p.count,id:p.hook.card.snapshot().id};})()');
  assert.deepEqual(state1, { chest: 'opened', cardOpen: true, count: 2, id: 'brass.scrap' }, JSON.stringify({ state1, errors }));
  await shot('chest-hook-card-' + backend);
  console.log(JSON.stringify({ backend, state0, state1 }));
  assert.deepEqual(errors, []);
  console.log('Chest hook: facing-away refusal, E opens once, item granted, item-get card shown on the requested real-GPU backend PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300); // Windows: the just-killed browser can hold the profile dir open for a moment
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
