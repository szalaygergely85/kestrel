// OB-209 (far silhouette) regression gate: real game (WebGPU, live clock, NO ?at/?pose), teleport to the start-meadow road
// looking at the far hills, still per hour, then tools/farSilhouette.mjs measures the far band against the sky above and the
// terrain below. Exit 1 when the far band has pale cut-out or navy blob pixels over the limits.
// Run: node tools/verify-far-silhouette.mjs 9650 [tag]   (PC-B ports; CDP = port+1)
// Env: AB=gi (OB-222 GI on/off pair)  AB=farforest (OB-222 candidate: ?farforest=0 vs =1, tags -ff0/-ff1)  CLOCKS=12,19,22  SPOT="1466,1035,12,240" (x,y,z,yawDeg)  EXTRA="imp=0" (extra query)  PROBE="<js expr>"  NOGATE=1
// VISQA-02 case `high` (burl-home view north, pitch 4, HIGH_CLOCKS=9,13): far mountains up to ~15 deg above the horizon must not be one
// flat fill far from the sky right above their ridge (before: flat cream vs blue sky). CASES=meadow,high (default both).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { snapEnv } from '../game/js/dev/bugSnapshot.js';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';
import { luma, bandMean, measureFarBand, measureRidge, farGateFails } from './farSilhouette.mjs';

// REPORT-KEY-01: SNAP="<F8 report line>" replays the owner's view (pose, clock, quality, size, flags); runs the meadow case only.
const SNAP = snapEnv(process.env.SNAP); if (SNAP) Object.assign(process.env, { SPOT: SNAP.SPOT, CLOCKS: SNAP.CLOCKS, CASES: 'meadow', EXTRA: SNAP.EXTRA, NOGATE: process.env.NOGATE || '1' });
const port = Number(process.argv[2] || 9650); validatePort(port);
const tag = process.argv[3] || 'now';
const clocks = (process.env.CLOCKS || '12,19,22').split(',');
const [sx, sy, sz, syaw] = (process.env.SPOT || '1466,1035,12,240').split(',').map(Number);
const CASES = [
  { name: 'meadow', x: sx, y: sy, z: sz, yaw: syaw, pitch: SNAP ? SNAP.pitch : 0, clocks, fn: 'measureFarBand', opts: {} },
  { name: 'high', x: 1404, y: 1019, z: 12, yaw: 0, pitch: 4, clocks: (process.env.HIGH_CLOCKS || '9,13').split(','), fn: 'measureRidge', opts: {} } // before (VISQA-01 stills): 09 43.0, 13 61.0 FAIL; 22 16.0,
].filter((c) => !process.env.CASES || process.env.CASES.split(',').includes(c.name));
const extra = process.env.EXTRA ? '&' + process.env.EXTRA : '';
// OB-222 A/B: AB=gi runs every case twice, GI on (tag <tag>-gion) and ?gi=0 (tag <tag>-gi0); compare the two rows / stills.
const VARIANTS = process.env.AB === 'farforest' ? [[tag + '-ff0', extra + '&farforest=0'], [tag + '-ff1', extra + '&farforest=1']] : process.env.AB === 'gi' ? [[tag + '-gion', extra], [tag + '-gi0', extra + '&gi=0']] : [[tag, extra]];
const out = path.join(ROOT, 'docs/test-reports');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob209-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const MEASURE_SRC = `const luma=${luma.toString()};${bandMean.toString()};${measureFarBand.toString()};${measureRidge.toString()};`;
let browser, cdp, fail = false;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: Number(SNAP ? SNAP.W : 1000), height: Number(SNAP ? SNAP.H : 700), deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const rows = [];
  for (const [vTag, vExtra] of VARIANTS) for (const C of CASES) for (const clock of C.clocks) {
    console.log('case', C.name, 'clock', clock, 'variant', vTag);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?save=0&dev=1&title=0&nopause=1&backend=webgpu&quality=${SNAP && SNAP.QUALITY ? SNAP.QUALITY : 'high'}&time=${clock}${vExtra}` });
    let ok = false;
    for (let i = 0; i < 400 && !ok; i++) { await pause(300); try { ok = !!(await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.world)')); } catch { /* navigating */ } }
    if (!ok) throw new Error('world never became ready');
    await pause(9000);
    await evaluate(cdp, `(()=>{const t=__debug.playerHandle.data.transform;t.x=${C.x};t.y=${C.y};if(__debug.vitals&&__debug.vitals.setGodMode)__debug.vitals.setGodMode(true);const T=__debug.world.terrain,gz=(T.groundAt||T.heightAt).call(T,${C.x},${C.y});t.z=(gz==null?${C.z}:gz+0.2);t.yawDeg=${C.yaw};t.pitchDeg=${C.pitch};const L=__debug.look;if(L){L.yawDeg=${C.yaw};L.pitchDeg=${C.pitch};}})()`); // god mode + ground snap (no fall death fade)
    await pause(10000); // far bands stream in + fall settles
    if (process.env.PROBE) console.log(clock, 'PROBE', JSON.stringify(await evaluateAsync(cdp, process.env.PROBE)));
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(out, C.name === 'meadow' ? `ob209-far-${vTag}-${clock}.png` : `visqa/fix-02-${C.name}-${vTag}-${clock}.png`); writeFileSync(file, Buffer.from(s.data, 'base64'));
    const png = readFileSync(file).toString('base64');
    const m = await evaluateAsync(cdp, `(async()=>{${MEASURE_SRC}const im=new Image();im.src='data:image/png;base64,${png}';await im.decode();const c=new OffscreenCanvas(im.width,im.height);const x=c.getContext('2d');x.drawImage(im,0,0);const d=x.getImageData(0,0,im.width,im.height).data;return ${C.fn}(d,im.width,im.height,${JSON.stringify(C.opts)});})()`);
    const bad = farGateFails(m); fail = fail || bad;
    rows.push({ variant: vTag, case: C.name, clock, shapes: m.shapes, worstDist: +m.worstDist.toFixed(1), gate: bad ? 'FAIL' : 'ok', worst: JSON.stringify(m.worst.slice(0, 2)) });
  }
  console.table(rows);
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp profile left */ }
}
if (fail && !process.env.NOGATE) { console.log('OB-209 far-silhouette gate: FAIL'); process.exit(1); }
console.log('OB-209 far-silhouette gate:', fail ? 'FAIL (NOGATE)' : 'PASS');
