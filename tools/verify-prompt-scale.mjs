#!/usr/bin/env node
// tools/verify-prompt-scale.mjs {port}  (OB-051b, docs/architecture.md 38.48)
// Boots the game headless, waits for an interaction prompt and asserts the
// prompt row cells of the UI layer carry bit 7 (2x scaled) with an even origin
// and width 2*len. Saves docs/test-reports/ob051/prompt.png. Own server on {port}
// (9500-9999), stops only itself. NOTE: needs game/js/main.js uiStyle.prompt.scale = 2.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || process.env.PORT);
validatePort(port);
if (port + 1 > 9999) throw new Error('CDP port is port+1');
const root = ROOT;
const out = path.join(root, 'docs/test-reports/ob051');
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-pscale-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: root, stdio: 'ignore', windowsHide: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, code = 1;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 150; i++) { await sleep(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.getUi)')) { ready = true; break; } }
  assert.ok(ready, 'world never loaded');
  // Headless sim does not run: stand 1.2 m from the nearest prompt-bearing interactable, then fill world.interaction through the real findInteractTarget.
  const aim = `(async () => { const { findInteractTarget } = await import('/engine/index.js');
    const w = window.__debug.world, t = window.__debug.playerHandle.data.transform;
    const list = w.interactables.filter((r) => r.prompt); if (!list.length) return 'none';
    const d2 = (r) => (r.x - t.x) ** 2 + (r.y - t.y) ** 2; list.sort((a, b) => d2(a) - d2(b)); const g = list[0];
    const ang = Math.atan2(g.x - t.x, -(g.y - t.y)) * 180 / Math.PI;
    t.x = g.x - 1.2 * Math.sin(ang * Math.PI / 180); t.y = g.y + 1.2 * Math.cos(ang * Math.PI / 180); t.yawDeg = ang;
    window.__aim = { x: t.x, y: t.y, z: g.z + 0.9, yawDeg: ang, pitchDeg: -10 };
    window.__fi = () => { findInteractTarget(w, window.__aim, null, w.interaction); return w.interaction.targetKey; };
    window.__debug.look.locked = true; // headless has no pointer lock; pauseUp() would otherwise cover the HUD
    const L = window.__debug.look; L.yawDeg = ang; L.pitchDeg = -15; // the sim runs headless: aim the real camera, the real updateInteraction does the rest
    return g.key + '|' + g.prompt; })()`;
  console.log('aim', await evaluateAsync(cdp, aim));
  const evalJs = (expr) => evaluate(cdp, expr);
  // Page hook: __debug.getUi() (UiLayer) - the debug handle main.js exposes; adapt here if renamed.
  const probe = `(() => { const d = window.__debug; const ui = d && d.getUi && d.getUi(); if (!ui) return null;
    const c = ui.cells, W = ui.cols, H = ui.rows; let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, flagged = 0, opaque = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!c.mask[i] || c.bg[i * 4 + 3] !== 255) continue; opaque++;
      if (c.fg[i * 4 + 3] & 128) { flagged++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } }
    return { flagged, opaque, minX, maxX, minY, maxY }; })()`;
  let res = null;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    await evalJs('window.__fi && window.__fi()');
    res = await evalJs(probe);
    if (res && res.flagged > 0) break;
  }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  if (shot.data) writeFileSync(path.join(out, 'prompt.png'), Buffer.from(shot.data, 'base64'));
  console.log('probe', JSON.stringify(res));
  const okAll = res && res.flagged > 0 && res.flagged === (res.maxX - res.minX + 1) * (res.maxY - res.minY + 1) && res.minX % 2 === 0 && res.minY % 2 === 0
    && (res.maxX - res.minX + 1) % 2 === 0 && res.maxY - res.minY === 1;
  console.log(okAll ? 'PASS prompt carries 2x bit, even origin, 2 rows' : 'FAIL (no prompt in reach, scale not 2 in main.js, or __debug.getUi missing)');
  code = okAll ? 0 : 1;
} catch (e) { console.error('ERROR', e.message); }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await sleep(300); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}
process.exit(code);
