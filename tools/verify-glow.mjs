// Glow pass debug: node tools/verify-glow.mjs <port 9575-9649> [query] [seconds]
// Loads game/index.html?<query>, prints console + exceptions + GPUDevice uncapturederror, and whether __gpuCompare appears.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';
const port = Number(process.argv[2] || 9575); validatePort(port);
const query = process.argv[3] || 'gpucompare=emissive&backend=webgpu';
const secs = Number(process.argv[4] || 60);
const shot = process.argv[5]; // optional PNG path: screenshot after the result appears
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-glow-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const ra = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async (...a) => { const ad = await ra(...a); const rd = ad.requestDevice.bind(ad);
      ad.requestDevice = async (...b) => { const d = await rd(...b); d.addEventListener('uncapturederror', (e) => console.error('[UNCAPTURED] ' + e.error.message)); window.__dev = d; return d; }; return ad; };` });
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') console.log('[exception]', JSON.stringify(p.exceptionDetails).slice(0, 900));
    if (m === 'Runtime.consoleAPICalled') console.log('[console.' + p.type + ']', (p.args || []).map((a) => a.value !== undefined ? String(a.value) : a.description || '').join(' ').slice(0, 1500));
    if (m === 'Log.entryAdded') console.log('[log.' + p.entry.level + ']', p.entry.text.slice(0, 1500));
  });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${query}` });
  for (let i = 0; i < secs * 3; i++) {
    await pause(333);
    if (await evaluate(cdp, 'typeof window.__gpuCompare !== "undefined"')) { console.log('__gpuCompare:', JSON.stringify(await evaluate(cdp, 'window.__gpuCompare')).slice(0, 3000)); break; }
  }
  if (shot) { await pause(1500); const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); (await import('node:fs')).writeFileSync(shot, Buffer.from(data, 'base64')); console.log('shot', shot); }
  console.log('glowRan', await evaluate(cdp, 'window.__debug&&window.__debug.wgPipeline&&JSON.stringify([window.__debug.wgPipeline._glowRan, window.__debug.wgPipeline.glowOpt])')); console.log('done; backend=', await evaluate(cdp, 'window.__debug&&window.__debug.rt&&window.__debug.rt.backend'));
} finally { if (browser) killTree(browser.pid); killTree(server.pid); process.exit(0); }
