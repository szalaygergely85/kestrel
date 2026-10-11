// M4-C2: scripted playthrough of Chapter 1-2 in the REAL game (headless browser): wake -> note -> sword -> Burl -> boars -> relay wake/SOS/knot -> Rook ->
// one errand of each template kind (collect, deliver, talk, explore, escort, target hits) -> Rook's nest mirror -> Ford relay -> gear check -> save -> reload + Continue.
// The player is driven through window.__debug hooks: teleport = what real travel does (floor height, vitals.clearSafe, wait for the band); [E] = a real KeyE key event;
// dialogue lines/choices go through the dialogue runner (press/choose); boar kills and straw-man hits are combat:hit events (the same event sword and arrow emit).
// Run: node tools/verify-ch12-run.mjs 9560   (PC-B lane ports 9500-9574; CDP = port+1). Prints beat -> PASS/FAIL, exit 1 on any FAIL.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9560);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ch12-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const url = `http://127.0.0.1:${port}/game/index.html?voxelbench=0&save=1&backend=webgpu`;
const rows = []; const errors = []; const warns = []; let browser, cdp;
const ev = (js) => evaluate(cdp, js);
const evA = (js) => evaluateAsync(cdp, js);
const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k.length === 1 ? k : undefined }); await pause(70); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); await pause(120); };

// ---- page-side helper library (window.__t) ----
const LIB = `(() => { const D = window.__debug, w = D.world, p = D.playerHandle.data, t = p.transform, c = p.components, sl = (ms) => new Promise((r) => setTimeout(r, ms));
  const book = () => D.saveRelay.quest.book;
  const T = window.__t = { D, w, sl,
    st: (id) => book().statusOf(id),
    ix: (k) => w.interactables.find((r) => r.key === k),
    trig: (id) => w.triggers.find((r) => r.key === 'world.' + id),
    flag: (k) => !!w.state[k] || !!D.saveRelay.quest.state.flags[k],
    has: (id) => { let n = 0; for (const s of c.inventory.slots) if (s && s.id === id) n += s.n || 1; return n; },
    // teleport like real travel: floor height at the target, no old safe spot (void rule), then let the band stream in
    async tp(x, y, dz = 0.6, zAbs) { let g = w.floorAt(x, y); if (zAbs !== undefined) g = zAbs - dz; t.x = x; t.y = y; t.z = (g == null ? t.z + 3 : g + dz); c.body.vx = c.body.vy = c.body.vz = 0; D.vitals.clearSafe(); D.look.locked = true; await sl(450);
      if (zAbs === undefined) { g = w.floorAt(x, y); if (g != null && Math.abs(t.z - g) > 3) { t.z = g + dz; await sl(250); } } },
    // stand 'off' m west of the interactable and aim the camera at it (updateInteraction is a view-cone + reach test from the eye)
    face(r) { const dx = r.x - t.x, dy = r.y - t.y, dz = (r.z || 0) - (t.z + (c.body.eyeH || 1.6)), h = Math.hypot(dx, dy) || 1e-6;
      const yaw = Math.atan2(dx, -dy) * 180 / Math.PI, pitch = Math.atan2(dz, h) * 180 / Math.PI; D.look.yawDeg = yaw; D.look.pitchDeg = pitch; t.yawDeg = yaw; t.pitchDeg = pitch; },
    // from = {x,y,z}: approach from that spot (rooftop items whose floor lookup gives the wall top): stand 'off' m before the item on the line from there
    async goIx(k, off = 0.9, from) { const r = T.ix(k); if (!r) throw new Error('no interactable ' + k);
      if (from) { const dx = r.x - from.x, dy = r.y - from.y, n = Math.hypot(dx, dy) || 1; await T.tp(r.x - dx / n * off, r.y - dy / n * off, 0.3, from.z); } else await T.tp(r.x - off, r.y); T.face(T.ix(k)); await sl(150); return r; },
    // npc interactable records keep the spawn spot: stand next to the entity itself and aim at it
    async goNpc(id, off = 1.2) { const e = w.get(id).data.transform; for (let n = 0, px = e.x, py = e.y; n < 20; n++) { await sl(500); if (Math.hypot(e.x - px, e.y - py) < 0.02) break; px = e.x; py = e.y; } // let a walking npc settle first
      const g0 = w.floorAt(e.x - off, e.y); // Rook stands on a roof deck: when the floor lookup disagrees with the NPC's z, stand at the NPC's own level
      if (g0 == null || Math.abs(g0 - e.z) > 0.15) await T.tp(e.x - off, e.y, 0.3, e.z + 0.3); else await T.tp(e.x - off, e.y); T.face({ x: e.x, y: e.y, z: e.z + 1.2 }); await sl(150); return true; },
    async marker(id) { const { localToWorld } = await import('/engine/core/transform.js'); const o = { x: 0, y: 0, z: 0 };
      for (const st of w.structures) { const m = st.level && st.level.def && st.level.def.markers && st.level.def.markers[id]; if (m) { localToWorld(st.frame, m.x, m.y, m.z || 0, o); return { x: o.x, y: o.y, z: o.z }; } } return null; },
    async goTrig(id) { const r = T.trig(id); if (!r) throw new Error('no trigger ' + id); await T.tp(r.x, r.y); await sl(500); return r; },
    // advance the open dialogue box: press lines, choose the first choice matching one of prefs (regex strings) else the first
    async dlg(prefs = []) { const r = D.dialogue.runner, log = []; for (let n = 0; n < 400 && D.dialogue.open; n++) {
        if (r.state === 'choosing') { const ch = []; for (let i = 0; i < r.choiceCount; i++) ch.push(String(r.choiceText(i))); let k = 0;
          out: for (const q of prefs) for (let i = 0; i < ch.length; i++) if (new RegExp(q, 'i').test(ch[i])) { k = i; break out; }
          log.push('[' + ch.join(' | ') + '] -> ' + k); r.selected = k; r.choose(); } else r.press();
        await sl(50); } await sl(300); return log; },
    snap() { const q = book().toSave(), st = {}; for (const k of Object.keys(w.state)) if (!/^(clock\\.|quest\\.wakeT|quest\\.endT|hints\\.|ui\\.)/.test(k)) st[k] = w.state[k];
      const quests = {}; for (const id of Object.keys(q.quests)) { const e = q.quests[id]; quests[id] = { a: e.accepted, h: e.handedIn, g: e.given || [], done: e.quest.completed }; }
      return JSON.parse(JSON.stringify({ pos: [t.x, t.y, t.z], hp: c.health.hp, max: c.health.max, inventory: c.inventory.slots, equipment: c.equipment, quickbar: c.quickbar, main: { done: q.quest.completed, flags: q.quest.flags }, quests, tracked: book().tracked(), state: st, dead: D.saveRelay.deadBeasts, chests: D.saveRelay.openedChests })); } };
  return true; })()`;

