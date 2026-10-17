// OB-216: real-browser check that the New Game intro never shows the title menu between slides.
// Run: node tools/verify-intro.mjs --port 95xx [--backend webgpu] [--secs 20]   (owner/main session only)
// Starts New Game through the real menu host, then every 300 ms samples menuHost.introOpen/active and a counter of
// menu-card draw calls (menuHost.menu.draw wrapped in the page). Asserts: intro open the whole window, 0 menu draws.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';
import { withTimeFreeze } from './tool-url.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const port = Number(opt('port', 9560));
validatePort(port);
const backend = opt('backend', 'webgpu');
const secs = Number(opt('secs', 20));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-intro-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`backend=${backend}`)}` });
  let ready = false;
  for (let i = 0; i < 400; i++) { if (await evaluate(cdp, '!!(window.__bootReport && window.__debug && window.__debug.menuHost)')) { ready = true; break; } await pause(50); }
  assert.ok(ready, JSON.stringify({ errors, msg: 'boot / menuHost not ready' }));
  await pause(3000); // let the slides finish loading in the background
  // wrap the menu card draw, then New game -> slot list -> first slot (same keys as titleMenuHost.test.js)
  await evaluate(cdp, "(()=>{const h=window.__debug.menuHost;window.__menuDraws=0;const d=h.menu.draw;h.menu.draw=function(...a){window.__menuDraws++;return d.apply(this,a);};h.menu.handleKey('Enter');h.consume();h.menu.handleKey('Enter');h.consume();return h.introOpen;})()");
  await pause(600);
  const base = await evaluate(cdp, 'window.__menuDraws');
  const samples = [];
  const n = Math.floor(secs * 1000 / 300);
  for (let i = 0; i < n; i++) {
    const s = await evaluate(cdp, "(()=>{const h=window.__debug.menuHost;return {open:h.introOpen,active:h.active,draws:window.__menuDraws};})()");
    samples.push(s);
    await pause(300);
  }
  const open = samples.filter((s) => s.open).length;
  console.log(`samples=${samples.length} introOpen=${open} menuDraws(at start)=${base} menuDraws(end)=${samples[samples.length - 1].draws}`);
  assert.equal(open, samples.length, 'intro must stay open for the whole window (hold >= 7 s per slide)');
  assert.ok(samples.every((s) => s.draws === base), 'title menu card was drawn while the intro played');
  assert.deepEqual(errors, []);
  console.log('Intro: menu never drawn while the intro played PASS');
} finally {
  if (cdp) try { await cdp.close(); } catch { /* ignore */ }
  if (browser) killTree(browser.pid);
  if (server) killTree(server.pid);
}
