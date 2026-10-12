// D-069 headless check: FB-01 locked fireball, FB-02 Burl's Ember unlock flow, FB-03 hint + MP bar, BEAR-01 black bears.
// Run: node tools/verify-d069.mjs 9500   (PC-B range 9500-9574; port+1 = CDP). One PASS/FAIL line per check, stills -> docs/test-reports/captures/d069-*.png.
// Quest data flow uses the live book (accept / handIn; the dialogue box only calls these); pickups use a real KeyE; casts use a real Mouse2 (useRight) event.
// Quest status codes (questBook.js): UNAVAILABLE 0, AVAILABLE 1, ACTIVE 2, READY 3, DONE 4. Beast states (beastSim.js): WANDER 0, NOTICE 1..RECOVER 5, RETURN 6.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B lane B1 range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-d069-'));
const capDir = path.join(ROOT, 'docs', 'test-reports', 'captures'); mkdirSync(capDir, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, fails = 0;
const report = (name, okk, info) => { if (!okk) fails++; console.log(`${okk ? 'PASS' : 'FAIL'} ${name}${info === undefined ? '' : ' ' + JSON.stringify(info)}`); };
const ev = (s) => evaluate(cdp, s);
async function still(name) { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(capDir, `d069-${name}.png`), Buffer.from(r.data, 'base64')); }
const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k }); await pause(70); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); await pause(150); };
const tele = (x, y, z) => ev(`(()=>{const p=__debug.playerHandle.data.transform;p.x=${x};p.y=${y};p.z=${z};return 1;})()`);
const mouse = (type, button) => ev(`document.querySelector('canvas').dispatchEvent(new MouseEvent('${type}',{button:${button},bubbles:true}))`);
const mp = () => ev('__debug.vitals.mp'); // components.mana is created lazily; vitals.mp reads through
const potions = () => ev(`__debug.playerHandle.data.components.inventory.slots.reduce((a,s)=>a+(s.id==='potion.mp'?s.n:0),0)`);
// Count of non-empty glyph cells on one HUD row (uiStyle.vitals.layout hpRow 1 / mpRow 2); the HP row is the "UI is drawing" control.
const barCells = (row) => ev(`(()=>{const u=__debug.getUi(),c=u.cells;let n=0;for(let x=0;x<40;x++)if(c.glyphIdx[${row}*u.cols+x]!==0)n++;return n;})()`);
async function cast() { await mouse('mousedown', 2); await pause(250); await mouse('mouseup', 2); await pause(250); }
const hintSeen = () => ev(`(__debug.world.state['hints.shown']||[]).concat(__debug.world.state['hints.done']||[]).includes('fbCast')`);

// Runs inside the page: force the prerequisite chain of a giver quest (requires -> accept -> feed every objective -> handIn).
const FORCE_JS = `(()=>{
  const b=__debug.questBook(), log=[];
  const evOf=(w)=>w.type==='flag'?{type:'flag:set',key:w.id,value:w.equals===undefined?true:w.equals}:w.type==='item'?{type:'item:got',id:w.id}:w.type==='area'?{type:'area:entered',id:w.id}:w.type==='beasts'?w.ids.map(i=>({type:'beast:died',id:i})):{type:'item:count',id:w.id,n:w.count||1};
  const doSteps=(id,upTo)=>{const d=b.def(b.index(id));for(let i=0;i<d.objectives.length&&i<=upTo;i++){for(const x of [].concat(evOf(d.objectives[i].when)))b.feed(x);}};
  const force=(id,upTo,depth)=>{
    if(depth>12)return;
    const i=b.index(id);if(i<0){log.push('unknown '+id);return;}
    const d=b.def(i);
    for(const r of d.requires||[]){
      if(r.flag)b.feed({type:'flag:set',key:r.flag,value:true});
      else if(r.done===true)force(r.quest,99,depth+1);
      else{const dd=b.def(b.index(r.quest));force(r.quest,dd.objectives.findIndex(o=>o.id===r.step),depth+1);}
    }
    b.accept(id);doSteps(id,upTo);
    if(upTo>=d.objectives.length-1)b.handIn(id);
  };
  force('mq.ford.mirror',99,0);
  return {mirror:b.statusOf('mq.ford.mirror'),fire:b.statusOf('sq.burl.fire'),log};
})()`;