function rec(name, ok, why) { rows.push({ name, ok, why: why || '' }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (why ? '  - ' + why : '')); }
async function beat(name, fn) {
  try { const r = await fn(); if (r === true || r === undefined) rec(name, true); else rec(name, !!r.ok, r.why); }
  catch (e) { rec(name, false, String(e && e.message || e).slice(0, 400)); }
}
const stOf = (id) => ev(`__t.st(${JSON.stringify(id)})`);
const NAMES = ['unavailable', 'available', 'active', 'ready', 'done'];
const state = async (...ids) => { const o = {}; for (const id of ids) o[id] = NAMES[await stOf(id)]; return JSON.stringify(o); };
const done = async (id) => (await stOf(id)) === 4;
const mainDone = () => ev('JSON.stringify(__t.D.saveRelay.quest.state.completed)');
async function goIx(k, off = 0.9) { await evA(`(async () => { await __t.goIx(${JSON.stringify(k)}, ${off}); return true; })()`); }
async function goTrig(...ids) { for (const id of ids) await evA(`(async () => { await __t.goTrig(${JSON.stringify(id)}); return true; })()`); }
async function pressE(n = 1) { for (let i = 0; i < n; i++) { await key('KeyE', 'e'); await pause(450); } }
// talk to an npc: stand at its [E] Talk interactable, press E, run the dialogue; returns the choice log
async function talk(id, prefs = []) {
  await ev('(() => { for (let k = 0; k < 4; k++) __t.D.notice.update(10, false); return true; })()'); // capture-like page never advances the notice timer
  await evA(`__t.goNpc(${JSON.stringify(id)})`); await pause(300);
  let open = await ev('__t.D.dialogue.open');
  for (let i = 0; i < 3 && !open; i++) { if (i > 0) { await evA(`__t.goNpc(${JSON.stringify(id)}, ${[1.2, -1.2, 2.2][i]})`); await pause(200); } await pressE(1); open = await ev('__t.D.dialogue.open'); }
  if (!open) { const d = await evA(`(async () => { const D = __t.D, w = __t.w, t = D.playerHandle.data.transform, b = w.get(${JSON.stringify(id)}).data.transform, nr = await import('/game/js/quest/noteRead.js'); return JSON.stringify({ note: nr.isNoteOpen(), notice: D.notice.active, ui: D.uiLocked, ist: w.interaction.targetKey, ix: !!__t.ix('npc.${id}'), dist: Math.hypot(t.x - b.x, t.y - b.y), dz: t.z - b.z, lock: D.look.locked, wake: D.wakeOut.inputLocked }); })()`); throw new Error('E did not open the dialogue with ' + id + ' ' + d); }
  const lg = await evA(`__t.dlg(${JSON.stringify(prefs)})`); lastLog = JSON.stringify(lg).slice(0, 300); return lg;
}
let lastLog = '';
// errand giver: talk (npc) or inspect/touch ([E]) until the quest reaches `want`; site -> interactable key
const GIVER = { burl: 'npc.bear', rook: 'npc.rook', post: 'qi.post', notePost: 'qi.notePost', relayBend: 'relay.ws_roadBend', relayFord: 'relay.ws_ford' };
const YES = ['ok|yes|will|do it|i.ll|take|accept|sure|done|here|ready|deliver|thanks'];
async function giverStep(site, want, id, prefs = YES) {
  const k = GIVER[site];
  for (let i = 0; i < 9; i++) { // a giver offers one available errand per talk
    if ((await stOf(id)) >= want) return true;
    if (k.startsWith('npc.')) await talk(k.slice(4), prefs); else { await goIx(k); await pressE(1); if (await ev('__t.D.dialogue.open')) await evA('__t.dlg([])'); }
  }
  return (await stOf(id)) >= want;
}
const tpA = (x, y) => evA(`(async () => { await __t.tp(${x}, ${y}); return true; })()`);
const emitHit = (target) => ev(`(() => { __t.D.engine.events.emit('combat:hit', { target: ${JSON.stringify(target)}, damage: 999, source: 'player', cause: 'sword' }); return true; })()`);
async function waitFor(fn, ms, step = 400) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await pause(step); } return false; }
const flag = (k) => ev(`__t.flag(${JSON.stringify(k)})`);

