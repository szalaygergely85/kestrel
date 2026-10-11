// OB-064: headless check that a boar kill leaves the pack unchanged and the loot waits in the corpse until looted.
// Run: node tools/verify-boar-loot.mjs 9500   (PC-B range 9500-9574; port+1 = CDP). Boots like verify-note-close (dev=1&title=0).
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-boar-loot-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.loot && window.__debug.playerHandle)')) { ready = true; break; } }
  assert.ok(ready, 'boot: ' + JSON.stringify(errors));
  await evaluate(cdp, '__debug.look.locked = true'); // headless: no pointer lock would pause the sim
  const total = '(()=>__debug.playerHandle.data.components.inventory.slots.reduce((a,s)=>a+(s.id?s.n:0),0))()';
  const id = await evaluate(cdp, '__debug.beasts.ids[0]');
  // Put the player ON the boar so any auto-pickup path would fire, then kill it through the same event sword/arrow emit.
  await evaluate(cdp, `(()=>{const b=__debug.world.get(${JSON.stringify(id)}).data.transform,p=__debug.playerHandle.data.transform;p.x=b.x;p.y=b.y;p.z=b.z;return 1;})()`);
  const before = await evaluate(cdp, total);
  await evaluate(cdp, `__debug.engine.events.emit('combat:hit',{target:${JSON.stringify(id)},damage:999,source:'player',cause:'sword'})`);
  await pause(2500); // death anim + pickup steps while the player stands on the corpse
  const afterKill = await evaluate(cdp, total);
  const held = await evaluate(cdp, `({flag:!!__debug.world.state['loot.'+${JSON.stringify(id)}],meat:__debug.loot.countOf(${JSON.stringify(id)},0)})`);
  assert.equal(afterKill, before, 'pack must not change on kill');
  assert.deepEqual(held, { flag: true, meat: 1 }, 'corpse holds the loot');
  await evaluate(cdp, `__debug.loot.lootBoar(${JSON.stringify(id)})`);
  await pause(500);
  const afterLoot = await evaluate(cdp, total);
  assert.ok(afterLoot >= before + 1, 'meat in the pack after loot: ' + afterLoot);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ before, afterKill, afterLoot }), 'OB-064 boar loot: pack unchanged on kill, filled only after loot PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
