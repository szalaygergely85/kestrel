// PARTICLE-UPLOAD-03: verify the cropped particle-layer upload (passSprites.cropColumns) renders the same cells as the
// row-band upload. Run: node tools/verify-particles.mjs 9740 [webgpu]   (PC-B ports 9500-9999; port+1 = CDP)
// webgpu: spark bursts in front of the camera, sim frozen (look.locked=false -> pause) so frames are static, then reads
// wgPipeline._spritesPass.readbackCells() with cropColumns on / off / on and asserts the particle cells are identical.
// Prints one JSON line; exit 1 on mismatch.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

/** Indices (cell) where a differs from b (rgba8 buffers, 4 bytes per cell). */
export function diffCells(a, b) {
  const out = []; const n = Math.min(a.length, b.length) >> 2;
  for (let i = 0; i < n; i++) { const o = i * 4; if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2] || a[o + 3] !== b[o + 3]) out.push(i); }
  return out;
}
/** Cells where `withP` differs from `base` in fg or bg = the particle cells. */
export function particleCells(baseFg, baseBg, fg, bg) { return [...new Set([...diffCells(baseFg, fg), ...diffCells(baseBg, bg)])].sort((x, y) => x - y); }

async function main() {
  const port = Number(process.argv[2] || 9740); validatePort(port);
  if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
  const backend = process.argv[3] || 'webgpu';
  if (!['webgpu'].includes(backend)) throw new Error('backend must be webgpu');
  const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-verify-particles-'));
  const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  let browser, cdp, failed = false;
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
    browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({ backend, swiftshader: !!process.env.SWIFTSHADER }), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    cdp = await connectCdp(port + 1, 15000);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=${backend}&pose=${process.env.POSE || 'roadSouth'}` });
    let ready = false;
    for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!window.__kestrel')) { ready = true; break; } }
    if (!ready) throw new Error('game did not boot');
    await evaluate(cdp, 'window.__pin = setInterval(() => { if (window.__debug.look) window.__debug.look.locked = true; }, 30), true');
    await pause(2500);
    const sp = 'window.__debug.wgPipeline._spritesPass';
    const ok = await evaluate(cdp, `!!(window.__debug.wgPipeline && ${sp} && ${sp}.cropColumns !== undefined)`);
    if (!ok) throw new Error('wgPipeline._spritesPass missing; rt.backend=' + await evaluate(cdp, 'String(window.__debug.rt && window.__debug.rt.backend)') + ' (webgpu not active in this browser? try SWIFTSHADER=1)');
    // freeze: stop pinning, unlock -> sim pauses (frames keep presenting the same state)
    await evaluate(cdp, 'clearInterval(window.__pin); window.__debug.look.locked = false; true');
    await pause(800);
    const read = async (crop) => evaluate(cdp, `(async () => { const s = ${sp}; s.cropColumns = ${crop}; const b0 = s.stats.partBytes; await new Promise(r => setTimeout(r, 600));
      const r = await s.readbackCells(); return { fg: Array.from(r.fg), bg: Array.from(r.bg), bytes: s.stats.partBytes - b0 }; })()`);
    const base = await read(true);
    // bursts: a few points in front of the camera, then freeze again by not stepping (paused sim keeps them alive)
    await evaluate(cdp, `(() => { const d = window.__debug, p = d.engine.particles, id = p.defIdOf('sparks'), t = d.playerHandle.data.transform; d.look.locked = true;
      for (const [dx, dz] of [[2, 3], [-3, 5], [0, 6]]) p.burstAt(id, t.x + dx, t.y + 1.2, t.z + dz, 40, 0, 1, 0); return id; })()`);
    await pause(150); await evaluate(cdp, 'window.__debug.look.locked = false; true'); await pause(500);
    const on1 = await read(true), off = await read(false), on2 = await read(true);
    const cells = (x) => particleCells(Uint8Array.from(base.fg), Uint8Array.from(base.bg), Uint8Array.from(x.fg), Uint8Array.from(x.bg));
    const same = (a, b) => diffCells(Uint8Array.from(a.fg), Uint8Array.from(b.fg)).length + diffCells(Uint8Array.from(a.bg), Uint8Array.from(b.bg)).length;
    const res = { backend, particleCells: cells(on1).length, mismatchCropVsBand: same(on1, off), mismatchCropRepeat: same(on1, on2),
      partBytesCrop: on1.bytes, partBytesBand: off.bytes };
    res.pass = res.particleCells > 0 && res.mismatchCropVsBand === 0 && res.mismatchCropRepeat === 0;
    console.log(JSON.stringify(res)); failed = !res.pass;
  } catch (e) { console.log(JSON.stringify({ error: String(e.message || e) })); failed = true; }
  finally {
    cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
    await pause(300); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) { /* best effort */ }
  }
  if (failed) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
