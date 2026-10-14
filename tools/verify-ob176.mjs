// OB-176: headless owner-pose check. Loads game/index.html?at=1430.8,1057.3,1 and asserts the boars within 60 m move within 10 s
// (none frozen) and are in the targetable list. Run: node tools/verify-ob176.mjs 9520  (PC-B ports 9500-9999; port+1 = CDP)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9520);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob176-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 600, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?at=1430.8,1057.3,1` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.beasts)')) { ready = true; break; } }
  assert.ok(ready, 'beasts ready ' + JSON.stringify(errors));
  const SNAP = `(()=>{const b=__debug.beasts,w=__debug.engine&&__debug.engine.world||null;const out=[];
    for(let i=0;i<b.count;i++){const e=b.entities[i];if(!e||!e.transform)continue;const t=e.transform;if(Math.hypot(t.x-1430.8,t.y-1057.3)<60&&e.components.brain&&e.components.brain.species!=='goblin')out.push({id:e.id,x:t.x,y:t.y,st:b.state[i],dorm:b.dormant[i],down:b.down[i]});}
    return out;})()`;
  let run = false; // the loop starts after the boot fade: wait for the sim to tick
  for (let i = 0; i < 200; i++) { await pause(300); await evaluate(cdp, 'if (__debug.look) __debug.look.locked = true'); /* headless: no pointer lock would pause the sim */ if ((await evaluate(cdp, '__debug.beasts.tick')) > 60) { run = true; break; } }
  assert.ok(run, 'sim ticks (loop running)');
  const a = await evaluate(cdp, SNAP);
  await pause(10000);
  const bb = await evaluate(cdp, SNAP);
  const byId = Object.fromEntries(a.map((r) => [r.id, r]));
  const rows = bb.map((r) => ({ ...r, moved: byId[r.id] ? Math.hypot(r.x - byId[r.id].x, r.y - byId[r.id].y) : -1 }));
  console.log(JSON.stringify(rows.map((r) => `${r.id} st=${r.st} dorm=${r.dorm} down=${r.down} moved=${r.moved.toFixed(2)}`), null, 1));
  assert.ok(rows.length > 0, 'boars near the pose');
  const frozen = rows.filter((r) => r.moved < 0.5 && !r.down);
  assert.equal(frozen.length, 0, 'frozen: ' + frozen.map((r) => r.id).join(','));
  assert.deepEqual(errors, []);
  console.log('OB-176 headless: nearby boars move PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup]', e.message); }
}
