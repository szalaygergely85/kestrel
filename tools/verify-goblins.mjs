// GOB-07b: headless check of goblins in play: by day near campNorth (925,905) goblins present + still + forced throw; at night (time=23) a forced
// goblinNorth raid gives torch-bearers + still. Run: node tools/verify-goblins.mjs <port>  (slot 2 range 9500-9999; CDP = port+1). Not run in the lane (Node only); main session runs it once.
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9580);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-gob-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
let browser, cdp;
async function load(query) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(query)}` });
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.goblinWire && window.__debug.beasts)')) { await evaluate(cdp, 'setInterval(() => { if (window.__debug && window.__debug.look) window.__debug.look.locked = true; }, 30), true'); return true; } } // headless: no pointer lock -> sim paused (see verify-swim)
  return false;
}
const shot = async (name) => { const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, name), Buffer.from(s.data, 'base64')); console.log('   still docs/test-reports/captures/' + name); };
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [];
  cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  const ev = (js) => evaluate(cdp, js);
  const count = (model) => ev(`(()=>{let n=0; window.__debug.world.forEachEntity((e)=>{ const v=e.components&&e.components.voxel; if (v&&v.model==='${model}'&&!v.hidden) n++; }); return n;})()`);

  // 1. day, near campNorth: goblins + a still + a forced throw
  assert.ok(await load('dev=1&backend=webgpu&at=915,905'), 'day: world / goblinWire never ready: ' + JSON.stringify(errors));
  await ev(`(()=>{const d=window.__debug,p=d.playerHandle.data.transform; for(let i=0;i<120;i++) d.goblinWire.step(d.world.state['clock.day']|0,p.x,p.y); d.goblinWire.update();})()`);
  const day = { goblins: await count('goblin'), torches: await count('goblinTorch') };
  console.log('[1/3] day', JSON.stringify(day));
  assert.ok(day.goblins >= 3, 'goblins present by day near campNorth');
  assert.equal(day.torches, 0, 'no torch-bearers by day');
  await shot('goblins-day.png');
  // 2. forced throw: beast:throw event -> enemy spear flies, view shows it
  const th = await ev(`(()=>{const d=window.__debug,p=d.playerHandle.data.transform,ev=d.engine.events; ev.emit('beast:throw',{id:'gobN4',slot:0,x:p.x-8,y:p.y,z:(p.z||0)+1.4,tx:p.x,ty:p.y,tz:(p.z||0)+0.9}); d.goblinWire.step(0,p.x,p.y); d.goblinWire.update(); return count_()})()`.replace('count_()', `(()=>{let n=0; d.world.forEachEntity((e)=>{const v=e.components&&e.components.voxel; if(v&&v.model==='goblinSpear'&&!v.hidden) n++;}); return n;})()`));
  console.log('[2/3] spear in flight', th);
  assert.ok(th >= 1, 'a forced beast:throw shows a flying goblinSpear');
  await pause(300); await shot('goblins-throw.png');
  // 3. night raid: force goblinNorth, torch-bearers present
  assert.ok(await load('dev=1&backend=webgpu&time=23&at=915,905'), 'night: world never ready: ' + JSON.stringify(errors));
  const raid = JSON.parse(await ev(`JSON.stringify((()=>{const d=window.__debug,st=d.world.state,lw=d.lifeWire,p=d.playerHandle.data.transform; const ids=[]; d.engine.events.on('life:raid:start',(q)=>ids.push(q&&q.id)); for(let i=0;i<60;i++) d.goblinWire.step(st['clock.day']|0,p.x,p.y);
    let night=-1; for(let day=1;day<=60&&night<0;day++){ st['clock.day']=day; lw.step(22); lw.step(22.5); if(ids.includes('goblinNorth')) night=day; else lw.step(6);} d.goblinWire.update(); return {night,ids};})())`));
  console.log('[3/3] night raid', JSON.stringify(raid));
  assert.ok(raid.night > 0, 'goblinNorth raid starts within 60 nights');
  const torches = await count('goblinTorch');
  console.log('   torch-bearers', torches);
  assert.ok(torches >= 1, 'torch-bearers present during the raid');
  await shot('goblins-raid.png');
  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
  console.log('Goblins in play (GOB-07b) PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
