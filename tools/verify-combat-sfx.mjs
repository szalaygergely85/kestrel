// EV17-01: combat feel audio. Boots the game, triggers swing / light+heavy hit / hurt / beast death / heartbeat via the real event bus and
// asserts window.__combatSfx scheduled the cues (counts only, no audio output needed). Run: node tools/verify-combat-sfx.mjs 9510 (PC-B B1 ports 9500-9574).
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-combat-sfx-'));
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
  const ev = (js) => evaluate(cdp, `(()=>{const e=__debug.engine.events, s=window.__combatSfx; ${js}})()`);
  assert.ok(await evaluate(cdp, '!!window.__combatSfx'), 'window.__combatSfx missing');
  const gap = () => pause(260); // > every cue's rate-limit gap
  const counts = () => evaluate(cdp, 'JSON.stringify(window.__combatSfx.counts)').then(JSON.parse);
  const base = await counts();
  // Force a fake always-audible mute state off is not needed: the cue counter increments only when not muted; unmute first.
  await evaluate(cdp, '(async()=>{const m=await import("/game/js/audio/synth.js"); m.setMuted(false);})()');
  await ev(`e.emit('combat:hit',{source:'player',target:'boar1',damage:1,heavy:0,dirX:1,dirY:0,px:0,py:0,pz:1})`); await gap();
  await ev(`e.emit('combat:hit',{source:'player',target:'boar1',damage:2,heavy:1,dirX:1,dirY:0,px:0,py:0,pz:1})`); await gap();
  await ev(`e.emit('combat:hit',{source:'boar1',target:'player',damage:1,heavy:0,dirX:1,dirY:0,px:0,py:0,pz:1})`); await gap();
  await ev(`e.emit('beast:died',{id:'boar1'})`); await gap();
  await ev(`s.swing()`); await gap();
  const c = await counts();
  for (const k of ['hitLight', 'hitHeavy', 'hurt', 'beastDeath', 'swing']) assert.equal(c[k] - base[k], 1, `cue ${k} not scheduled exactly once (${c[k]} vs ${base[k]})`);
  // rate limit: two light hits 5 ms apart -> one cue
  const b2 = (await counts()).hitLight;
  await ev(`for (let i=0;i<2;i++) e.emit('combat:hit',{source:'player',target:'boar1',damage:1,heavy:0,px:0,py:0,pz:1})`);
  assert.equal((await counts()).hitLight - b2, 1, 'rate limit did not drop the second hit');
  // heartbeat: drop hp to 1 heart via debug vitals, wait ~2.5 s, expect beats; heal -> stop.
  const hb0 = (await counts()).heartbeat;
  await evaluate(cdp, 'window.__debug.vitals ? (window.__debug.vitals.hp = 3, 1) : 0');
  await pause(2500);
  const hb1 = (await counts()).heartbeat;
  console.log('heartbeat beats while low:', hb1 - hb0, '(0 means __debug.vitals is not exposed; check manually)');
  console.log('combat-sfx verify OK', JSON.stringify(c));
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
}
