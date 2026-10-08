#!/usr/bin/env node
// tools/save-reload-browser.mjs (US-089w / US-096w headless check). Own server + headless Chrome over CDP on --port (95xx).
//   node tools/save-reload-browser.mjs --port 9535 [--grid 240x90]
// Loads game/index.html?voxelbench=0&save=1 (capture-like page; save=1 forces the relay on), skips the wake, moves the player,
// takes the lantern, kills boar1, saves, reloads the SAME profile and checks: position within 0.01 m, hearts, quest objective,
// dead beast stays gone, no console errors. Also checks that without save=1 (capture page) nothing loads or saves.
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';
import { ROOT, findBrowserBinary, waitForHttp, killTree, connectCdp, buildLaunchFlags, validatePort } from './capture-browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const port = Number(args.port); validatePort(port);
const grid = args.grid || '240x90';
const base = `http://127.0.0.1:${port}/game/index.html?voxelbench=0&grid=${grid}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const handles = {};
const errors = [];
function cleanup() {
  if (handles.b) killTree(handles.b.pid);
  if (handles.s) killTree(handles.s.pid);
  if (handles.dir) { try { rmSync(handles.dir, { recursive: true, force: true }); } catch { /* ignore */ } }
}
process.once('SIGINT', () => { cleanup(); process.exit(1); });

const WAIT = `(async () => { for (let i = 0; i < 4000 && !(window.__debug && window.__debug.playerHandle && window.__debug.world); i++) await new Promise((r) => setTimeout(r, 50));
  const fr = () => new Promise((r) => requestAnimationFrame(r)); for (let i = 0; i < 90; i++) await fr();
  for (let i = 0; i < 1200 && !window.__debug.playerHandle.data.components.health; i++) await fr(); // wait for the sim to actually step (cold start can stall the first frames)
  return true; })()`;
const STATE = `(() => { const D = window.__debug, p = D.playerHandle.data, t = p.transform, w = D.world;
  const r = D.saveRelay; const bs = D.beasts, bi = bs ? bs.slotOf('boar1') : -1;
  return { x: t.x, y: t.y, z: t.z, hp: p.components.health.hp, lantern: w.state['tower.lantern.taken'], objective: r.quest.objectiveText(),
    dead: r.deadBeasts, enabled: r.enabled, slot: localStorage.getItem('kestrel.save.slot.0') ? localStorage.getItem('kestrel.save.slot.0').length : 0,
    boarState: bi >= 0 ? bs.state[bi] : null, last: r.lastResult }; })()`;

async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 120000 });
  if (r.exceptionDetails) throw new Error('eval threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 2000));
  return r.result.value;
}
async function open(cdp, url) {
  const loaded = new Promise((r) => cdp.onEvent((m) => { if (m === 'Page.loadEventFired') r(); }));
  await cdp.send('Page.navigate', { url });
  await loaded;
  await evalIn(cdp, WAIT);
}

let res;
try {
  const binary = findBrowserBinary();
  if (!binary) throw new Error('no Chrome/Edge binary');
  handles.s = spawn('python', ['tools/serve.py', String(port)], { cwd: ROOT, stdio: 'ignore' });
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  const dbg = port + 1; validatePort(dbg);
  handles.dir = path.join(os.tmpdir(), 'kestrel-savereload-' + port);
  handles.b = spawn(binary, [`--remote-debugging-port=${dbg}`, '--headless=new', ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${handles.dir}`, 'about:blank'], { stdio: 'ignore' });
  const cdp = await connectCdp(dbg, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push('exception: ' + JSON.stringify(p.exceptionDetails).slice(0, 300));
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push('console.error: ' + (p.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  });

  // 1: first run
  await open(cdp, base + '&save=1');
  await evalIn(cdp, `(async () => { const D = window.__debug, w = D.world, t = D.playerHandle.data.transform; w.state['quest.wakeT'] = 100;
    const fr = () => new Promise((r) => requestAnimationFrame(r)); for (let i = 0; i < 20; i++) await fr();
    t.x += 1.5; t.y += 0.75; for (let i = 0; i < 90; i++) await fr();
    const hc = D.playerHandle.data.components; if (!hc.health) throw new Error('no health; keys=' + Object.keys(hc) + ' loop=' + JSON.stringify(D.engine.loop.stats)); hc.health.hp = Math.min(2, hc.health.max);
    w.state['tower.lantern.taken'] = true; D.engine.events.emit('combat:hit', { source: 'player', target: 'boar1', damage: 99 }); for (let i = 0; i < 30; i++) await fr();
    D.saveRelay.save(w); return true; })()`);
  const before = await evalIn(cdp, STATE);
  // 2: reload, same profile
  await open(cdp, base + '&save=1');
  const after = await evalIn(cdp, STATE);
  // 3: capture-like page without save=1: must not load the slot
  await open(cdp, base);
  const plain = await evalIn(cdp, STATE);
  const d = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
  res = { before, after, plain, posDelta: d, errors };
  cdp.close();
} finally { cleanup(); }
const ok = res.posDelta < 0.01 && res.after.hp === res.before.hp && res.before.slot > 0 && res.after.lantern === true
  && res.after.objective === 'Reach the breach' && res.after.dead.includes('boar1') && res.after.boarState === 12
  && res.plain.enabled === false && res.plain.lantern === false && res.errors.length === 0;
console.log(JSON.stringify(res, null, 1));
console.log(ok ? 'save-reload: PASS' : 'save-reload: FAIL');
process.exit(ok ? 0 : 1);
