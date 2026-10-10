// COMPASS-02 (D-061): headless check of the golden pocket compass: visible with a target (needle/distance cells drawn), hidden after setHidden.
// The hide RULES (quest log/menus/dialogue/...) live in update(), which the headless sim does not run: this reports the live flag, the owner walk checks the rest.
// Loads game/index.html?dev=1 (saves on, fresh profile; the marker wires only exist with saves on). The headless sim does not run, so the
// book is driven directly via window.__debug.questBook() and the seam is ticked through window.__debug.gameHooks.tick().
// Run: node tools/verify-compass.mjs <port>   (PC-B lane B1 ports 9500-9574; the CDP port is port+1)
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9520);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-cmp-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [];
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails);
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`dev=1&backend=webgpu`)}` });

  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle)')) { ready = true; break; } }
  assert.ok(ready, 'world never loaded: ' + JSON.stringify(errors));
  console.log('[1/4] world loaded');

  const ev = (js) => evaluate(cdp, js);
  const feed = (e) => ev(`window.__debug.questBook().feed(${JSON.stringify(e)})`);
  for (const e of [{ type: 'flag:set', key: 'wake', value: true }, { type: 'item:got', id: 'lantern' }, { type: 'area:entered', id: 'breach' }, { type: 'item:got', id: 'sword' }]) await feed(e);
  // draw into a fake UI layer: count the cells the compass paints
  const paint = (hidden) => ev(`(()=>{const c=window.__debug.compass; c.setHidden(${hidden}); let n=0,minx=1e9,maxy=-1; const ui={cols:160,rows:60,setCellRGB(x,y){n++; if(x<minx)minx=x; if(y>maxy)maxy=y;}}; c.draw(ui,160,60); return JSON.stringify({n,minx,maxy,vis:c.visible,label:c.label,sectors:c.sectors});})()`).then(JSON.parse);
  const t = await ev('(()=>{const t=window.__debug.compassRetarget(); const p=window.__debug.playerHandle.data.transform; if(t) window.__debug.compass.step(p.x,p.y,0,p.z); return t?t.kind:0;})()');
  assert.equal(t, 3, 'burl available -> "!" target (kind 3), got ' + t);
  let r = await paint(false);
  assert.ok(r.vis && r.n > 40 && r.minx >= 146 && r.maxy === 58 && r.sectors === 16 && /^! \d+/.test(r.label), 'compass drawn bottom-right with designer style: ' + JSON.stringify(r));
  console.log('[2/4] visible with a target:', JSON.stringify(r));
  await ev("window.__debug.questBook().accept('burl.boars')");
  const t2 = await ev('(()=>{const t=window.__debug.compassRetarget(); return t?t.kind:0;})()');
  assert.equal(t2, 2, 'active boar quest -> step target (nearest living boar), got ' + t2);
  console.log('[3/4] boar quest: step target');
  r = await paint(true);
  assert.ok(!r.vis && r.n === 0, 'hidden -> nothing drawn: ' + JSON.stringify(r));
  console.log('[4/4] hidden draws nothing; live hide flag =', await ev('window.__debug.compassHidden()'));
  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
  console.log('Compass (COMPASS-02): visible with target, hidden on setHidden, PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
