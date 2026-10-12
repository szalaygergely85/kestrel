// TUFT-01b / 38.52 budget: GPU frame ms with the grass carpet on minus off at one grass pose (frame timer, pass timing off).
// Run: node tools/bench-carpet.mjs <port> [grid=480x180] [x y yaw pitch]   (PC-B 9500-9999; port+1 = CDP). Prints p50 per run + the delta.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9730); validatePort(port);
const grid = process.argv[3] || '480x180';
const [px, py, yaw, pitch] = process.argv.length > 7 ? process.argv.slice(4, 8).map(Number) : [1470, 1035, 200, -12];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('python', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-bench-carpet-'));
let browser, cdp;
async function run(carpet) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu&grid=${grid}&carpet=${carpet}` });
  for (let i = 0; i < 300; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.look && window.__debug.wgPipeline && window.__debug.wgPipeline.ready)')) break; }
  const place = `(()=>{const p=__debug.playerHandle.data.transform,w=__debug.world;p.x=${px};p.y=${py};p.z=(w&&w.heightAt?w.heightAt(${px},${py}):0)+0.05;__debug.look.yawDeg=${yaw};__debug.look.pitchDeg=${pitch};return 1;})()`;
  if (process.env.CQ && carpet) await evaluate(cdp, `__debug.world.setCarpetQuality(${process.env.CQ})`); // OB-103a: e.g. CQ='{radiusScale:0.5}'
  await evaluate(cdp, place); await pause(6000);
  const s = [];
  for (let i = 0; i < 10; i++) { await evaluate(cdp, place); await pause(700); s.push(await evaluate(cdp, '__debug.wgPipeline.stats.gpuMsP50')); }
  const ran = await evaluate(cdp, '!!(__debug.wgPipeline._carpetPass && __debug.wgPipeline._carpetPass.ran)');
  s.sort((a, b) => a - b);
  return { carpet, ran, p50: s[s.length >> 1], min: s[0], max: s[s.length - 1] };
}
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({ backend: 'webgpu' }), '--enable-webgpu-developer-features', '--window-size=1920,1080', '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  if (process.env.SEQ) { const o = []; for (const c of process.env.SEQ.split(',')) o.push(await run(Number(c))); console.log(JSON.stringify(o.map((r) => [r.carpet, +r.p50.toFixed(3)]))); } else { // OB-103a: drift probe, e.g. SEQ=0,0,0
  const off1 = await run(0), on = await run(1), off2 = await run(0);
  const off = Math.min(off1.p50, off2.p50);
  console.log(JSON.stringify({ grid, pose: [px, py, yaw, pitch], off1, on, off2 }));
  console.log(`carpet on - off (frame GPU p50): ${(on.p50 - off).toFixed(3)} ms (budget 38.52: <= 0.35 ms Intel iGPU at 480x180)`);
  }
} finally {
  try { cdp && cdp.close && cdp.close(); } catch {}
  if (browser) killTree(browser.pid); killTree(server.pid);
  await pause(500); try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
