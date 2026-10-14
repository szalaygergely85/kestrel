// ENV-02d part 3 (38.63 flicker gate): walks the camera along a fixed path across a biome edge (default: the lookForestEdge pose area) and counts
// ground-look flicker = sample points whose look byte flips A -> B -> A over three consecutive frames. Sample points are a fixed eye-relative
// fan (24 azimuths x 7 ground distances) so texels cross the sample points as the eye moves; the bytes come from the baked near/far look arrays
// (the same texel the shade pass reads). PASS = flicker share <= MAX_PCT (default 0.5 %) and the path really crossed >= 1 look change.
// Run: node tools/verify-look-flicker.mjs <port> [webgpu] [--at x,y] [--dir dx,dy] [--steps n] [--max pct]   (PC-B ports 9500-9999; port+1 = CDP). Needs the main.js groundLook wiring (`?look` unset = on).
// Reads window.__debug.world.terrain (near.look / farLook, mapX0.. as Terrain) and sets __debug.playerHandle.data.transform.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const args = process.argv.slice(2);
const port = Number(args[0] || 9575); validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const backend = args[1] && !args[1].startsWith('--') ? args[1] : 'webgpu';
const [ax, ay] = opt('--at', '1040,1068').split(',').map(Number), [dx, dy] = opt('--dir', '-1,0').split(',').map(Number);
const STEPS = Number(opt('--steps', 400)), MAX_PCT = Number(opt('--max', 0.5)), STEP_M = 0.1;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-lookflicker-'));
let browser, cdp, failed = false;
// page-side walk: one frame per step (rAF), sample look bytes at the fan, return counts
const WALK = `(async () => {
  const d = window.__debug, tr = d.playerHandle.data.transform, T = d.world.terrain;
  if (!T || !T.groundLook) return { error: 'groundLook off (terrain.groundLook null)' };
  const lookAt = (x, y) => { const g = T.nearReady ? T.near : null;
    if (g && g.look) { const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((y - g.y0) / g.cell); if (i >= 0 && j >= 0 && i < g.w && j < g.h) { const k = (i + j * g.w) * 2; return g.look[k] | g.look[k + 1] << 8; } }
    const L = T.farLook; if (!L) return 0; const i = Math.floor((x - T.mapX0) / T.mapCell), j = Math.floor((y - T.mapY0) / T.mapCell);
    if (i < 0 || j < 0 || i >= T.mapW || j >= T.mapH) return 0; const k = (j * T.mapW + i) * 2; return L[k] | L[k + 1] << 8; };
  const AZ = 24, DIST = [3, 6, 10, 16, 25, 40, 60], n = AZ * DIST.length, fwd = Math.atan2(${dy}, ${dx});
  const frames = [new Int32Array(n), new Int32Array(n), new Int32Array(n)]; let flips = 0, samples = 0, changes = 0, f = 0;
  for (let s = 0; s < ${STEPS}; s++) {
    tr.x = ${ax} + ${dx} * s * ${STEP_M}; tr.y = ${ay} + ${dy} * s * ${STEP_M};
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cur = frames[f % 3], p1 = frames[(f + 2) % 3], p2 = frames[(f + 1) % 3];
    let k = 0; for (let a = 0; a < AZ; a++) { const th = fwd + (a / (AZ - 1) - 0.5) * 1.2; for (const r of DIST) { cur[k++] = lookAt(tr.x + Math.cos(th) * r, tr.y + Math.sin(th) * r); } }
    if (f >= 2) for (let i = 0; i < n; i++) { samples++; if (cur[i] !== p1[i]) changes++; if (cur[i] === p2[i] && cur[i] !== p1[i]) flips++; }
    f++;
  }
  return { flips, samples, changes };
})()`;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({ backend }), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=${backend}&at=${ax},${ay},0,270,-12` });
  let ready = false;
  // ENV-GATEFIX: ready = world + player + look (as verify-wmp05); terrain.nearReady is a soft wait (WALK falls back to farLook)
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.look && window.__debug.world)')) { ready = true; break; } }
  if (ready) for (let i = 0; i < 100; i++) { if (await evaluate(cdp, '!!(window.__debug.world.terrain && window.__debug.world.terrain.nearReady)')) break; await pause(300); }
  if (ready) console.log('terrain', await evaluate(cdp, 'JSON.stringify({t: !!window.__debug.world.terrain, near: !!(window.__debug.world.terrain && window.__debug.world.terrain.nearReady), gl: !!(window.__debug.world.terrain && window.__debug.world.terrain.groundLook)})'));
  if (!ready) throw new Error('boot failed or terrain not ready');
  await evaluate(cdp, 'window.__debug.look.locked = true'); await pause(2000);
  const r = JSON.parse(await evaluateAsync(cdp, `${WALK}.then(JSON.stringify)`));
  if (r.error) throw new Error(r.error);
  const pct = 100 * r.flips / r.samples;
  console.log(JSON.stringify(r), `flicker ${pct.toFixed(3)} % (max ${MAX_PCT} %)`);
  if (r.changes < 1) { failed = true; console.log('FAIL look-flicker: path crossed no look change (move --at/--dir to a biome edge)'); }
  else if (pct > MAX_PCT) { failed = true; console.log(`FAIL look-flicker ${pct.toFixed(3)} % > ${MAX_PCT} %`); }
  else console.log('PASS look-flicker');
} catch (e) { failed = true; console.log('FAIL look-flicker: ' + (e && e.message)); }
finally { try { if (browser) killTree(browser.pid); } catch {} try { killTree(server.pid); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} }
process.exit(failed ? 1 : 0);
