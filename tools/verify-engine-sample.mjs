#!/usr/bin/env node
// ENGINE-GUIDE-01: headless check of docs/engine-guide/samples/hello-world.
// Usage: node tools/verify-engine-sample.mjs <port>   (port 9000-9499 on PC-A, 9500-9999 on PC-B; debug port = port + 1)
// Starts its own static server + browser on that port, kills only those two processes.
// Passes when the page boots (window.__helloEngine.ready), logs no console errors/exceptions,
// and the screenshot has more than MIN_CELLS non-blank cells on the 240x90 grid.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { ROOT, validatePort, findBrowserBinary, waitForHttp, killTree, connectCdp, evaluate, evaluateAsync, buildLaunchFlags } from './capture-browser.mjs';

const MIN_CELLS = 500;
const PAGE = '/docs/engine-guide/samples/hello-world/index.html';

const port = Number(process.argv[2]);
try { validatePort(port); } catch (e) { console.error(e.message + ' (usage: node tools/verify-engine-sample.mjs <port>)'); process.exit(2); }
const binary = findBrowserBinary();
if (!binary) { console.error('no Chrome/Edge found (set CHROME_PATH)'); process.exit(2); }

const procs = [];
const cleanup = () => { for (const p of procs) if (p.pid) killTree(p.pid); };
process.once('SIGINT', () => { cleanup(); process.exit(130); });
let code = 1;
try {
  procs.push(spawn('python', ['tools/serve.py', String(port)], { cwd: ROOT, stdio: 'ignore' }));
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  const debugPort = port + 1;
  procs.push(spawn(binary, [`--remote-debugging-port=${debugPort}`, '--headless=new', ...buildLaunchFlags({ backend: 'webgpu' }), '--no-sandbox',
    '--window-size=1280,480', `--user-data-dir=${path.join(os.tmpdir(), 'kestrel-engine-sample-' + port)}`, 'about:blank'], { stdio: 'ignore' }));
  const cdp = await connectCdp(debugPort, 15000);
  const errors = [];
  cdp.onEvent((method, params) => {
    if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.text + ' ' + (params.exceptionDetails.exception?.description || ''));
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') errors.push((params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
  });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}${PAGE}` });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { await new Promise((r) => setTimeout(r, 500)); ready = await evaluate(cdp, 'Boolean(window.__helloEngine && window.__helloEngine.ready)'); }
  await new Promise((r) => setTimeout(r, 1500)); // let a few frames render
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const cells = await evaluateAsync(cdp, `(async () => {
    const img = new Image(); img.src = 'data:image/png;base64,${shot.data}'; await img.decode();
    const c = document.createElement('canvas'); c.width = 240; c.height = 90;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 240, 90);
    const d = g.getImageData(0, 0, 240, 90).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++;
    return n; })()`);
  console.log(`ready=${ready} nonBlankCells=${cells} (need > ${MIN_CELLS}) consoleErrors=${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log('  error: ' + e);
  code = ready && cells > MIN_CELLS && errors.length === 0 ? 0 : 1;
  console.log(code === 0 ? 'PASS' : 'FAIL');
  cdp.close();
} catch (e) { console.error('verify-engine-sample: ' + e.message); code = 1; } finally { cleanup(); }
process.exit(code);
