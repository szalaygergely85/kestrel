// POINTSHADOW-WIRE-01: point-shadow check next to the tower stairLamp, with vs without ?pointshadows=4. Same CDP approach as tools/verify-chest-hook.mjs, reusing capture-browser.mjs's
// exported helpers - PC-B port range only (9500-9574). Starts its own server, kills only
// the processes it spawned, screenshots into docs/test-reports/captures/.
// Run: node tools/verify-pointshadows.mjs 9500 (webgpu, default)
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-verify-pointshadows-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [], warns = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); if (m === 'Runtime.consoleAPICalled' && p.type === 'warning') warns.push(p.args.map((a) => a.description || a.value).join(' ').slice(0, 500)); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  async function shot(name) { await pause(350); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, name + '.png'), Buffer.from(s.data, 'base64')); }

  const AT = process.env.AT || '16,3.4,0,90,0'; // next to props.stairLamp (14.28, 3.4, 1.52); override with AT=x,y,z,yaw,pitch
  const res = {};
  for (const mode of ['off', 'on']) {
    const ps = mode === 'on' ? '&pointshadows=4&quality=high' : '&quality=high&pointshadows=0';
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`dev=1&title=0&backend=${backend}&at=${AT}${ps}`)}` });
    let ready = false;
    for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!window.__kestrel && !!window.__debug')) { ready = true; break; } }
    assert.ok(ready, JSON.stringify(errors));
    await evaluate(cdp, 'setInterval(() => { if (window.__debug.look) window.__debug.look.locked = true; }, 30), true');
    await pause(3000);
    res[mode] = await evaluate(cdp, `(() => { const p = window.__debug.wgPipeline; const pp = p && p._pointShadowPass; return { pass: !!pp, stats: pp ? pp.stats : null, renders: pp ? pp.renders : 0, faces: pp ? pp.facesRendered : 0, culledOccl: p && p.stats ? p.stats.culledOccl : null }; })()`);
    await shot('pointshadows-' + mode + '-' + backend);
  }
  console.log(JSON.stringify({ res, warns: warns.slice(0, 4) }));
  if (backend === 'webgpu') { assert.equal(res.off.pass, false, 'off: no pass'); assert.ok(res.on.pass, 'on: pass exists'); }
  console.log(JSON.stringify({ backend, errors: errors.map((e) => (e.exception && e.exception.description || e.text).slice(0, 400)) }));
  assert.deepEqual(errors, []);
  console.log('Point shadows: captures saved for backend', backend, '- eyeball the screenshot for sunbeam placement/density');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300); // Windows: the just-killed browser can hold the profile dir open for a moment
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
