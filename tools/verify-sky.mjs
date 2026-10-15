// NIGHT-SKY-01 / CLOUD-FLUFF-01 stills: live clock (NO ?pose/?at, those freeze liveLook), then a dev-hook teleport (like verify-ob175.mjs).
// Run: HOURS=23 node tools/verify-sky.mjs 9725 [suffix]  -> docs/test-reports/{night-sky-23h|clouds-HH}<suffix>.png (PC-B ports 9500-9999, CDP = port+1)
// Env: SPOT="1460,1030,12,235,25" (x,y,z,yawDeg,pitchDeg) HOURS=6,12,19
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';
const port = Number(process.argv[2] || 9725), suffix = process.argv[3] || ''; validatePort(port);
const hours = (process.env.HOURS || '23').split(',').map(Number);
const [sx, sy, sz, syaw, spitch] = (process.env.SPOT || '1460,1030,12,235,22').split(',').map(Number);
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-sky-'));
const server = spawn("python", ["-c", "import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=[\"tools/serve.py\",sys.argv[1]]; import tools.serve; tools.serve.main()", String(port)], { cwd: ROOT, stdio: "ignore", windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
const killer = setTimeout(() => { console.error('verify-sky timeout'); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid); process.exit(2); }, 260000);
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({ backend: 'webgpu', swiftshader: process.env.SWIFT === '1' }), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  cdp.onEvent((m, p) => { if (m === 'Runtime.consoleAPICalled' && true) console.log('console', p.type, (p.args||[]).map(a=>a.value??a.description??'').join(' ').slice(0,300)); });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (const h of hours) {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?save=0&nopause=1&quality=${process.env.Q||'high'}&backend=webgpu&title=0${process.env.EXTRA || ""}&time=${h}` });
    let ok = false;
    for (let i = 0; i < 600 && !ok; i++) { await pause(300); try { ok = !!(await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.world) && !/Checking your graphics/.test(document.body.innerText||"")')); } catch { /* navigating */ } }
    if (!ok) throw new Error("never ready " + JSON.stringify(await evaluateAsync(cdp, "(async()=>{const a=navigator.gpu&&await navigator.gpu.requestAdapter();return 'adapter='+(a?'ok':String(a))+' '+document.body.innerText.slice(150,700)})()").catch(e=>String(e))));
    await pause(5000);
    await evaluate(cdp, `(()=>{const t=__debug.playerHandle.data.transform;t.x=${sx};t.y=${sy};const w=__debug.world;t.z=(w.terrain&&w.terrain.heightAt?w.terrain.heightAt(${sx},${sy})+0.2:${sz});t.yawDeg=${syaw};t.pitchDeg=${spitch};})()`);
    await pause(9000);
    const info = await evaluate(cdp, `(()=>{const L=__debug.world.palette&&__debug.world.palette.liveLook;return JSON.stringify({sunI:L&&L.sunI,ambientI:L&&L.ambientI,hasClouds:!!(L&&L.clouds)})})()`);
    console.log('hour', h, info);
    if (process.env.PRE) { console.log('PRE', await evaluate(cdp, process.env.PRE)); await pause(1500); } // optional page-side probe/tweak before the still
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const name = h === 23 ? 'night-sky-23h' : 'clouds-' + String(h).padStart(2, '0');
    writeFileSync(process.env.OUT || path.join(ROOT, 'docs/test-reports', name + suffix + '.png'), Buffer.from(s.data, 'base64'));
  }
} finally {
  clearTimeout(killer); cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}