async function open(u = url) {
  await cdp.send('Page.navigate', { url: u });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await ev('!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.saveRelay && window.__debug.relayWake && window.__debug.dialogue && window.__debug.playerHandle.data.components.health)')) { ready = true; break; } }
  if (!ready) throw new Error('game never ready: ' + JSON.stringify(errors) + ' ' + await ev("JSON.stringify(Object.keys(window.__debug.playerHandle.data.components))"));
  await pause(1500); await ev(LIB);
}

try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(JSON.stringify(p.exceptionDetails).slice(0, 300));
    if (m === 'Runtime.consoleAPICalled' && p.type === 'warning') warns.push((p.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 200));
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push((p.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await open();
  if (!(await ev("localStorage.getItem('kestrel.save.slot.0') === null"))) throw new Error('profile not fresh');

  if (process.argv[3]) { const { readFileSync } = await import('node:fs'); console.log(JSON.stringify(await evA(readFileSync(process.argv[3], 'utf8')), null, 1)); if (process.argv[4]) { await pressE(1); console.log(JSON.stringify(await evA(readFileSync(process.argv[4], 'utf8')), null, 1)); } throw new Error('probe done'); } // dev: run a snippet after the page is ready
  // ===== Chapter 1: the tower =====
  await beat('1 wake in the tower', async () => {
    await ev("(__t.w.state['quest.wakeT'] = 100, true)"); await pause(1500); await ev('(__t.D.playerHandle.data.components.body.eyeH = __t.D.engine.physics.eyeHeight, true)'); // as after a played wake (the rise ends at standing eye height); skip the played black/blink/title timeline (real time ~25 s)
    const ok = await waitFor(async () => (await mainDone()).includes('"wake"'), 8000);
    return { ok, why: ok ? '' : 'main step wake not completed: ' + await mainDone() };
  });
  await beat('2 read the note (tower.blade offered/accepted)', async () => {
    await goIx('tower.noteKeepLight', 0.8); await pause(300);
    for (let i = 0; i < 3 && (await stOf('tower.blade')) < 2; i++) await pressE(1);
    const s = await state('tower.blade'); await key('Escape', 'Escape');
    return { ok: (await stOf('tower.blade')) >= 2, why: s };
  });
  await beat('3 take the sword, leave the tower', async () => {
    await evA("(async () => { const m = await __t.marker('breach'); await __t.tp(m.x, m.y, 0.3); await __t.sl(500); return true; })()");
    const bm = await evA("__t.marker('breach')"); await evA(`(async () => { await __t.goIx('tower.sword', 0.8, ${JSON.stringify(bm)}); return true; })()`); const has = await waitFor(async () => { if (await ev("__t.has('sword') > 0 || __t.D.saveRelay.quest.state.items.includes('sword')")) return true; await pressE(1); return false; }, 6000, 100);
    await goTrig('towerDoor'); await pause(600);
    const m = await mainDone();
    return { ok: has && /breach/.test(m) && /sword/.test(m) && /leave/.test(m), why: `sword=${has} main=${m} ${await state('tower.blade')}` };
  });
  await beat('4 Burl: hand in the blade, boar quest accepted', async () => {
    const log = await talk('bear', ['ready|boar|help|will|ok|yes']);
    const ok = (await done('tower.blade')) && (await stOf('burl.boars')) >= 2;
    return { ok, why: ok ? '' : (await state('tower.blade', 'burl.boars')) + ' ' + log.join(' ; ').slice(0, 300) };
  });
  await beat('5 kill the five boars -> burl.boars ready', async () => {
    for (const id of ['boar1', 'boar2', 'boar3', 'boar4', 'boar5']) {
      const r = await ev(`(() => { const h = __t.w.get(${JSON.stringify(id)}); return h ? [h.data.transform.x, h.data.transform.y] : null; })()`);
      if (r) await tpA(r[0] - 2, r[1]); await emitHit(id); await pause(300);
    }
    const ok = await waitFor(async () => (await stOf('burl.boars')) === 3, 6000);
    return { ok, why: await state('burl.boars') };
  });
  await beat('6 Burl: hand in the boar quest', async () => {
    const log = await talk('bear', ['follow|stone|show|lead|come|yes|ok']);
    const ok = (await done('burl.boars')) && await flag('quest.burl.boars.done');
    return { ok, why: ok ? '' : (await state('burl.boars')) + ' ' + log.join(' ; ').slice(0, 300) };
  });
  await beat('7 walk to the waystone with Burl (burl.arrived), wake the stone', async () => {
    let arrived = false; // she walks only while the player is within ~14 m of her: stay a few metres ahead of her along the way
    for (let i = 0; i < 80 && !arrived; i++) {
      const b = await ev("(() => { const t = __t.w.get('bear').data.transform; return [t.x, t.y, __t.w.state['burl.phase']]; })()");
      if (b[2] >= 2) { arrived = true; break; }
      await tpA(b[0] - 4, b[1] + 1); await pause(1200);
    }
    if (!arrived) return { ok: false, why: 'Burl never reached the stone; phase=' + await ev("__t.w.state['burl.phase']") };
    let woken = false;
    for (let i = 0; i < 5 && !woken; i++) {
      if (await ev('__t.D.dialogue.open')) await evA('__t.dlg(["ok|yes|thanks"])'); // her arrival talk absorbs the key
      await goIx('stone.waystone', 1.2); await pressE(1);
      woken = await waitFor(async () => (await mainDone()).includes('"waystone"'), 4000);
    }
    // wake -> chapter card -> journal note (modal, ch1Hidden pauses the notice timer) -> close note with E -> notice runs ~4.3 s -> Burl's departure talk. By design, not a game bug.
    for (let i = 0; i < 90; i++) {
      const st = await evA("(async () => { const nr = await import('/game/js/quest/noteRead.js'); return [nr.isNoteOpen(), !!(__t.D.notice && __t.D.notice.active), !!__t.D.dialogue.open]; })()");
      if (st[2]) break;
      if (st[0]) await pressE(1); else if (st[1]) await ev('(() => { for (let k = 0; k < 4; k++) __t.D.notice.update(10, false); return true; })()'); // ?voxelbench=0 is a capture-like page (ch1Hidden always true: notice timer never runs) -> drain it by hand
      else if (i > 12) break;
      await pause(500);
    }
    return { ok: woken && (await mainDone()).includes('follow'), why: woken ? '' : 'waystone not woken ' + await mainDone() };
  });
  await beat('8 Burl says goodbye and goes home (burl.home)', async () => {
    let log = [];
    if (await waitFor(() => ev('__t.D.dialogue.open'), 30000)) log = await evA('__t.dlg(["bye|go|home|farewell|ok|yes|thanks"])'); // her departure talk opens by itself once the wake notice is gone
    else log = await talk('bear', ['bye|go|home|farewell|ok|yes|thanks']).catch((e) => ['(talk: ' + e.message + ')']);
    const ok = await waitFor(() => flag('burl.home'), 90000, 1000);
    const dbg = ok ? '' : await evA(`(async () => { const D = __t.D, w = __t.w, t = D.playerHandle.data.transform, b = w.get('bear').data.transform, nr = await import('/game/js/quest/noteRead.js'); return JSON.stringify({ note: nr.isNoteOpen(), noteId: nr.getOpenNoteId(), notice: D.notice && D.notice.active, dlg: D.dialogue.open, ui: D.uiLocked, ist: w.interaction.targetKey, bearIx: !!__t.ix('npc.bear'), dist: Math.hypot(t.x - b.x, t.y - b.y), pos: [t.x, t.y], bear: [b.x, b.y], hidden: D.ch1Hidden && D.ch1Hidden(), map: D.isMapOpen(), inv: D.invView && D.invView.isOpen, ql: D.questLogOpen && D.questLogOpen(), lock: D.look.locked, dead: D.vitals.dead, wake: D.wakeOut.inputLocked }); })()`);
    return { ok, why: ok ? '' : 'burl.home not set: phase=' + await ev("__t.w.state['burl.phase']") + ' ' + log.join(' ; ').slice(0, 100) + ' ' + dbg };
  });

  // ===== Chapter 2: the road, the Bend relay, Rook, the ford =====
  await beat('9 road west + Bend relay found (roadWest, bendRelay)', async () => {
    await goTrig('roadWest', 'bendRelay');
    const m = await mainDone();
    return { ok: /"road"/.test(m) && /relayFound/.test(m), why: m };
  });
  await beat('10 Bend relay wakes (relay1), SOS pulse seen, knot read', async () => {
    await goIx('relay.ws_roadBend', 1.2); await pressE(1);
    const woken = await waitFor(() => flag('waystone.ws_roadBend.woken'), 15000);
    if (!woken) return { ok: false, why: 'relay did not wake after [E]' };
    const relay1 = (await mainDone()).includes('relay1');
    const pulse = await waitFor(() => flag('relay.bend.pulseSeen'), 15000);
    await goIx('qi.knot', 0.9); await pressE(2);
    const knot = await waitFor(() => flag('lore.knot.read'), 4000);
    return { ok: relay1 && pulse && knot, why: `relay1=${relay1} pulse=${pulse} knot=${knot}` };
  });
  await beat('11 Rook: Bend call (mq.bend.call) accepted + handed in', async () => {
    const ok = await giverStep('rook', 4, 'mq.bend.call', ['call|pulse|knot|seen|yes|ok|read|report']);
    return { ok, why: await state('mq.bend.call', 'mq.river.road', 'mq.ford.stones') };
  });
  await beat('12 river bank + ford stones (mq.river.road, mq.ford.stones)', async () => {
    await goTrig('riverBank', 'fordWest');
    const ok = (await done('mq.river.road')) && (await done('mq.ford.stones'));
    return { ok, why: await state('mq.river.road', 'mq.ford.stones', 'mq.ford.mirror') };
  });
  await beat('13 mirror: Rook gives mq.ford.mirror, take relay.mirror from the nest', async () => {
    const acc = await giverStep('rook', 2, 'mq.ford.mirror', ['mirror|glass|yes|ok|will|fetch']); // the nest pickup is next to Rook: an [E] during the talk may already take the mirror
    if (!acc) return { ok: false, why: 'mq.ford.mirror not accepted ' + await state('mq.ford.mirror') + ' mirror in pack=' + await ev("__t.has('relay.mirror')") + ' log ' + lastLog };
    if (!(await ev("__t.has('relay.mirror') > 0"))) await goIx('qp.nest', 0.9); const has = await waitFor(async () => { if (await ev("__t.has('relay.mirror') > 0")) return true; await pressE(1); return false; }, 6000, 100);
    return { ok: has, why: `mirror=${has} ${await state('mq.ford.mirror')}` };
  });
  await beat('14 Ford relay wakes -> mq.ford.mirror done', async () => {
    await goIx('relay.ws_ford', 1.2); await pressE(1);
    const woken = await waitFor(() => flag('waystone.ws_ford.woken'), 15000);
    const ok = woken && await waitFor(() => done('mq.ford.mirror'), 6000);
    return { ok, why: `woken=${woken} ${await state('mq.ford.mirror')} log ${lastLog}` };
  });

  // ===== errands: one per template kind (quest book status) =====
  await ev(`(async () => { const D = __t.D, p = D.playerHandle.data, c = p.components, defs = window.ASSETS.items.defs;
    const inv = await import('/game/js/quest/sim/inventory.js'), qbm = await import('/game/js/quest/sim/quickbar.js'); const inventory = inv.ensureInventory(p, null);
    for (const [id, n] of [['arrow', 12], ['potion.hp', 2], ['bow', 1]]) if (!__t.has(id)) inv.addItem(inventory, defs, id, n); // test hook: the bow / arrows / potion come from loot later in the game
    qbm.ensureQuickbar(p); qbm.assign(p, defs, 5, 'potion.hp'); return true; })()`.replace(/^/, '')).catch(() => {});
  const errand = async (name, id, site, work, turnSite = site) => beat(name + ' (' + id + ')', async () => {
    if (!(await giverStep(site, 2, id))) return { ok: false, why: 'not accepted: ' + await state(id) + ' log ' + lastLog };
    await work();
    if (!(await giverStep(turnSite, 4, id))) return { ok: false, why: 'not handed in: ' + await state(id) };
    return true;
  });
  const areasOf = (id) => evA(`(async () => { const A = (await (await fetch('/content/quests/areas.json')).json()).areas, b = __t.D.saveRelay.quest.book; for (let i = 1; i < b.count; i++) if (b.def(i).id === ${JSON.stringify(id)}) return b.def(i).objectives.filter((o) => o.when.type === 'area').map((o) => (A[o.when.id] && A[o.when.id].trigger) || o.when.id); return []; })()`);
  await errand('E2 collect + deliver six blue berries', 'sq.burl.blue', 'burl', async () => {
    for (let i = 1; i <= 6; i++) { await goIx('qp.berry' + i, 0.7); await pressE(1); }
  });
  await errand('E1 explore', 'sq.burl.tower', 'burl', async () => { for (const a of await areasOf('sq.burl.tower')) await goTrig(a); await pause(500); });
  await errand('E3 talk (ask Burl for Rook)', 'sq.fc.ask', 'rook', async () => { await talk('bear', ['ok|yes|bear|crow|ask']); });
  await errand('E4 deliver a brass scrap from Rook to Burl', 'sq.rook.gift', 'rook', async () => { await goIx('qp.brass1', 0.7); await pressE(1); }, 'burl');
  await errand('E5 escort Burl to the Bend relay', 'sq.burl.walk', 'burl', async () => {
    for (let i = 0; i < 120; i++) {
      if (await flag('escort.bear.relayBend') || (await ev("__t.w.state['burl.phase']")) === 7) break;
      const b = await ev("(() => { const t = __t.w.get('bear').data.transform; return [t.x, t.y]; })()");
      await tpA(b[0] - 5, b[1]); await pause(1200);
    }
  });
  await beat('E6 target hits (sq.nub then sq.straw: three straw men)', async () => {
    const nub = await giverStep('burl', 2, 'sq.tm.nub');
    for (const a of await areasOf('sq.tm.nub')) await goTrig(a);
    await giverStep('burl', 4, 'sq.tm.nub');
    if (!(await giverStep('notePost', 2, 'sq.straw'))) return { ok: false, why: 'sq.straw not accepted: ' + await state('sq.tm.nub', 'sq.straw') };
    for (const id of ['target1', 'target2', 'target3']) { const r = await ev(`(() => { const h = __t.w.get(${JSON.stringify(id)}); return h ? [h.data.transform.x, h.data.transform.y] : null; })()`); if (r) await tpA(r[0] - 4, r[1]); await emitHit(id); await pause(300); }
    const ok = await giverStep('notePost', 4, 'sq.straw');
    return { ok, why: ok ? '' : await state('sq.tm.nub', 'sq.straw') };
  });

  // ===== AC2: gear shows on the player =====
  await beat('AC2 gear shows (equipment + view model)', async () => {
    const g = await ev(`(() => { const D = __t.D, c = D.playerHandle.data.components; return { main: c.equipment.main, off: c.equipment.off, left: c.inventory.left, right: c.inventory.right, vm: !!(D.vmHandles && D.vmHandles.sword) }; })()`);
    return { ok: g.main === 'sword' && (g.left === 'sword' || g.right === 'sword'), why: JSON.stringify(g) };
  });

  // ===== AC3: save -> reload + Continue =====
  let before;
  await beat('AC3a save (rest/save path)', async () => {
    await ev('__t.D.gameHooks.ctx.requestSave()'); await pause(800); before = await ev('__t.snap()');
    const len = await ev("(localStorage.getItem('kestrel.save.slot.0') || '').length");
    return { ok: len > 0, why: 'slot bytes ' + len };
  });
  await beat('AC3b Continue restores position, hearts, items, gear, quick bar, quests, flags', async () => {
    warns.length = 0;
    // voxelbench=0 is a capture-like page (no title menu): reload on the normal page and press Continue on the title card
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?save=1&backend=webgpu` });
    if (!(await waitFor(() => ev('typeof __debug !== "undefined" && !!(__debug.menuHost && __debug.menuHost.active)'), 15000))) return { ok: false, why: 'title menu never showed' };
    await ev("(() => { const h = __debug.menuHost, m = h.menu; for (let n = 0; n < 6 && m.snapshot().rows[m.snapshot().selected].id !== 'continue'; n++) m.handleKey('ArrowDown'); m.handleKey('Enter'); h.consume(); return JSON.stringify(m.snapshot().rows.map((r) => r.id + ':' + r.enabled)); })()"); 
    if (!(await waitFor(() => ev('!__debug.menuHost || !__debug.menuHost.active'), 15000))) return { ok: false, why: 'Continue did not close the menu' };
    await waitFor(() => ev('typeof __debug !== "undefined" && !!(__debug.playerHandle && __debug.playerHandle.data.components.health && __debug.saveRelay)'), 20000); await waitFor(() => ev('!!(__debug.saveRelay.quest && __debug.saveRelay.quest.book)'), 20000); await pause(2500); await ev(LIB);
    const after = await ev('__t.snap()');
    const canon = (v) => (v && typeof v === 'object') ? (Array.isArray(v) ? v.map(canon) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))) : v;
    const diffs = [];
    if (!before.pos.every((v, i) => Math.abs(v - after.pos[i]) <= 0.05)) diffs.push('pos ' + before.pos + ' -> ' + after.pos);
    for (const k of ['hp', 'max', 'inventory', 'equipment', 'quickbar', 'main', 'quests', 'tracked', 'dead', 'chests']) if (JSON.stringify(canon(before[k])) !== JSON.stringify(canon(after[k]))) diffs.push(k + ' ' + JSON.stringify(before[k]).slice(0, 120) + ' -> ' + JSON.stringify(after[k]).slice(0, 120));
    for (const k of new Set([...Object.keys(before.state), ...Object.keys(after.state)])) if (JSON.stringify(before.state[k]) !== JSON.stringify(after.state[k])) diffs.push('state.' + k + ' ' + JSON.stringify(before.state[k]) + ' -> ' + JSON.stringify(after.state[k]));
    return { ok: diffs.length === 0, why: diffs.slice(0, 6).join(' ; ') + (diffs.length ? ' || warns: ' + warns.slice(0, 4).join(' | ') : '') };
  });
  await beat('no console errors', async () => ({ ok: errors.length === 0, why: errors.slice(0, 3).join(' | ') }));
} catch (e) {
  rec('harness', false, String(e && e.stack || e).slice(0, 600));
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
  const fails = rows.filter((r) => !r.ok);
  console.log('\n' + 'beat'.padEnd(64) + 'result'); for (const r of rows) console.log(r.name.padEnd(64) + (r.ok ? 'PASS' : 'FAIL ' + r.why));
  console.log(fails.length ? `Ch1-2 run: ${fails.length} FAIL` : 'Ch1-2 run: all beats PASS');
  if (fails.length) process.exitCode = 1;
}