try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [];
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push('exception: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push('console.error: ' + p.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await ev('!!(window.__debug && window.__debug.playerHandle && window.__debug.fireball && window.__debug.beasts && window.__debug.questBook && window.__debug.questBook())')) { ready = true; break; } }
  if (!ready) { report('boot', false, errors); throw new Error('boot failed'); }
  for (let i = 0; i < 120; i++) { if (!(await ev('window.__debug.wakeOut.inputLocked'))) break; await pause(500); } // intro wake-up locks input / hides the HUD
  await ev('__debug.look.locked = true'); // headless: no pointer lock would pause the sim
  await ev('(()=>{window.__mu=0;__debug.engine.events.on("magic.unlocked",()=>{window.__mu++;});return 1;})()');
  await pause(1500);

  // 1. fresh game: fireball locked
  const hpRow = 1, mpRow = 2;
  const mp0 = await mp();
  const f1 = await ev(`({flag:__debug.world.state['magic.fireball'], right:__debug.playerHandle.data.components.inventory.right})`);
  const hpCells = await barCells(hpRow), mpCells0 = await barCells(mpRow);
  await ev(`__debug.playerHandle.data.components.inventory.right='spell.fireball'`); // even forced into the hand the locked sim must not fire
  await cast();
  const mp1 = await mp(), alive1 = await ev('__debug.fireball.alive');
  await ev(`__debug.playerHandle.data.components.inventory.right=null`);
  await still('1-locked');
  report('1 fireball locked at start', f1.flag !== true && f1.right == null && mpCells0 === 0 && hpCells > 0 && mp1 === mp0 && alive1 === 0, { flag: f1.flag, right: f1.right, hpCells, mpCells: mpCells0, mp0, mp1, alive: alive1 });

  // 2. Burl's Ember
  const forced = await ev(FORCE_JS);
  await pause(300);
  const pot0 = await potions();
  const accepted = await ev(`(()=>{const b=__debug.questBook();b.accept('sq.burl.fire');return b.statusOf('sq.burl.fire');})()`);
  await still('2a-accepted');
  report('2a prerequisite forced (mq.ford.mirror DONE) + sq.burl.fire accepted (ACTIVE)', forced.mirror === 4 && accepted === 2, { forced, accepted });
  const pods = [];
  for (const n of [1, 2, 3]) {
    const id = 'emberpod' + n;
    const t = await ev(`(()=>{const e=__debug.world.entity(${JSON.stringify(id)});return e&&e.transform?{x:e.transform.x,y:e.transform.y,z:e.transform.z}:null;})()`);
    if (!t) { pods.push(id + ' missing'); continue; }
    for (let k = 0; k < 4; k++) {
      await tele(t.x, t.y, t.z); await pause(500); await key('KeyE', 'e'); await pause(400);
      if (!(await ev(`!!__debug.world.entity(${JSON.stringify(id)})`))) break;
    }
    pods.push(id + ((await ev(`!!__debug.world.entity(${JSON.stringify(id)})`)) ? ' NOT picked' : ' picked'));
  }
  await pause(500);
  const status = await ev(`__debug.questBook().statusOf('sq.burl.fire')`);
  await still('2b-pods-collected');
  report('2b three emberpods picked up, quest READY', pods.every((s) => s.endsWith(' picked')) && status === 3, { pods, status });
  await ev(`__debug.questBook().handIn('sq.burl.fire')`);
  await pause(4000); // reward grant (quest:done) + MP fade
  // FB-HINT-01: hints.js is a FIFO with one hint on screen at a time (fadeIn 0.3 + timeout 8 + fadeOut 0.5 = 8.8 s), so fbCast can wait behind another hint; poll up to 20 s.
  // The headless player never moves/looks, so the start-up tutorial hints (move, look, stone, ...) each sit their full timeout
  // ahead of fbCast. Play them off like a player would: markDone the hint on screen (same module instance as the game).
  for (let i = 0; i < 40 && !(await hintSeen()); i++) {
    await ev(`import('/game/js/quest/hints.js').then((h)=>{const id=h.currentHintId();if(id&&!id.startsWith('fb'))h.markDone(__debug.world,id);return id;})`);
    await pause(500);
  }
  const f2 =await ev(`({flag:__debug.world.state['magic.fireball'],mu:window.__mu,done:__debug.questBook().statusOf('sq.burl.fire'),hs:__debug.world.state['hints.shown'],hd:__debug.world.state['hints.done'],wakeT:__debug.world.state['quest.wakeT'],hand:__debug.hands&&__debug.hands.handOf('spell.fireball')})`);
  const shown = await hintSeen(), pot1 = await potions(), mpCells1 = await barCells(mpRow);
  await still('2c-unlocked');
  report('2c hand-in: flag true, one magic.unlocked, MP bar drawn, fbCast hint, +1 potion.mp', f2.flag === true && f2.mu === 1 && f2.done === 4 && mpCells1 > 0 && shown && pot1 - pot0 === 1, { ...f2, hintShown: shown, mpCells: mpCells1, pot0, pot1 });

  // 3. cast works after unlock
  const handAfter = await ev(`(()=>{const i=__debug.playerHandle.data.components.inventory;return i.left+'/'+i.right;})()`); // unlock must put the spell into a free hand by itself
  await pause(300);
  const mpA = await mp();
  await mouse('mousedown', 2); await pause(250); await mouse('mouseup', 2);
  let alive = 0; for (let i = 0; i < 8 && !alive; i++) { await pause(60); alive = await ev('__debug.fireball.alive'); }
  const castTick = await ev('__debug.fireball.castTick');
  await still('3-cast');
  await pause(300);
  const mpB = await mp();
  report('3 cast after unlock: MP drops, projectile exists', mpB < mpA && (alive > 0 || castTick > 0), { mpA, mpB, alive, castTick, handAfter });

  // 4. black bears
  const bears = await ev(`['blackBear1','blackBear2','blackBear3'].map(id=>{const e=__debug.world.entity(id),c=e&&e.components;return {id,kind:c&&c.brain&&c.brain.kind,species:c&&c.brain&&c.brain.species,model:c&&c.voxel&&c.voxel.model,slot:__debug.beasts.slotOf(id)};})`);
  report('4a blackBear1..3 are beasts with model bearBlack', bears.every((b) => b.kind === 'beast' && b.species === 'bear' && b.model === 'bearBlack' && b.slot >= 0), bears);
  const bt = await ev(`(()=>{const t=__debug.world.entity('blackBear1').transform;return {x:t.x,y:t.y,z:t.z};})()`);
  const bState = () => ev(`__debug.beasts.state[__debug.beasts.slotOf('blackBear1')]`);
  await ev(`(()=>{const h=__debug.playerHandle.data.components.health;h.hp=h.max;return 1;})()`);
  await tele(bt.x + 15, bt.y, bt.z + 0.5); await pause(400);
  const far = []; for (let i = 0; i < 6; i++) { await pause(400); far.push(await bState()); }
  await still('4b-bear-15m');
  report('4b bear idle/wander at 15 m', far.every((s) => s === 0 || s === 6), { states: far });
  // BEAR-NAV-01: sight is a cone (hearing only nearR), so stand 10 m IN FRONT of the bear, not at a fixed +x offset
  const bf = await ev(`(()=>{const b=__debug.beasts,i=b.slotOf('blackBear1');const t=__debug.world.entity('blackBear1').transform;const l=Math.hypot(b.fx[i],b.fy[i])||1;return {x:t.x,y:t.y,z:t.z,fx:b.fx[i]/l,fy:b.fy[i]/l};})()`);
  await tele(bf.x + 10 * bf.fx, bf.y + 10 * bf.fy, bf.z + 0.5);
  const near = []; for (let i = 0; i < 20; i++) { await pause(400); near.push(await bState()); if (near[i] >= 1 && near[i] <= 5) break; }
  await still('4c-bear-10m');
  report('4c bear aggroes at 10 m', near.some((s) => s >= 1 && s <= 5), { states: near });

  report('5 no console errors', errors.length === 0, errors.slice(0, 5));
} catch (e) { fails++; console.log('FAIL harness ' + (e && e.message)); }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
  process.exitCode = fails ? 1 : 0;
}
