// FIX-PASS: GPU pass stability soak. node tools/verify-pass-stability.mjs <port> [secondsPerScenario=15] [onlyScenario]
// Loads game/index.html on WebGPU with F3 on, walks + turns, runs day/night + runtime grid switches, and fails on ANY
// console.error / uncaught exception / GPUDevice uncapturederror / "[WgCellPipeline] ... failed|disabled" warning /
// "[GpuDeviceWebGPU] stale pass" report. Prints the FIRST such line per scenario (the root cause of a later beginPass crash).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9420); validatePort(port);
const secs = Number(process.argv[3] || 15);
const only = process.argv[4] || '';
const SCENARIOS = [
  { name: 'ultra-meadow', q: 'quality=ultra' },
  { name: 'ultra-night', q: 'quality=ultra&time=23' },
  { name: 'high-dusk', q: 'quality=high&time=19.5' },
  { name: 'extreme', q: 'quality=extreme' },
  { name: 'tower-night', q: 'quality=ultra&pose=towerInterior&time=23' },
  { name: 'brazier-night-f3toggle', q: 'quality=high&pose=brazier&time=22', f3toggle: true },
  { name: 'ultra-grid-switch', q: 'quality=ultra&time=21', grids: [[640, 240], [800, 300], [320, 120], [640, 240]] },
].filter((s) => !only || s.name === only);

const BAD_WARN = /\[WgCellPipeline\].*(failed|disabled)|stale|aborted open pass|left a GPU pass open|\[UNCAPTURED\]/;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('python', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
let browser; let failed = 0;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-passstab-'));
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  const cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const ra = navigator.gpu && navigator.gpu.requestAdapter.bind(navigator.gpu);
    if (ra) navigator.gpu.requestAdapter = async (...a) => { const ad = await ra(...a); if (!ad) return ad; const rd = ad.requestDevice.bind(ad);
      ad.requestDevice = async (...b) => { const d = await rd(...b); d.addEventListener('uncapturederror', (e) => console.error('[UNCAPTURED] ' + e.error.message)); return d; }; return ad; };` });
  let log = [];
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') log.push('[exception] ' + JSON.stringify(p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text).slice(0, 1200));
    if (m === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) {
      const t = (p.args || []).map((a) => a.value !== undefined ? String(a.value) : a.description || '').join(' ').slice(0, 1500);
      if (p.type === 'error' || BAD_WARN.test(t)) log.push(`[console.${p.type}] ${t}`);
    }
  });
  const key = (type, code, k) => cdp.send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) });
  for (const sc of SCENARIOS) {
    log = [];
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?backend=webgpu&f3=1&autoquality=0&${sc.q}` });
    for (let i = 0; i < 90; i++) { await pause(333); if (await evaluate(cdp, '!!(window.__debug && window.__debug.wgPipeline && window.__debug.wgPipeline.frameComplete)')) break; }
    const backend = await evaluate(cdp, 'window.__debug && window.__debug.rt && window.__debug.rt.backend');
    const t0 = Date.now(); let gi = 0;
    while (Date.now() - t0 < secs * 1000) {
      await key('keyDown', 'KeyW', 'w'); await pause(400);
      await key('keyDown', 'KeyD', 'd'); await pause(250); await key('keyUp', 'KeyD', 'd');
      await key('keyUp', 'KeyW', 'w');
      if (sc.f3toggle) { await key('keyDown', 'F3', 'F3'); await key('keyUp', 'F3', 'F3'); }
      await evaluate(cdp, 'try { const l = window.__debug.look; if (l && typeof l.yaw === "number") l.yaw += 0.6; } catch (_) {} 0');
      if (sc.grids && gi < sc.grids.length && Date.now() - t0 > (gi + 1) * (secs * 1000) / (sc.grids.length + 1)) {
        const [c, r] = sc.grids[gi++];
        await evaluate(cdp, `window.__debug && window.__debug.engine.setGrid(${c}, ${r}); 0`);
      }
    }
    await pause(1000);
    const broke = await evaluate(cdp, '/Something broke/.test(document.body.innerText)');
    const grid = await evaluate(cdp, '!window.__debug || !window.__debug.rt ? "no-debug" : window.__debug.rt.cols + "x" + window.__debug.rt.rows + " timer=" + !!(window.__debug.rt.device && window.__debug.rt.device.timer && window.__debug.rt.device.timer.available) + " ready=" + window.__debug.wgPipeline.ready + " pos=" + (window.__debug.playerHandle ? [window.__debug.playerHandle.x, window.__debug.playerHandle.z].map(Math.round) : "?")');
    const bad = broke || log.length > 0; if (bad) failed++;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${sc.name} backend=${backend} grid=${grid} errors=${log.length}${broke ? ' SOMETHING-BROKE' : ''}`);
    for (const l of log.slice(0, 4)) console.log('   ' + l);
  }
} finally { if (browser) killTree(browser.pid); killTree(server.pid); }
console.log(failed ? `FAIL ${failed} scenario(s)` : 'PASS all scenarios');
process.exit(failed ? 1 : 0);
