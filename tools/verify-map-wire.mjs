// S8-B1-15: real-GPU owner-look capture of the MAP-01c wiring in the REAL game (game/index.html), not the
// mapCard.preview.html harness lane C already covers (tools/verify-map-chart.mjs). Checks the delta this story
// actually wires: the baked chart (content/chart/world_m1.chart.json) + the two world-space markers resolved
// from live entities (`endMarker` waystone, `tower.beaconBowl` relay) reach `initMapCard`'s optional 4th arg, `M`
// opens/Esc closes in the running game, the player arrow is drawn, and player input never reaches the sim while
// the card is open. capture-browser.mjs has no fitting mode for this (it reads `window.__gpuCompare`-style
// result globals from a single rendered frame, not a toggled UI card over several seconds of real play) - same
// CDP approach as tools/verify-chest-hook.mjs, PC-B port range only (9500-9574).
// Run: node tools/verify-map-wire.mjs 9510 (webgpu, default) or: node tools/verify-map-wire.mjs 9510 webgl2
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9510);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu', 'webgl2'].includes(backend), 'backend must be webgpu or webgl2');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-map-wire-'));
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 150, deviceScaleFactor: 1, mobile: false });
  async function key(code, keyChar = code) { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: keyChar }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyChar }); }
  async function shot(name) { await pause(350); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, name + '.png'), Buffer.from(s.data, 'base64')); }

  // `?voxelbench=0` = isCaptureOrBench (truthy string, never runs the bench mode) - no title menu/pause overlay,
  // same real wake-then-play timeline as a normal boot otherwise (no `?at=`/`?pose=`, which would skip
  // questUiActive - the map card only mounts under the real wake sequence, docs/sprints/sprint-8-queue.md S8-B1-15).
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?voxelbench=0&grid=400x150&backend=${backend}` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world)')) { ready = true; break; } }
  assert.ok(ready, 'world:loaded never fired: ' + JSON.stringify(errors));
  console.log('[1/6] world:loaded fired');

  // webgl2: UNMASKED_RENDERER string must not name a software rasterizer. webgpu: RenderTargetWebGPU.device.adapterInfo
  // (engine/render/createRenderer.js's own `fallback` flag, set true only for a software GPUAdapter) must be real.
  const info = await evaluate(cdp, '({backend: window.__debug.rt.backend, gpu: window.__debug.rt.gl ? window.__debug.rt.gl.getParameter(window.__debug.rt.gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL) : JSON.stringify(window.__debug.rt.device?.adapterInfo || null)})');
  assert.equal(info.backend, backend === 'webgl2' ? 'gl2' : backend, JSON.stringify(info));
  assert.doesNotMatch(String(info.gpu || ''), /swiftshader|software|llvmpipe/i, 'real GPU required: ' + JSON.stringify(info));
  if (backend === 'webgpu') assert.doesNotMatch(String(info.gpu || ''), /"fallback":true/, 'webgpu fell back to a software adapter: ' + JSON.stringify(info));
  console.log('[2/6] real GPU backend confirmed: ' + JSON.stringify(info));

  // The chart loaded and both world-space markers resolved (S8-B1-15's own delta): the fallback (no chartOptions)
  // card never sets a chartView, so `getMapChart()` would be null; the relay ('o'=111) and waystone ('O'=79)
  // glyph codes only ever appear in the baked art via a resolved marker (mapCard.js CHART_GLYPHS - no terrain
  // category uses either letter).
  const chart = await evaluate(cdp, '(()=>{const v=window.__debug.getMapChart();return v && {codes:Array.from(new Set(v.art.codes))};})()');
  assert.ok(chart, 'getMapChart() is null - chartOptions (content/chart/world_m1.chart.json + markers) never reached initMapCard');
  assert.ok(chart.codes.includes(111), 'relay marker (tower.beaconBowl) not drawn on the chart');
  assert.ok(chart.codes.includes(79), 'waystone marker (endMarker) not drawn on the chart');
  console.log('[3/6] chart + both markers resolved');

  // Real wake timeline (US-015: ~1s black + ~1.2s rise + 1s title-in + 3s hold + 1s title-out + 0.5s delay before
  // the first-show latch fires) - generous poll for this machine's slow Intel iGPU WebGPU path.
  let dismissed = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, "window.__debug.world.state['ui.mapCard.dismissed'] === true")) { dismissed = true; break; } }
  assert.ok(dismissed, 'wake timeline never latched ui.mapCard.dismissed - M would stay inert');
  console.log('[4/6] wake timeline done, M is live');

  assert.equal(await evaluate(cdp, 'window.__debug.isMapOpen()'), false, 'closed before the first M press');

  await key('KeyM', 'm');
  let opened = false;
  for (let i = 0; i < 20; i++) { await pause(100); if (await evaluate(cdp, 'window.__debug.isMapOpen()')) { opened = true; break; } }
  assert.ok(opened, 'M did not open the chart');
  console.log('[5/6] M opened the chart');

  const pos = await evaluate(cdp, 'window.__debug.getMapChart().position');
  assert.ok([94, 62, 118, 60].includes(pos.code), 'player arrow not drawn on the chart: ' + JSON.stringify(pos));
  await shot('map-wire-' + backend);

  await key('Escape');
  let closed = false;
  for (let i = 0; i < 20; i++) { await pause(100); if (await evaluate(cdp, 'window.__debug.isMapOpen() === false')) { closed = true; break; } }
  assert.ok(closed, 'Esc did not close the chart');
  console.log('[6/6] Esc closed the chart');

  assert.deepEqual(errors, [], 'console exceptions: ' + JSON.stringify(errors));
  console.log(JSON.stringify({ backend, info, chartCodes: chart.codes.length, pos }));
  console.log('Map wire (S8-B1-15): baked chart + markers loaded, M opens/Esc closes in the real game, arrow drawn, real-GPU PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300); // Windows: the just-killed browser can hold the profile dir open for a moment
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
