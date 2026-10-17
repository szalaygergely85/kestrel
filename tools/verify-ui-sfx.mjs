// EV17-02: quest / item-get / pause-menu cues. Boots the game, fires each cue through window.__uiSfx (the object main.js wires to the quest book, item card and pause menu) and
// asserts window.__uiSfx.counts, rate limit and mute. Based on verify-combat-sfx.mjs (EV17-01) (counts only, no audio output needed). Run: node tools/verify-ui-sfx.mjs 9520 (PC-B B1 ports 9500-9574).
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ui-sfx-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?debug=1` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(400); if (await evaluate(cdp, '!!(window.__debug && window.__debug.engine && window.__debug.engine.world && window.__debug.playerHandle)')) { ready = true; break; } }
  assert.ok(ready, 'game did not boot');
  assert.ok(await evaluate(cdp, '!!window.__uiSfx'), 'window.__uiSfx missing');
  await evaluate(cdp, '(async()=>{const m=await import("/game/js/audio/synth.js"); m.setMuted(false);})()');
  const counts = () => evaluate(cdp, 'JSON.stringify(window.__uiSfx.counts)').then(JSON.parse);
  const run = (js) => evaluate(cdp, `(()=>{const s=window.__uiSfx; return ${js}})()`);
  const base = await counts();
  const table = { 'quest:accepted': 'questAccepted', 'quest:ready': 'questReady', 'quest:done': 'questDone' };
  for (const [ev, cue] of Object.entries(table)) { assert.equal(await run(`s.quest('${ev}')`), true, ev); await pause(700); }
  assert.equal(await run(`s.quest('quest:abandoned')`), false, 'abandoned must be silent');
  assert.equal(await run('s.itemGet()'), true); await pause(300);
  assert.equal(await run('s.menuMove()'), true); await pause(60);
  assert.equal(await run('s.menuConfirm()'), true); await pause(100);
  let c = await counts();
  for (const k of ['questAccepted', 'questReady', 'questDone', 'itemGet', 'menuMove', 'menuConfirm']) assert.equal(c[k] - base[k], 1, `cue ${k} not exactly once`);
  await pause(300); assert.equal(await run('s.itemGet()'), true); assert.equal(await run('s.itemGet()'), false, 'rate limit: second itemGet inside the gap dropped');
  await evaluate(cdp, '(async()=>{const m=await import("/game/js/audio/synth.js"); m.setMuted(true);})()'); await pause(700);
  const m0 = await counts(); await run("s.quest('quest:done')");
  assert.equal((await counts()).questDone, m0.questDone, 'muted must schedule nothing');
  console.log('ui-sfx verify OK', JSON.stringify(c));
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
}
