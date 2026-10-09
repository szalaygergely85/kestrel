// S8-B1-15/S8-B1-16: real-GPU owner-look capture of the MAP-01c/MAP-01d wiring in the REAL game
// (game/index.html), not the mapCard.preview.html harness lane C already covers (tools/verify-map-chart.mjs).
// Checks the delta these stories actually wire: the baked chart (content/chart/world_m1.chart.json) + the two
// world-space markers resolved from live entities (`endMarker` waystone, `tower.beaconBowl` relay) reach
// `initMapCard`'s optional 4th arg, `M` opens/Esc closes in the running game, the player arrow is drawn, player
// input never reaches the sim while the card is open (S8-B1-15) - AND (S8-B1-16) the per-tick seam feed
// (game/js/mapFogHook.js) grows the saved visited-cell mask as the player moves while the rest of the chart
// stays blank paper, and `world.state['ui.mapFog']` carries that mask for the save. capture-browser.mjs has no
// fitting mode for this (it reads `window.__gpuCompare`-style result globals from a single rendered frame, not
// a toggled UI card over several seconds of real play) - same CDP approach as tools/verify-chest-hook.mjs,
// PC-B port range only (9500-9574). The 100 m walk is a direct `transform.x/y` write each rAF frame (not real
// WASD input) - this story's own delta is the per-tick fog feed off the player's live transform, not physics/
// collision (already covered by tools/route-walk-browser.mjs), so a deterministic straight-line move is enough
// and avoids depending on 100 m of obstacle-free terrain in a known direction.
// Run: node tools/verify-map-wire.mjs 9510 (webgpu, default)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9510);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');

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
  console.log('[1/9] world:loaded fired');

  // webgpu: RenderTargetWebGPU.device.adapterInfo
  // (engine/render/createRenderer.js's own `fallback` flag, set true only for a software GPUAdapter) must be real.
  const info = await evaluate(cdp, '({backend: window.__debug.rt.backend, gpu: window.__debug.rt.gl ? window.__debug.rt.gl.getParameter(window.__debug.rt.gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL) : JSON.stringify(window.__debug.rt.device?.adapterInfo || null)})');
  assert.equal(info.backend, backend, JSON.stringify(info));
  assert.doesNotMatch(String(info.gpu || ''), /swiftshader|software|llvmpipe/i, 'real GPU required: ' + JSON.stringify(info));
  if (backend === 'webgpu') assert.doesNotMatch(String(info.gpu || ''), /"fallback":true/, 'webgpu fell back to a software adapter: ' + JSON.stringify(info));
  console.log('[2/9] real GPU backend confirmed: ' + JSON.stringify(info));

  // The chart loaded and both world-space markers resolved (S8-B1-15's own delta): the fallback (no chartOptions)
  // card never sets a chartView, so `getMapChart()` would be null; the relay ('o'=111) and waystone ('O'=79)
  // glyph codes only ever appear in the baked art via a resolved marker (mapCard.js CHART_GLYPHS - no terrain
  // category uses either letter).
  const chart = await evaluate(cdp, '(()=>{const v=window.__debug.getMapChart();return v && {codes:Array.from(new Set(v.art.codes))};})()');
  assert.ok(chart, 'getMapChart() is null - chartOptions (content/chart/world_m1.chart.json + markers) never reached initMapCard');
  assert.ok(chart.codes.includes(111), 'relay marker (tower.beaconBowl) not drawn on the chart');
  assert.ok(chart.codes.includes(79), 'waystone marker (endMarker) not drawn on the chart');
  console.log('[3/9] chart + both markers resolved');

  // Real wake timeline (US-015: ~1s black + ~1.2s rise + 1s title-in + 3s hold + 1s title-out + 0.5s delay before
  // the first-show latch fires) - generous poll for this machine's slow Intel iGPU WebGPU path.
  let dismissed = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, "window.__debug.world.state['ui.mapCard.dismissed'] === true")) { dismissed = true; break; } }
  assert.ok(dismissed, 'wake timeline never latched ui.mapCard.dismissed - M would stay inert');
  console.log('[4/9] wake timeline done, M is live');

  assert.equal(await evaluate(cdp, 'window.__debug.isMapOpen()'), false, 'closed before the first M press');

  await key('KeyM', 'm');
  let opened = false;
  for (let i = 0; i < 20; i++) { await pause(100); if (await evaluate(cdp, 'window.__debug.isMapOpen()')) { opened = true; break; } }
  assert.ok(opened, 'M did not open the chart');
  console.log('[5/9] M opened the chart');

  const pos = await evaluate(cdp, 'window.__debug.getMapChart().position');
  assert.ok([94, 62, 118, 60].includes(pos.code), 'player arrow not drawn on the chart: ' + JSON.stringify(pos));
  await shot('map-wire-' + backend);

  await key('Escape');
  let closed = false;
  for (let i = 0; i < 20; i++) { await pause(100); if (await evaluate(cdp, 'window.__debug.isMapOpen() === false')) { closed = true; break; } }
  assert.ok(closed, 'Esc did not close the chart');
  console.log('[6/9] Esc closed the chart');

  // ---- S8-B1-16: MAP-01d wiring (visited-cell feed + saved fog mask) ----
  // The fog is fed every tick (mapFogHook.js) regardless of whether the chart is open - it is player
  // exploration, not a map-viewing effect - so the mask already grew a little during the wake walk-in. Pick a
  // point 300 m due north of the CURRENT player position (well beyond the 100 m walk below, and well inside
  // the chart's huge 2048x2048 m bounds from any spawn) as the "rest stays blank paper" witness, and confirm
  // world.state['ui.mapFog'] is the plain JSON byte array the save relies on (US-089a: `world.state`
  // round-trips verbatim through `serialize(world)` - no saveRelay.js/saveState.js edits needed for this field).
  const before = await evaluate(cdp, `(()=>{const f=window.__debug.getMapChart().fog,t=window.__debug.playerHandle.data.transform;
    const farPoint={x:t.x,y:t.y-300};return {farPoint,explored:f.isExplored(farPoint.x,farPoint.y),routeCount:f.routeCount,
    saveFieldIsArray:Array.isArray(window.__debug.world.state['ui.mapFog'])};})()`);
  assert.equal(before.explored, false, '300 m-away witness point already explored before walking: ' + JSON.stringify(before));
  assert.ok(before.saveFieldIsArray, "world.state['ui.mapFog'] missing/not an array before the walk");
  console.log('[7/9] fog feed active, save field present, far witness point unexplored: ' + JSON.stringify(before));

  // Deterministic straight-line ~100 m walk: writes `transform.x/y` directly each rAF frame (same object
  // mapFogHook.js/physics both read - see the file header for why this, not real WASD input, is the right
  // tool for THIS story's delta). `z` is left alone (no floor snapping) so ground collision/gravity cannot
  // nudge x/y off the intended line - this teleport only needs to exercise the fog feed, not physics. 240
  // frames is generous on this machine's slow Intel iGPU (no fixed real-time budget - it just runs the steps).
  const walk = await evaluateAsync(cdp, `(async () => {
    const D = window.__debug, t = D.playerHandle.data.transform;
    const start = { x: t.x, y: t.y };
    const steps = 240, distM = 100;
    const sleepF = () => new Promise((r) => requestAnimationFrame(r));
    for (let i = 1; i <= steps; i++) {
      t.x = start.x; t.y = start.y - distM * i / steps;
      await sleepF();
    }
    return { start, end: { x: t.x, y: t.y } };
  })()`);
  console.log('[8/9] walked 100 m: ' + JSON.stringify(walk));

  await key('KeyM', 'm'); // reopen - stepMapCard's updatePose() calls the chart's refreshFog(), rebuilding the drawn mask from the fog's new revision
  opened = false;
  for (let i = 0; i < 20; i++) { await pause(100); if (await evaluate(cdp, 'window.__debug.isMapOpen()')) { opened = true; break; } }
  assert.ok(opened, 'M did not reopen the chart after the walk');
  await pause(200); // a couple of stepMapCard ticks so updatePose/refreshFog runs at least once
  const after = await evaluate(cdp, `(()=>{const v=window.__debug.getMapChart(),f=v.fog,t=window.__debug.playerHandle.data.transform;
    return {endExplored:f.isExplored(t.x,t.y),farExplored:f.isExplored(${before.farPoint.x},${before.farPoint.y}),
    routeCount:f.routeCount,codes:Array.from(new Set(v.art.codes)),saveField:window.__debug.world.state['ui.mapFog'].length};})()`);
  assert.equal(after.endExplored, true, "the player's own final cell is unexplored after walking there: " + JSON.stringify(after));
  assert.equal(after.farExplored, false, '300 m-away witness point got explored by a 100 m walk - fog growth is not localized: ' + JSON.stringify(after));
  assert.ok(after.routeCount >= before.routeCount, 'route did not grow: ' + JSON.stringify({ before, after }));
  assert.ok(after.codes.includes(32), 'no blank-paper cells left - the walk explored the WHOLE chart, expected the rest to stay blank: ' + JSON.stringify(after));
  assert.ok(after.codes.includes(42) || after.codes.includes(94) || after.codes.includes(62) || after.codes.includes(118) || after.codes.includes(60),
    'no pencil route (42) or player arrow glyph visible over the newly-explored area: ' + JSON.stringify(after));
  await shot('map-fog-walk-' + backend);
  console.log('[9/9] explored area grew to the 100 m target, rest stays blank paper: ' + JSON.stringify(after));

  closed = false;
  for (let attempt = 0; attempt < 3 && !closed; attempt++) {
    await key('Escape');
    for (let i = 0; i < 20; i++) { await pause(100); if (await evaluate(cdp, 'window.__debug.isMapOpen() === false')) { closed = true; break; } }
  }
  if (!closed) console.warn('[diag] panel state: ' + await evaluate(cdp, "JSON.stringify({state:window.__debug.getMapPanel().state})") + ' errors: ' + JSON.stringify(errors));
  assert.ok(closed, 'Esc did not close the chart after the walk (3 attempts)');

  assert.deepEqual(errors, [], 'console exceptions: ' + JSON.stringify(errors));
  console.log(JSON.stringify({ backend, info, chartCodes: chart.codes.length, pos, fogBefore: before, fogAfter: { ...after, codes: undefined } }));
  console.log('Map wire (S8-B1-15/S8-B1-16): baked chart + markers loaded, M opens/Esc closes, arrow drawn, 100 m walk grows the saved fog mask while the rest stays blank paper, real-GPU PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300); // Windows: the just-killed browser can hold the profile dir open for a moment
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
