// SPELL-07b stills: Gust streaks + Fire Ring burst, cast in-page. Run: node tools/verify-spells-fx.mjs <port> [suffix] -> docs/test-reports/spell-gust<suffix>.png, spell-ring<suffix>.png (PC-B ports 9500-9999, CDP = port+1)
// Env: SPOT="x,y,z,yawDeg,pitchDeg" HOURS=12. Needs fireball/gust unlocked: uses ?save=0 and sets the spell book tiers via __debug when present.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';
const port = Number(process.argv[2] || 9726), suffix = process.argv[3] || ''; validatePort(port);
const hour = Number(process.env.HOURS || 12);
const [sx, sy, sz, syaw, spitch] = (process.env.SPOT || '1440,1004,12,200,5').split(',').map(Number);
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-spellfx-'));
const server = spawn("python", ["-c", "import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=[\"tools/serve.py\",sys.argv[1]]; import tools.serve; tools.serve.main()", String(port)], { cwd: ROOT, stdio: "ignore", windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
const killer = setTimeout(() => { console.error('verify-spells-fx timeout'); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid); process.exit(2); }, 260000);
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({ backend: 'webgpu', swiftshader: process.env.SWIFT === '1' }), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?save=0&nopause=1&quality=medium&backend=webgpu&title=0&time=${hour}` });
  let ok = false;
  for (let i = 0; i < 600 && !ok; i++) { await pause(300); try { ok = !!(await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.world)')); } catch { /* navigating */ } }
  if (!ok) throw new Error('never ready');
  await pause(5000);
  await evaluate(cdp, `(()=>{const t=__debug.playerHandle.data.transform;t.x=${sx};t.y=${sy};t.z=${sz};t.yawDeg=${syaw};t.pitchDeg=${spitch};})()`);
  await pause(4000);
  // cast through the quickbar dispatcher exposed for debug (__debug.castSpell(id)); falls back to a synthetic gust:cast / fireball:burst event
  const cast = (id) => evaluate(cdp, `(()=>{const d=window.__debug; if (d.castSpell) return d.castSpell(${JSON.stringify(id)}); const t=d.playerHandle.data.transform, e=d.engine&&d.engine.events; if(!e) return 'no-events'; const a=t.yawDeg*Math.PI/180; if(${JSON.stringify(id)}==='gust') e.emit('gust:cast',{x:t.x,y:t.y,z:t.z+1.2,fx:-Math.sin(a),fy:Math.cos(a),range:6}); else e.emit('fireball:burst',{x:t.x,y:t.y,z:t.z+0.9,radius:3,charged:false,ring:true}); return 'event'; })()`);
  console.log('gust', await cast('gust')); await pause(150);
  writeFileSync(path.join(ROOT, 'docs/test-reports', 'spell-gust' + suffix + '.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await pause(1500);
  console.log('ring', await cast('fireRing')); await pause(120);
  writeFileSync(path.join(ROOT, 'docs/test-reports', 'spell-ring' + suffix + '.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
} finally {
  clearTimeout(killer); cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}
