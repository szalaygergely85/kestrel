// OB-089: still of the real game at ?pose=roadSouth (mid-distance trees + buildings in front of the hills), for the owner look.
// Run: node tools/verify-ob089.mjs 9725  -> docs/test-reports/ob175/ob089-roadSouth.png + ob089-roadSouth-noshadow.png (PC-B port range 9500-9999, CDP = port+1)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob089-'));
const out = path.join(ROOT, 'docs/test-reports/ob175'); mkdirSync(out, { recursive: true });
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
  // OB-089 part 3: wait for the world (poll the same ready flag the other verify scripts use) instead of a blind sleep -> no loading-screen stills
  const READY = '!!(window.__debug && window.__debug.playerHandle && window.__debug.world)';
  async function waitReady() {
    let ok = false;
    for (let i = 0; i < 400 && !ok; i++) { await pause(300); try { ok = !!(await evaluate(cdp, READY)); } catch { /* page still navigating */ } }
    if (!ok) throw new Error('world never became ready (loading screen)');
    await pause(6000); // lazy meshes + streaming cells settle
  }
  async function shot(name) { await pause(350); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, name + '.png'), Buffer.from(s.data, 'base64')); }

  // OB-175 owner-conditions table. Cases: `auto` = NO ?quality (boot probe picks; forced with ?autoquality=1 because navigator.webdriver skips it),
  // then low/medium/high/ultra. Each case: load near the wreck (default spawn, live clock `time=H`, NO ?pose/?at), wait, then teleport in a
  // second step to the owner's spot (transform write, the same dev hook as TELE) so far bands stream like after walking from the wreck.
  // Env: CASES=auto,low,... CLOCK=9 SPOT="1466,1035,12,240" (x,y,z,yawDeg; z = drop height, gravity settles) BAND="0.46,0.58" (screen-height fraction above the horizon)
  const cases = (process.env.CASES || 'auto,low,medium,high,ultra').split(',');
  const clock = process.env.CLOCK || '9';
  const [sx, sy, sz, syaw] = (process.env.SPOT || '1466,1035,12,240').split(',').map(Number);
  const [b0, b1] = (process.env.BAND || '0.46,0.58').split(',').map(Number);
  const rows = [];
  for (const cc of cases) {
    const [c, ...mods] = cc.split(':'); // mods: noshim (no blur/visibility shim), notele (skip step 2), nolock (no fake look.locked), pose (?pose=crash, frozen clock like verify-ob189)
    const qs = c === 'auto' ? 'autoquality=1' : `quality=${c}`;
    const logs = []; const off = cdp.onEvent((m, p) => { if (m === 'Runtime.consoleAPICalled') { const t = (p.args || []).map((a) => a.value ?? '').join(' '); if (/\[quality\]/.test(t)) logs.push(t); else if (process.env.CONSOLE && /warn|error/.test(p.type)) logs.push(p.type + ': ' + t.slice(0, 200)); } });
    // NO-PAUSE: ui/pause.js isPaused() = !look.locked; installAutoPause (blur/hidden) only releases pointer lock and no ?nopause flag exists
    // (main.js:1388 skips it only for bench/gpucompare/cinematic, which change other paths). So fake look.locked=true after load (below) AND
    // neutralise the blur/visibility listeners with Emulation focus + a capture-phase stopImmediatePropagation installed before main.js runs.
    if (!mods.includes('noshim')) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `for (const [t, tgt] of [['blur', window], ['visibilitychange', document]]) tgt.addEventListener(t, (e) => e.stopImmediatePropagation(), true);` });
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu&${mods.includes('pose') ? 'pose=crash' : 'time=' + clock}&${qs}` });
    await waitReady();
    if (!mods.includes('nolock')) await evaluate(cdp, `(()=>{const l=__debug.look; try{Object.defineProperty(l,'locked',{get:()=>true,configurable:true})}catch(e){}})()`); await pause(5000);
    const t0 = await evaluate(cdp, `(()=>{const t=__debug.playerHandle.data.transform;return [t.x,t.y,t.z].map(v=>+v.toFixed(1)).join(',')})()`);
    if (!mods.includes('notele')) await evaluate(cdp, `(()=>{const t=__debug.playerHandle.data.transform;t.x=${sx};t.y=${sy};t.z=${sz};t.yawDeg=${syaw};})()`); await pause(9000); // step 2: far bands stream in
    if (process.env.PROBE) console.log(cc, 'PROBE', JSON.stringify(await evaluateAsync(cdp, process.env.PROBE)));
    const info = await evaluateAsync(cdp, `(async()=>({aq: window.__autoQuality ? {name: window.__autoQuality.name, reason: window.__autoQuality.reason} : null, hour: (document.querySelector('canvas')||{}).width}))()`);
    const name = 'ob175-owner-' + cc.replace(/:/g, '_'); await shot(name);
    const png = readFileSync(path.join(out, name + '.png')).toString('base64');
    // far-tree-line metric: in the band just above the horizon, fraction of pixels near-black navy (luma<25 and b>r)
    const m = await evaluateAsync(cdp, `(async()=>{const im=new Image();im.src='data:image/png;base64,${png}';await im.decode();const c=new OffscreenCanvas(im.width,im.height);const x=c.getContext('2d');x.drawImage(im,0,0);const y0=Math.floor(im.height*${b0}),y1=Math.floor(im.height*${b1});const d=x.getImageData(0,y0,im.width,y1-y0).data;let n=0,k=0;for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2];n++;if(0.2126*r+0.7152*g+0.0722*b<25&&b>r)k++;}return n?k/n:0})()`);
    const picked = logs.join(' | ').match(/auto-pick: (\w+)/);
    rows.push({ case: cc, picked: c === 'auto' ? (info.aq ? info.aq.name : (picked ? picked[1] : 'n/a (probe not finished; see logs)')) : c, spawn: t0, navyFrac: +m.toFixed(4), logs: logs.slice(0, 2) });
  }
  console.table(rows.map(({ logs, ...r }) => r)); console.log(JSON.stringify(rows.map((r) => r.logs)));
  console.log('OB-175 stills saved', JSON.stringify(errors.map((e) => e.text)));
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
