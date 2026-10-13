// LIFE-04: Outwall villagers at 10:00 (present, walking) and 23:00 (asleep, hidden). Stills + asserts. node tools/verify-outwall-life.mjs 9600
// (adapted from verify-chest-hook.mjs; real-GPU owner-look capture of the chest hook (interact -> open clip -> item granted -> item-get
// card), via game/js/chestHook.preview.html. Same CDP approach as tools/verify-item-card.mjs (lane C), reusing
// capture-browser.mjs's exported helpers - PC-B port range only (9500-9999).
// Run: node tools/verify-chest-hook.mjs 9500 (webgpu, default)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9600);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-outwall-life-'));
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

  async function visit(hour, tag) {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?backend=${backend}&pose=outwall&time=${hour}&save=1&title=0` });
    let st = null;
    for (let i = 0; i < 200; i++) {
      await pause(300);
      st = await evaluate(cdp, '(()=>{const o=window.__debug&&window.__debug.outLife;return o?{n:o.villagers.n,hidden:o.villagers.actors.map(a=>a.hidden),ids:o.villagers.actors.map(a=>a.id),anim:o.villagers.actors.map(a=>a.anim)}:null;})()');
      if (st) break;
    }
    assert.ok(st, 'outLife never appeared ' + JSON.stringify(errors));
    await pause(1500);
    await shot(`outwall-life-${tag}-${backend}`);
    return await evaluate(cdp, '(()=>{const o=window.__debug.outLife;return {ids:o.villagers.actors.map(a=>a.id),hidden:o.villagers.actors.map(a=>a.hidden),anim:o.villagers.actors.map(a=>a.anim)};})()');
  }
  const day = await visit(10, 'day10');
  assert.ok(day.hidden.some((h) => !h), 'present by day: ' + JSON.stringify(day));
  const night = await visit(23, 'night23');
  assert.ok(night.hidden.every((h) => h), 'all asleep (hidden) at 23:00: ' + JSON.stringify(night));
  console.log(JSON.stringify({ day, night }));
  assert.deepEqual(errors, []);
  console.log('Outwall life: villagers present at 10:00, hidden at 23:00 PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300); // Windows: the just-killed browser can hold the profile dir open for a moment
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
