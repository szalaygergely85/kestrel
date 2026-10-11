// M4 exit test, browser half: fresh profile = new game -> wake -> first relay (Bend Relay) -> rest/save -> reload with the SAME
// profile (Continue) -> the snapshot (position, hearts + heart pieces, items, equipment, quick bar, quest book active/done/tracked
// + given items, flags, clock hour) is equal. The field-by-field proof and byte-stability live in Node: game/js/m4Exit.test.js.
// Run: node tools/verify-m4-exit.mjs 9725   (PC-B lane range 9725-9799; CDP = port+1; backend webgpu default). Exit 1 on FAIL.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9725);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('this check uses PC-B ports 9500-9999 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-m4-exit-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const url = `http://127.0.0.1:${port}/game/index.html?voxelbench=0&save=1&backend=${backend}`; // capture-like page, relay forced on (as tools/save-reload-browser.mjs)
let browser, cdp;

// In-page snapshot of everything the exit test lists. JSON-safe; state keys are the ones this check sets plus the heart/clock counters.
const SNAP = `(() => { const D = window.__debug, p = D.playerHandle.data, c = p.components, t = p.transform, r = D.saveRelay, b = r.quest.book, w = D.world;
  const q = b.toSave(); const quests = {};
  for (const id of Object.keys(q.quests)) { const e = q.quests[id]; quests[id] = { accepted: e.accepted, handedIn: e.handedIn, given: e.given || [], completed: e.quest.completed }; }
  const st = {}; for (const k of Object.keys(w.state)) if (/^(hearts\\.|clock\\.|m4\\.|waystone\\.ws_roadBend|aether\\.)/.test(k)) st[k] = w.state[k];
  return JSON.parse(JSON.stringify({ pos: [t.x, t.y, t.z], hp: c.health.hp, max: c.health.max, inventory: c.inventory, equipment: c.equipment, quickbar: c.quickbar,
    main: { completed: q.quest.completed, flags: q.quest.flags }, quests, tracked: b.tracked(), state: st, dead: r.deadBeasts, chests: r.openedChests })); })()`;

try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [];
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(JSON.stringify(p.exceptionDetails).slice(0, 300));
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push((p.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  async function open() {
    await cdp.send('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.saveRelay && window.__debug.relayWake && window.__debug.playerHandle.data.components.health)')) { ready = true; break; } }
    assert.ok(ready, 'game never ready: ' + JSON.stringify(errors));
    await pause(1500); // let the sim run a few frames (questPickups installs book.packOps)
  }

  // ---- run 1: new game (empty profile) ----
  await open();
  assert.equal(await evaluate(cdp, "localStorage.getItem('kestrel.save.slot.0') === null"), true, 'fresh profile = no save = new game');
  await evaluate(cdp, `(async () => { const D = window.__debug, w = D.world, p = D.playerHandle.data, c = p.components, defs = window.ASSETS.items.defs;
    const inv = await import('/game/js/quest/sim/inventory.js'), eqm = await import('/game/js/quest/sim/equipment.js'), qbm = await import('/game/js/quest/sim/quickbar.js'), hp = await import('/game/js/quest/sim/heartPieces.js');
    w.state['quest.wakeT'] = 100; c.body.eyeH = D.engine.physics.eyeHeight; // as after a played wake
    const relay = w.get('relayBend').data.transform, t = p.transform; t.x = relay.x - 4; t.y = relay.y; t.z = relay.z + 1; t.yawDeg = 90; // at the first relay
    const inventory = inv.ensureInventory(p, null);
    for (const id of ['sword', 'shield', 'bow', 'arrow', 'potion.hp']) inv.addItem(inventory, defs, id, id === 'arrow' ? 12 : 1);
    const eq = eqm.ensureEquipment(p); for (const id of ['sword', 'shield']) eqm.equip(inventory, eq, defs, id);
    qbm.ensureQuickbar(p); qbm.assign(p, defs, 5, 'potion.hp');
    for (let k = 0; k < 4; k++) { inv.addItem(inventory, defs, 'heart.piece', 1); hp.collect(inventory, c.health, w.state); } // 4 pieces = +1 heart
    c.health.hp = Math.max(1, c.health.max - 10);
    w.state['aether.attuned'] = true; w.state['clock.hour'] = 13.5; w.state['m4.marker'] = 'kept';
    D.relayWake.interact('ws_roadBend'); for (let i = 0; i < 180; i++) D.relayWake.step(1 / 60, null); // wake the relay
    const book = D.saveRelay.quest.book, gi = D.saveRelay.quest.book.def; let n = 0;
    for (let i = 1; i < book.count; i++) if (book.def(i).id === 'tower.blade') { book.def(i).giveOnAccept = [{ id: 'potion.hp', n: 1 }]; n = i; } // exercise the given-items path on a gate-free quest
    if (!book.accept('tower.blade')) throw new Error('tower.blade not acceptable');
    book.track('tower.blade');
    D.gameHooks.ctx.requestSave(); // rest / save (same path as the waystone touch)
    return true; })()`);
  const slotLen = await evaluate(cdp, "(localStorage.getItem('kestrel.save.slot.0') || '').length");
  assert.ok(slotLen > 0, 'slot written');
  const before = await evaluate(cdp, SNAP);
  assert.equal(before.max, 40, 'extra heart from 4 pieces'); assert.equal(before.state['hearts.pieces'], 4);
  assert.equal(before.equipment.main, 'sword'); assert.equal(before.equipment.off, 'shield');
  assert.equal(before.quests['tower.blade'].accepted, true); assert.deepEqual(before.quests['tower.blade'].given, [{ id: 'potion.hp', n: 1 }]);
  assert.equal(before.tracked >= 1, true, 'tower.blade tracked');

  // ---- run 2: quit -> Continue (same profile, reload) ----
  await open();
  const after = await evaluate(cdp, SNAP);
  const near = (a, b, e) => Math.abs(a - b) <= e;
  const diffs = [];
  const eq = (name, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ name, before: a, after: b }); };
  if (!before.pos.every((v, i) => near(v, after.pos[i], 0.05))) diffs.push({ name: 'pos', before: before.pos, after: after.pos });
  eq('hp', before.hp, after.hp); eq('max', before.max, after.max);
  eq('inventory', before.inventory, after.inventory); eq('equipment', before.equipment, after.equipment); eq('quickbar', before.quickbar, after.quickbar);
  eq('main.completed', before.main.completed, after.main.completed); eq('quests', before.quests, after.quests); eq('tracked', before.tracked, after.tracked);
  eq('dead', before.dead, after.dead); eq('chests', before.chests, after.chests);
  for (const k of Object.keys(before.state)) if (k !== 'clock.hour') eq('state.' + k, before.state[k], after.state[k]);
  if (!near(before.state['clock.hour'], after.state['clock.hour'], 0.1)) diffs.push({ name: 'clock.hour', before: before.state['clock.hour'], after: after.state['clock.hour'] });
  console.log(JSON.stringify({ before, after, diffs }));
  assert.deepEqual(diffs, [], 'Continue differs from the saved snapshot');
  assert.deepEqual(errors, [], 'console errors');
  console.log('M4 exit (browser): new game -> relay -> save -> Continue restores position, hearts, items, equipment, quick bar, quests, flags, clock PASS');
} catch (e) {
  console.error('M4 exit (browser): FAIL', e && e.message || e); process.exitCode = 1;
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
