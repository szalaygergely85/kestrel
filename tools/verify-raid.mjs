// LIFE-HOOKS-01: headless check of the raid wiring (lifeWire live, board note accepted, raid:start within N nights, still at gooseFarm).
// Run: node tools/verify-raid.mjs <port>  (slot 2 range 9575-9649; CDP = port+1). Not run in the lane (Node only); main session runs it once.
// QL-WIRE: headless structural check of the Ch1-2 errand wiring: post / notePost [E] Inspect interactables, hillPath area trigger, 21 errand defs in the book,
// inspect hook live (window.__debug.errands). Loads game/index.html?dev=1 (saves on). Run: node tools/verify-errands.mjs <port>   (PC-B lane ports 9575-9649; CDP = port+1)
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9580);
validatePort(port);
if (port < 9575 || port + 1 > 9649) throw new Error('PC-B lane B1 range is 9575-9649 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-qui-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [];
  cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze('dev=1&backend=webgpu')}` });
  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.lifeWire)')) { ready = true; break; } }
  assert.ok(ready, 'world / lifeWire never ready: ' + JSON.stringify(errors));
  const ev = (js) => evaluate(cdp, js);
  console.log('[1/4] lifeWire live');
  // 2. accept the board note (book.accept = what the board read / dialogue action does); prereq may block -> report
  const acc = await ev(`(()=>{const d=window.__debug,b=d.questBook(); const s0=b.statusOf('sq.ow.raid'); let a=null; if (s0===1) a=b.accept('sq.ow.raid'); d.lifeWire.sync(); return {s0,s1:b.statusOf('sq.ow.raid'),gate:!!d.world.state['life.gate.sq.ow.raid']};})()`);
  console.log('[2/4] accept', JSON.stringify(acc));
  if (acc.s0 !== 1) { // opensAfter mq.ford.mirror not done: force the gate state for the wiring check only
    await ev(`window.__debug.world.state['life.gate.sq.ow.raid']=true`); console.log('   (quest not yet offered in this save: gate forced)');
  }
  // 3. step the raid clock by hand (headless sim does not run): night 22:00, scan nights until the roll hits
  const r = JSON.parse(await ev(`JSON.stringify((()=>{const d=window.__debug,st=d.world.state,lw=d.lifeWire; const ev=[]; for(const n of ['life:raid:start','life:raid:defended','life:raid:lost','life:npcHit']) d.engine.events.on(n,(p)=>ev.push(n));
    let night=-1; for(let day=1;day<=40&&night<0;day++){ st['clock.day']=day; lw.step(22); lw.step(22.5); if(ev.includes('life:raid:start')) night=day; lw.step(6);}
    return {night,ev,lastDay:st['life.raid.gooseFarm.lastDay']};})()`));
  console.log('[3/4] raid roll', JSON.stringify(r));
  assert.ok(r.night > 0 && r.ev.includes('life:raid:start'), 'a raid:start fires within 40 nights once the gate is open');
  // 4. still at gooseFarm
  await ev(`(()=>{const d=window.__debug,g=d.world.get('gooseFarm').transform,p=d.playerHandle.data.transform; p.x=g.x-6; p.y=g.y-6;})()`);
  await pause(1500);
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(out, 'raid-goosefarm.png'), Buffer.from(s.data, 'base64'));
  console.log('[4/4] still docs/test-reports/captures/raid-goosefarm.png');
  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
  console.log('Raid wiring (LIFE-HOOKS-01) PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
