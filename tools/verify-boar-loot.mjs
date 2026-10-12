// OB-064: headless check that a boar kill leaves the pack unchanged and the loot waits in the corpse until looted.
// Run: node tools/verify-boar-loot.mjs 9500   (PC-B range 9500-9574; port+1 = CDP). Boots like verify-note-close (dev=1&title=0).
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B lane B1 range is 9500-9999 (next port is CDP)');
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
  for (let i = 0; i < 120; i++) { if (!(await evaluate(cdp, 'window.__debug.wakeOut.inputLocked'))) break; await pause(500); } // intro wake-up locks input (and hides hints / blocks the sword)
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
  // OB-074/075/076 (written, not run headless): potion stays in the corpse; no item card; a sword hit lands on a boar past the 16th targetable.
  const noOrbGround = await evaluate(cdp, `(()=>{let n=0;__debug.world.forEachEntity((e)=>{const p=e.components&&e.components.pickup;if(p&&p.kind!=='item')n++;});return n;})()`);
  assert.equal(noOrbGround, 0, 'OB-074: no hp/mp orb on the ground after the kill');
  assert.equal(await evaluate(cdp, '!!(window.__debug.chestHook && window.__debug.chestHook.card.isOpen)'), false, 'OB-075: no item card after loot');
  // a late boar (index > 15) used to be unhittable. BEAR-NAV-01: the last slots are now live black bears (they aggro and close in), so take the last BOAR
  let lastId = await evaluate(cdp, `(()=>{const ids=__debug.beasts.ids;for(let i=ids.length-1;i>=0;i--){const e=__debug.world.entity(ids[i]),br=e&&e.components&&e.components.brain;if(br&&br.species!=='bear'&&br.species!=='wolf')return i>15?ids[i]:null;}return null;})()`);
  if (process.env.BOAR_ID) lastId = process.env.BOAR_ID;
  assert.ok(lastId, 'OB-076: a boar sits past the 16th targetable slot');
  // The far boar's terrain streams in only when the player is near: go to its x,y just above the terrain, let it settle, then stand 1.2 m south of it facing +y (compass yaw 180).
  await evaluate(cdp, `(()=>{const w=__debug.world,b=w.get(${JSON.stringify(lastId)}).data.transform,p=__debug.playerHandle.data.transform,g=w.heightAt?w.heightAt(b.x,b.y):0;p.x=b.x;p.y=b.y-1.2;p.z=(g==null?0:g)+1;__debug.look.yawDeg=180;__debug.look.pitchDeg=0;return 1;})()`);
  await pause(2000);
  await evaluate(cdp, `(()=>{const b=__debug.world.get(${JSON.stringify(lastId)}).data.transform,p=__debug.playerHandle.data.transform;p.x=b.x;p.y=b.y-1.2;p.z=b.z;__debug.look.yawDeg=180;__debug.look.pitchDeg=0;return 1;})()`);
  // A fresh ?dev=1&title=0 game has no sword: wield it as the game does (equipment.main; stepEquipment derives inventory.left, hands router arms the sword sim).
  await evaluate(cdp, `(()=>{const c=__debug.playerHandle.data.components;c.equipment.main='sword';c.equipment.set='melee';__debug.engine.world.state['tower.sword.taken']=true;return 1;})()`);
  await pause(300);
  const hp0 = await evaluate(cdp, `__debug.world.get(${JSON.stringify(lastId)}).data.components.health.hp`);
  // Real input path: engine Input listens for mousedown (button 0 = Mouse0 = useLeft); held while the sword sim swings.
  await evaluate(cdp, "document.querySelector('canvas').dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}))");
  await pause(1500);
  await evaluate(cdp, "document.querySelector('canvas').dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}))");
  await pause(1000); // the strike lands after the release (a 1.5 s hold is a charged swing)
  const dbg = await evaluate(cdp, `JSON.stringify((()=>{const d=__debug,c=d.playerHandle.data.components,p=d.playerHandle.data.transform,b=d.world.get(${JSON.stringify(lastId)}).data;return {left:c.inventory.left,set:c.equipment.set,down:d.hands&&d.hands.downOf&&d.hands.downOf('sword'),locked:d.look.locked,paused:!!(d.isPaused&&d.isPaused()),uiLocked:d.uiLocked,mouse0:d.input&&d.input.isDown('Mouse0'),p:[p.x,p.y,p.z],b:[b.transform.x,b.transform.y,b.transform.z],hp:b.components.health}})())`); console.log('dbg', dbg);
  const hp1 = await evaluate(cdp, `__debug.world.get(${JSON.stringify(lastId)}).data.components.health.hp`);
  assert.ok(hp1 < hp0, 'OB-076: locked LMB sword swing damages the last boar: ' + hp0 + ' -> ' + hp1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ before, afterKill, afterLoot }), 'OB-064 boar loot: pack unchanged on kill, filled only after loot PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
