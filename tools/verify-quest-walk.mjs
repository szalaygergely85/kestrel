// QUEST-WALK-OWNER prep: real-game route walk of the opening chain + 3 side quests, asserting the quest marks and the compass at every step.
// Chain: wake -> note/sword/tower door -> Burl blade hand-in -> boars -> follow -> waystone -> Burl stone hand-in -> road -> Bend relay -> Rook hand-in.
// Side:  sq.burl.blue (blue '!', fetch/collect+deliver), sq.burl.boars.w (kill), sq.burl.meat (fetch) - all from Burl.
// Per step: '!' over the right character in the right colour before accept (gold = main chain, blue = side), compass needle (D-108: a READY giver first,
// else the tracked quest's step, else an available giver) points at the expected spot, '?' over the hand-in character when READY, marks gone after hand-in.
// Movement = dev hooks (teleport like real travel, kills as combat:hit events); talk / accept / hand-in = REAL KeyE presses + the dialogue runner. Stills: docs/test-reports/quest-walk/.
// The page-side helpers (window.__t) are adapted from tools/verify-ch12-run.mjs. Run: node tools/verify-quest-walk.mjs <port 9500-9999>  (CDP = port+1). Exit 1 on any FAIL.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9580);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B port range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-qwalk-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const url = `http://127.0.0.1:${port}/game/index.html?voxelbench=0&save=1&nopause=1&title=0&backend=webgpu`;
const OUT = path.join(ROOT, 'docs', 'test-reports', 'quest-walk'); mkdirSync(OUT, { recursive: true });
const rows = [], errors = []; let browser, cdp, curBeat = 'start';
const ev = (js) => evaluate(cdp, js);
const evA = (js) => evaluateAsync(cdp, js);
const killer = setTimeout(() => { console.error('verify-quest-walk timeout'); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid); process.exit(2); }, 2400000);

// ---- reporting ----
function check(name, ok, why) { rows.push({ beat: curBeat, name, ok: !!ok }); console.log((ok ? '  PASS ' : '  FAIL ') + name + (ok ? '' : '  - ' + why)); return !!ok; }
async function still(name) { try { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); const f = name.replace(/[^a-z0-9._-]+/gi, '-') + '.png'; writeFileSync(path.join(OUT, f), Buffer.from(r.data, 'base64')); return f; } catch (e) { return null; } }
const dump = async () => { try { console.log('    DUMP ' + await ev(`(() => { const D = __t.D, t = D.playerHandle.data.transform, h = D.playerHandle.data.components.health; return JSON.stringify({ pos: [t.x, t.y, t.z].map((v) => Math.round(v)), dead: D.vitals && D.vitals.dead, hp: h && h.hp, dlg: !!D.dialogue.open, completed: D.saveRelay.quest.state.completed, bend: __t.flag('waystone.ws_roadBend.woken'), pulse: __t.flag('relay.bend.pulseSeen'), burlHome: __t.flag('burl.home'), mq: __t.st('mq.bend.call'), burl: __t.st('sq.burl.blue') }); })()`)); } catch (e) { console.log('    DUMP failed ' + e.message); } };
async function beat(name, fn) { curBeat = name; console.log('== ' + name); await dump(); try { await fn(); } catch (e) { check('beat ran without throwing', false, String(e && e.message || e).slice(0, 400)); } }

// ---- page-side helper library (adapted from verify-ch12-run.mjs) ----
const LIB = `(() => { const D = window.__debug, w = D.world, p = D.playerHandle.data, t = p.transform, c = p.components, sl = (ms) => new Promise((r) => setTimeout(r, ms));
  const book = () => D.saveRelay.quest.book;
  const T = window.__t = { D, w, sl,
    st: (id) => book().statusOf(id),
    ix: (k) => w.interactables.find((r) => r.key === k),
    trig: (id) => w.triggers.find((r) => r.key === 'world.' + id),
    flag: (k) => !!w.state[k] || !!D.saveRelay.quest.state.flags[k],
    has: (id) => { let n = 0; for (const s of c.inventory.slots) if (s && s.id === id) n += s.n || 1; return n; },
    // position of a giver / prop by entity id (tries the id, then 'tower.'+id for level props)
    pos(id) { let h = null; for (const k of [id, 'tower.' + id]) { try { h = w.get(k); } catch (e) { h = null; } if (h) break; } const q = h && h.data && h.data.transform; return q ? [q.x, q.y, q.z] : null; },
    async tp(x, y, dz = 0.6, zAbs) { let g = w.floorAt(x, y); if (zAbs !== undefined) g = zAbs - dz; t.x = x; t.y = y; t.z = (g == null ? t.z + 3 : g + dz); c.body.vx = c.body.vy = c.body.vz = 0; D.vitals.clearSafe(); D.look.locked = true; await sl(450);
      if (zAbs === undefined) { g = w.floorAt(x, y); if (g != null && Math.abs(t.z - g) > 3) { t.z = g + dz; await sl(250); } } },
    face(r) { const dx = r.x - t.x, dy = r.y - t.y, dz = (r.z || 0) - (t.z + (c.body.eyeH || 1.6)), h = Math.hypot(dx, dy) || 1e-6;
      const yaw = Math.atan2(dx, -dy) * 180 / Math.PI, pitch = Math.atan2(dz, h) * 180 / Math.PI; D.look.yawDeg = yaw; D.look.pitchDeg = pitch; t.yawDeg = yaw; t.pitchDeg = pitch; },
    async goIx(k, off = 0.9, from) { const r = T.ix(k); if (!r) throw new Error('no interactable ' + k);
      if (from) { const dx = r.x - from.x, dy = r.y - from.y, n = Math.hypot(dx, dy) || 1; await T.tp(r.x - dx / n * off, r.y - dy / n * off, 0.3, from.z); } else await T.tp(r.x - off, r.y); T.face(T.ix(k)); await sl(150); return r; },
    async goNpc(id, off = 1.2) { const e = w.get(id).data.transform; for (let n = 0, px = e.x, py = e.y; n < 20; n++) { await sl(500); if (Math.hypot(e.x - px, e.y - py) < 0.02) break; px = e.x; py = e.y; }
      const g0 = w.floorAt(e.x - off, e.y);
      if (g0 == null || Math.abs(g0 - e.z) > 0.15) await T.tp(e.x - off, e.y, 0.3, e.z + 0.3); else await T.tp(e.x - off, e.y); T.face({ x: e.x, y: e.y, z: e.z + 1.2 }); await sl(150); return true; },
    async marker(id) { const { localToWorld } = await import('/engine/core/transform.js'); const o = { x: 0, y: 0, z: 0 };
      for (const st of w.structures) { const m = st.level && st.level.def && st.level.def.markers && st.level.def.markers[id]; if (m) { localToWorld(st.frame, m.x, m.y, m.z || 0, o); return { x: o.x, y: o.y, z: o.z }; } } return null; },
    async goTrig(id) { const r = T.trig(id); if (!r) throw new Error('no trigger ' + id); await T.tp(r.x, r.y); await sl(500); return r; },
    async dlg(prefs = []) { const r = D.dialogue.runner, log = []; T.seen = []; for (let n = 0; n < 400 && D.dialogue.open; n++) { if (r.state === 'typing' && r.line && T.seen[T.seen.length - 1] !== r.line) T.seen.push(String(r.line).slice(0, 40));
        if (r.state === 'choosing') { const ch = []; for (let i = 0; i < r.choiceCount; i++) ch.push(String(r.choiceText(i))); let k = 0;
          out: for (const q of prefs) for (let i = 0; i < ch.length; i++) if (new RegExp(q, 'i').test(ch[i])) { k = i; break out; }
          log.push('[' + ch.join(' | ') + '] -> ' + k); r.selected = k; r.choose(); } else r.press();
        await sl(50); } await sl(300); return log; } };
  return true; })()`;

// ---- E / talk / tp helpers ----
const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k.length === 1 ? k : undefined }); await pause(70); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); await pause(120); };
async function pressE(n = 1) { for (let i = 0; i < n; i++) { await key('KeyE', 'e'); await pause(450); } }
const stOf = (id) => ev(`__t.st(${JSON.stringify(id)})`);
const NAMES = ['unavailable', 'available', 'active', 'ready', 'done'];
const flag = (k) => ev(`__t.flag(${JSON.stringify(k)})`);
const mainDone = () => ev('JSON.stringify(__t.D.saveRelay.quest.state.completed)');
async function waitFor(fn, ms, step = 400) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await pause(step); } return false; }
async function goIx(k, off = 0.9) { await evA(`(async () => { await __t.goIx(${JSON.stringify(k)}, ${off}); return true; })()`); }
async function goTrig(...ids) { for (const id of ids) await evA(`(async () => { await __t.goTrig(${JSON.stringify(id)}); return true; })()`); }
const tpA = (x, y) => evA(`(async () => { await __t.tp(${x}, ${y}); return true; })()`);
const emitHit = (target) => ev(`(() => { __t.D.engine.events.emit('combat:hit', { target: ${JSON.stringify(target)}, damage: 999, source: 'player', cause: 'sword' }); return true; })()`);
let lastLog = [];
// stand next to the npc, press the real E, run the dialogue (choices picked by regex prefs)
async function talk(id, prefs = []) {
  await ev('(() => { for (let k = 0; k < 4; k++) __t.D.notice.update(10, false); return true; })()'); // capture-like page never advances the notice timer
  await evA(`__t.goNpc(${JSON.stringify(id)})`); await pause(300);
  let open = await ev('__t.D.dialogue.open');
  for (let i = 0; i < 3 && !open; i++) { if (i > 0) { await evA(`__t.goNpc(${JSON.stringify(id)}, ${[1.2, -1.2, 2.2][i]})`); await pause(200); } await pressE(1); open = await ev('__t.D.dialogue.open'); }
  if (!open) return (lastLog = ['(no dialogue opened)']);
  return (lastLog = await evA(`__t.dlg(${JSON.stringify(prefs)})`));
}
const YES = ['ok|yes|will|do it|i.ll|take|accept|sure|done|here|ready|deliver|thanks|follow|boar|help'];
// talk to `npc` until quest `id` reaches status >= want (a giver offers one available errand per talk)
async function talkUntil(npc, id, want, prefs = YES, max = 9) { for (let i = 0; i < max; i++) { if ((await stOf(id)) >= want) return true; await talk(npc, prefs); } return (await stOf(id)) >= want; }

// ---- mark / compass assertions ----
const marks = async () => JSON.parse(await ev(`(() => { const b = __t.D.saveRelay.quest.book, gA = [], gR = [], sA = [], sR = []; b.markLists(gA, gR, sA, sR); return JSON.stringify({ gA, gR, sA, sR }); })()`));
const needle = async () => JSON.parse(await ev(`(() => { const t = __t.D.compassRetarget(); return JSON.stringify(t ? { x: t.x, y: t.y, kind: t.kind } : null); })()`));
const posOf = async (id) => JSON.parse(await ev(`JSON.stringify(__t.pos(${JSON.stringify(id)}))`));
const NK = { 1: "ready '?'", 2: 'step', 3: "available '!'" };
/** mark `where` ('gA' gold '!', 'gR' gold '?', 'sA' blue '!', 'sR' blue '?') over character `id`: present or absent */
async function markCheck(where, id, present, label) {
  const m = await marks(); const has = m[where].includes(id), other = ['gA', 'gR', 'sA', 'sR'].filter((k) => k !== where && m[k].includes(id));
  return check(label || `${where} (${{ gA: "gold '!'", gR: "gold '?'", sA: "blue '!'", sR: "blue '?'" }[where]}) ${present ? 'over' : 'not over'} ${id}`, has === present, `lists ${JSON.stringify(m)}` + (present && other.length ? ' (wrong colour/kind: ' + other.join(',') + ')' : ''));
}
/** compass needle: kind (1 ready, 2 step, 3 available) and, when `at` (entity id) is given, within 2.5 m of that entity */
async function needleCheck(kind, at, label) {
  const n = await needle(); let ok = !!n && [].concat(kind).includes(n.kind), why = 'needle ' + JSON.stringify(n);
  if (ok && at) { const p = await posOf(at); ok = !!p && Math.hypot(n.x - p[0], n.y - p[1]) < 2.5; why += ' expected near ' + at + ' ' + JSON.stringify(p); }
  return check(label || `compass needle: ${NK[kind]}${at ? ' at ' + at : ''}`, ok, why);
}
/** show the moment: stand `off` m from the character facing it, wait a beat, save a still */
async function momentStill(npc, name, off = 5) { await evA(`__t.goNpc(${JSON.stringify(npc)}, ${off})`); await pause(900); return still(name); }
const state = async (...ids) => { const o = {}; for (const id of ids) o[id] = NAMES[await stOf(id)]; return JSON.stringify(o); };

async function openGame() {
  await cdp.send('Page.navigate', { url });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await ev('!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.saveRelay && window.__debug.relayWake && window.__debug.dialogue && window.__debug.compassRetarget && window.__debug.playerHandle.data.components.health)')) { ready = true; break; } }
  if (!ready) throw new Error('game never ready: ' + JSON.stringify(errors));
  await pause(1500); await ev(LIB);
}

try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(JSON.stringify(p.exceptionDetails).slice(0, 300));
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push((p.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await openGame();
  if (!(await ev("localStorage.getItem('kestrel.save.slot.0') === null"))) throw new Error('profile not fresh (New Game expected)');

  // ===== opening chain =====
  await beat('1 wake; tower.blade offered (gold "!" over the note, needle at the note)', async () => {
    await ev("(__t.w.state['quest.wakeT'] = 100, true)"); await pause(1500); await ev('(__t.D.playerHandle.data.components.body.eyeH = __t.D.engine.physics.eyeHeight, true)');
    const wk = await waitFor(async () => (await mainDone()).includes('"wake"'), 8000); if (!wk) console.log('    DIAG-WAKE wakeT=' + await ev("JSON.stringify([__t.w.state['quest.wakeT'], performance.now(), document.hidden, document.visibilityState, Object.keys(__t.D), __t.w.state['quest.wakeT'], Object.keys(__t.w.state).slice(0, 40)])")); const fr = await evA("new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 1000) r([n, Math.round(performance.now() - t0)]); else requestAnimationFrame(f); }; requestAnimationFrame(f); })"); console.log('    DIAG-RAF ' + JSON.stringify(fr) + ' ERR ' + JSON.stringify(errors.slice(0, 5)) + ' loop ' + JSON.stringify(await ev('(() => { const l = __t.D.loop; return JSON.stringify(Object.keys(l).map((k) => [k, typeof l[k] === "function" ? "f" : l[k]])); })()')) + ' ' + await ev('JSON.stringify([__t.D.look.locked, !!__t.D.dialogue.open, __t.D.vitals.inputLocked, __t.D.wakeOut])'));
    check('wake step done', wk, 'main ' + await mainDone());
    check('tower.blade available', (await stOf('tower.blade')) === 1, await state('tower.blade'));
    await markCheck('gA', 'noteKeepLight', true, "gold '!' over the key-keeper note (object giver)");
    await needleCheck([2, 3], undefined, "needle at the note (wake step or available '!')");
    await evA("(async () => { await __t.goIx('tower.noteKeepLight', 3.0); return true; })()"); await pause(800); await still('01-blade-offer-bang-on-note');
  });
  await beat('2 read the note: tower.blade accepted, "!" gone, tracked', async () => {
    await goIx('tower.noteKeepLight', 0.8); await pause(300);
    for (let i = 0; i < 3 && (await stOf('tower.blade')) < 2; i++) await pressE(1);
    await key('Escape', 'Escape');
    check('tower.blade accepted', (await stOf('tower.blade')) >= 2, await state('tower.blade'));
    await markCheck('gA', 'noteKeepLight', false, "gold '!' gone from the note after accept");
    check('tower.blade is the tracked quest', await ev("__t.D.saveRelay.quest.book.def(__t.D.saveRelay.quest.book.tracked()).id === 'tower.blade'"), 'tracked ' + await ev("__t.D.saveRelay.quest.book.tracked()"));
    await needleCheck(2, undefined, 'needle: tracked quest step target');
    await still('02-blade-accepted-needle-step');
  });
  await beat('3 sword + tower door: tower.blade READY, gold "?" over Burl, needle at Burl', async () => {
    await evA("(async () => { const m = await __t.marker('breach'); await __t.tp(m.x, m.y, 0.3); await __t.sl(500); return true; })()");
    const bm = await evA("__t.marker('breach')"); await evA(`(async () => { await __t.goIx('tower.sword', 0.8, ${JSON.stringify(bm)}); return true; })()`);
    await waitFor(async () => { if (await ev("__t.has('sword') > 0 || __t.D.saveRelay.quest.state.items.includes('sword')")) return true; await pressE(1); return false; }, 6000, 100);
    await goTrig('towerDoor'); await pause(600);
    check('tower.blade READY', (await stOf('tower.blade')) === 3, await state('tower.blade'));
    await markCheck('gR', 'bear', true, "gold '?' over Burl (READY hand-in)");
    await needleCheck(1, 'bear', "needle at Burl (ready '?')");
    await momentStill('bear', '03-blade-ready-question-on-burl'); await still('03b-blade-ready-needle');
  });
  await beat('4 Burl: hand in the blade; "?" gone; boars offered/accepted', async () => {
    await talk('bear', YES);
    check('tower.blade done', (await stOf('tower.blade')) === 4, await state('tower.blade') + ' ' + lastLog.join(';').slice(0, 200));
    await markCheck('gR', 'bear', false, "gold '?' gone from Burl after the hand-in");
    await talkUntil('bear', 'burl.boars', 2);
    check('burl.boars accepted', (await stOf('burl.boars')) >= 2, await state('burl.boars'));
    await markCheck('gA', 'bear', false, "gold '!' gone from Burl once burl.boars is accepted");
    await needleCheck(2, undefined, 'needle: boars step target (D-108: tracked quest)');
    const nb = await needle(); const boars = JSON.parse(await ev("JSON.stringify(['boar1','boar2','boar3','boar4','boar5'].map((i) => __t.pos(i)).filter(Boolean))"));
    check('needle sits on a living boar', !!nb && boars.some((b) => Math.hypot(nb.x - b[0], nb.y - b[1]) < 2.5), JSON.stringify(nb) + ' boars ' + JSON.stringify(boars));
    await still('04-boars-accepted-needle-on-boar');
  });
  await beat('5 five boars dead: burl.boars READY, gold "?" over Burl', async () => {
    for (const id of ['boar1', 'boar2', 'boar3', 'boar4', 'boar5']) { const r = await ev(`(() => { const h = __t.w.get(${JSON.stringify(id)}); return h ? [h.data.transform.x, h.data.transform.y] : null; })()`); if (r) await tpA(r[0] - 2, r[1]); await emitHit(id); await pause(300); }
    check('burl.boars READY', await waitFor(async () => (await stOf('burl.boars')) === 3, 6000), await state('burl.boars'));
    await markCheck('gR', 'bear', true, "gold '?' over Burl (boars READY)");
    await needleCheck(1, 'bear', "needle at Burl (ready '?')");
    await momentStill('bear', '05-boars-ready-question-on-burl');
  });
  await beat('6 Burl: hand in the boars; marks gone; burl.follow accepted', async () => {
    await talk('bear', YES);
    check('burl.boars done', (await stOf('burl.boars')) === 4, await state('burl.boars') + ' ' + lastLog.join(';').slice(0, 200));
    await markCheck('gR', 'bear', false, "gold '?' gone from Burl after the boars hand-in");
    await talkUntil('bear', 'burl.follow', 2);
    check('burl.follow accepted', (await stOf('burl.follow')) >= 2, await state('burl.follow'));
    await needleCheck(2, undefined, 'needle: follow step target');
    await still('06-follow-accepted-needle');
  });
  await beat('7 follow Burl to the stone, wake it; burl.stone READY, gold "?" over Burl', async () => {
    let arrived = false;
    for (let i = 0; i < 200 && !arrived; i++) { const b = await ev("(() => { const t = __t.w.get('bear').data.transform; return [t.x, t.y, __t.w.state['burl.phase']]; })()"); if (b[2] >= 2) { arrived = true; break; } await tpA(b[0] - 4, b[1] + 1); await pause(1200); }
    check('Burl reached the stone', arrived, 'phase ' + await ev("__t.w.state['burl.phase']"));
    check('burl.follow done / burl.stone accepted by the arrival', (await stOf('burl.follow')) === 4 || (await stOf('burl.stone')) >= 2, await state('burl.follow', 'burl.stone'));
    // Burl's stone talk (sets dlg.bear.stone.told, the gate for waking the stone) opens by itself on arrival; else start it with E
    for (let i = 0; i < 4 && !(await flag('dlg.bear.stone.told')); i++) {
      if (!(await waitFor(() => ev('__t.D.dialogue.open'), i ? 3000 : 20000))) await talk('bear', YES); else await evA('__t.dlg(["ok|yes|thanks|stone|wake"])');
      await pause(500);
    }
    check('Burl stone talk done (told)', await flag('dlg.bear.stone.told'), 'dlg.bear.stone.told unset');
    let woken = false;
    for (let i = 0; i < 5 && !woken; i++) {
      if (await ev('__t.D.dialogue.open')) await evA('__t.dlg(["ok|yes|thanks"])');
      await goIx('stone.waystone', 1.2); await pressE(1);
      woken = await waitFor(async () => (await mainDone()).includes('"waystone"'), 4000);
    }
    if (!woken) console.log('    WS-DIAG ' + await ev(`JSON.stringify({ attuned: __t.flag('aether.attuned'), told: __t.flag('dlg.bear.stone.told'), ixs: __t.w.interactables.map((r) => [r.key, Math.round(r.x), Math.round(r.y), r.prompt]).filter((r) => /stone|waystone|relay/i.test(r[0])), me: [__t.D.playerHandle.data.transform.x, __t.D.playerHandle.data.transform.y], dlg: !!__t.D.dialogue.open })`));
    check('waystone woken', woken, await mainDone());
    // read the book state right after the wake (before Burl's departure talk can start): stone READY, '?' over Burl
    check('burl.stone READY', (await stOf('burl.stone')) === 3, await state('burl.stone'));
    await markCheck('gR', 'bear', true, "gold '?' over Burl (stone READY)");
    await needleCheck(1, 'bear', "needle at Burl (ready '?')");
    await still('07-stone-ready-question-needle');
  });
  await beat('8 Burl: stone hand-in (departure talk) -> burl.stone done, marks gone, burl.home', async () => {
    for (let i = 0; i < 90; i++) { // wake -> chapter card -> journal note -> close with E -> notice -> Burl's departure talk
      const st = await evA("(async () => { const nr = await import('/game/js/quest/noteRead.js'); return [nr.isNoteOpen(), !!(__t.D.notice && __t.D.notice.active), !!__t.D.dialogue.open]; })()");
      if (st[2]) break; if (st[0]) await pressE(1); else if (st[1]) await ev('(() => { for (let k = 0; k < 4; k++) __t.D.notice.update(10, false); return true; })()'); else if (i > 12) break; await pause(500);
    }
    if (await waitFor(() => ev('__t.D.dialogue.open'), 30000)) { const L = await evA('__t.dlg(["bye|go|home|farewell|ok|yes|thanks"])'); console.log('    S8-DLG auto ' + JSON.stringify(L) + ' depart=' + await flag('burl.depart')); } else { await talk('bear', YES); console.log('    S8-DLG talk ' + await ev('JSON.stringify(__t.seen)') + ' depart=' + await flag('burl.depart')); }
    check('burl.stone done', await waitFor(async () => (await stOf('burl.stone')) === 4, 8000), await state('burl.stone'));
    await markCheck('gR', 'bear', false, "gold '?' gone from Burl after the stone hand-in");
    // Burl walks off (depart) and comes home only once the player is far from her slope: that is checked after the road trip (step 10)
  });
  await beat('9 road west + Bend relay woken: mq.bend.call offered (gold "!" over Rook, needle at Rook)', async () => {
    await goTrig('roadWest', 'bendRelay');
    await goIx('relay.ws_roadBend', 1.2); await pressE(1);
    check('Bend relay woken', await waitFor(() => flag('waystone.ws_roadBend.woken'), 15000), 'not woken');
    await waitFor(() => flag('relay.bend.pulseSeen'), 15000);
    await goIx('qi.knot', 0.9); await pressE(2); await waitFor(() => flag('lore.knot.read'), 4000);
    check('mq.bend.call available', (await stOf('mq.bend.call')) >= 1, await state('mq.bend.call'));
    await markCheck('gA', 'rook', true, "gold '!' over Rook (main-chain offer)");
    await needleCheck(3, 'rook', "needle at Rook (available '!')");
    await momentStill('rook', '09-bend-call-offer-bang-on-rook', 4);
  });
  await beat('10 Rook: accept, "?" over Rook, hand in, marks gone', async () => {
    const acc = await talkUntil('rook', 'mq.bend.call', 2, ['call|pulse|knot|seen|yes|ok|read|report']);
    check('mq.bend.call accepted', acc, await state('mq.bend.call'));
    const s = await stOf('mq.bend.call');
    if (s === 3) { await markCheck('gR', 'rook', true, "gold '?' over Rook (READY)"); await needleCheck(1, 'rook', "needle at Rook (ready '?')"); await momentStill('rook', '10-bend-call-ready-question-on-rook', 4); }
    else if (s === 4) check("READY '?' not observable: accepted + handed in within one talk (objectives were already met)", true, '');
    else check('mq.bend.call READY after accept (pulse + knot already done)', false, await state('mq.bend.call'));
    check('mq.bend.call done', await talkUntil('rook', 'mq.bend.call', 4, ['call|pulse|knot|seen|yes|ok|read|report']), await state('mq.bend.call'));
    await markCheck('gR', 'rook', false, "gold '?' gone from Rook after the hand-in");
    await markCheck('gA', 'rook', (await stOf('mq.river.road')) === 1, "'!' over Rook matches mq.river.road availability");
    await still('10b-rook-handed-in');
  });

  // ===== side quests (all from Burl; blue marks) =====
  await beat('S0 Burl home again (player far away), greeting talk sets burl.home.met (gate for her errands)', async () => {
    check('burl.home set (Burl went home)', await waitFor(() => flag('burl.home'), 90000, 1000), 'burl.home unset ' + await ev("JSON.stringify(['burl.phase', 'burl.depart', 'burl.departing', 'burl.home', 'dlg.bear.stone.told'].map((k) => [k, __t.w.state[k]]).concat([['dlgOpen', __t.D.dialogue.open]]))"));
    await talk('bear', ['bye|later|not now|leave|farewell|ok']);
    check('burl.home.met set by the greeting talk', await flag('burl.home.met'), lastLog.join(';').slice(0, 200));
  });
  await ev(`(async () => { const D = __t.D, p = D.playerHandle.data, defs = window.ASSETS.items.defs; const inv = await import('/game/js/quest/sim/inventory.js'); window.__invMod = inv; window.__inv = inv.ensureInventory(p, null); window.__defs = defs; return true; })()`);
  const give = (id, n) => evA(`(async () => { __invMod.addItem(__inv, __defs, ${JSON.stringify(id)}, ${n}); await __t.sl(1200); return true; })()`);
  await beat('S1 blue "!" side quest: sq.burl.blue (collect 6 + deliver)', async () => {
    check('sq.burl.blue available', (await stOf('sq.burl.blue')) === 1, await state('sq.burl.blue'));
    const m = await marks();
    check("Burl carries a BLUE '!' (side) and no gold '!'", m.sA.includes('bear') && !m.gA.includes('bear'), JSON.stringify(m));
    await needleCheck(3, undefined, "needle on an available giver (OB-183: main offers first, so Rook's gold '!' beats Burl's blue one)");
    await momentStill('bear', 'S1-blue-bang-on-burl');
    check('sq.burl.blue accepted via Burl\'s dialogue', await talkUntil('bear', 'sq.burl.blue', 2), await state('sq.burl.blue') + ' ' + lastLog.join(';').slice(0, 160));
    await ev("__t.D.saveRelay.quest.book.track('sq.burl.blue')");
    check('sq.burl.blue tracked', await ev("__t.D.saveRelay.quest.book.def(__t.D.saveRelay.quest.book.tracked()).id === 'sq.burl.blue'"), 'tracked other');
    await needleCheck(2, undefined, 'needle: tracked side quest step (D-108)');
    await still('S1-blue-accepted-needle');
    await give('berry.blue', 6);
    check('sq.burl.blue READY (6 sprigs)', await waitFor(async () => (await stOf('sq.burl.blue')) === 3, 6000), await state('sq.burl.blue'));
    await markCheck('sR', 'bear', true, "blue '?' over Burl (side READY)");
    await markCheck('gR', 'bear', false, "no gold '?' over Burl for a side quest");
    await needleCheck(1, 'bear', "needle at Burl (ready '?')");
    await momentStill('bear', 'S1-blue-ready-question-on-burl');
    check('sq.burl.blue done after hand-in', await talkUntil('bear', 'sq.burl.blue', 4), await state('sq.burl.blue') + ' ' + lastLog.join(';').slice(0, 160));
    await markCheck('sR', 'bear', false, "blue '?' gone from Burl after the hand-in");
  });
  await beat('S2 kill quest: sq.burl.boars.w (2 west boars; needs sq.burl.boars.n first)', async () => {
    check('sq.burl.boars.n accepted (prerequisite)', await talkUntil('bear', 'sq.burl.boars.n', 2), await state('sq.burl.boars.n'));
    for (const id of ['boarN1', 'boarN2', 'boarN3']) { const r = await ev(`(() => { const h = __t.w.get(${JSON.stringify(id)}); return h ? [h.data.transform.x, h.data.transform.y] : null; })()`); if (r) await tpA(r[0] - 2, r[1]); await emitHit(id); await pause(300); }
    check('sq.burl.boars.n done (prerequisite)', (await waitFor(async () => (await stOf('sq.burl.boars.n')) === 3, 6000)) && await talkUntil('bear', 'sq.burl.boars.n', 4), await state('sq.burl.boars.n'));
    check('sq.burl.boars.w accepted', await talkUntil('bear', 'sq.burl.boars.w', 2), await state('sq.burl.boars.w'));
    await ev("__t.D.saveRelay.quest.book.track('sq.burl.boars.w')");
    await needleCheck(2, undefined, 'needle: kill step target');
    const nb = await needle(); const boars = JSON.parse(await ev("JSON.stringify(['boarW1','boarW2'].map((i) => __t.pos(i)).filter(Boolean))"));
    check('needle sits on a living west boar', !!nb && boars.some((b) => Math.hypot(nb.x - b[0], nb.y - b[1]) < 2.5), JSON.stringify(nb) + ' boars ' + JSON.stringify(boars));
    if (boars[0]) { await tpA(boars[0][0] - 5, boars[0][1]); await still('S2-kill-accepted-needle-on-boar'); }
    for (const id of ['boarW1', 'boarW2']) { const r = await ev(`(() => { const h = __t.w.get(${JSON.stringify(id)}); return h ? [h.data.transform.x, h.data.transform.y] : null; })()`); if (r) await tpA(r[0] - 2, r[1]); await emitHit(id); await pause(300); }
    check('sq.burl.boars.w READY', await waitFor(async () => (await stOf('sq.burl.boars.w')) === 3, 6000), await state('sq.burl.boars.w'));
    await markCheck('sR', 'bear', true, "blue '?' over Burl (kill READY)");
    await needleCheck(1, 'bear', "needle at Burl (ready '?')");
    await momentStill('bear', 'S2-kill-ready-question-on-burl');
    check('sq.burl.boars.w done after hand-in', await talkUntil('bear', 'sq.burl.boars.w', 4), await state('sq.burl.boars.w'));
    await markCheck('sR', 'bear', false, "blue '?' gone from Burl after the hand-in");
  });
  await beat('S3 fetch quest: sq.burl.meat (bring boar meat)', async () => {
    check('sq.burl.meat accepted', await talkUntil('bear', 'sq.burl.meat', 2), await state('sq.burl.meat'));
    await ev("__t.D.saveRelay.quest.book.track('sq.burl.meat')");
    await needleCheck(2, undefined, 'needle: fetch step target');
    await give('boar.meat', 1); await ev("(__t.D.saveRelay.quest.book.feed({ type: 'item:got', id: 'boar.meat' }), true)"); // a fetch objective completes on the pickup event 'item:got' (what the real pickup emits)
    check('sq.burl.meat READY', await waitFor(async () => (await stOf('sq.burl.meat')) === 3, 6000), await state('sq.burl.meat'));
    await markCheck('sR', 'bear', true, "blue '?' over Burl (fetch READY)");
    await needleCheck(1, 'bear', "needle at Burl (ready '?')");
    await momentStill('bear', 'S3-fetch-ready-question-on-burl');
    check('sq.burl.meat done after hand-in', await talkUntil('bear', 'sq.burl.meat', 4), await state('sq.burl.meat'));
    await markCheck('sR', 'bear', false, "blue '?' gone from Burl after the hand-in");
  });
  if (process.argv.includes('--next')) { const m = await import('./quest-walk-next.mjs'); await m.run({ check, beat, talk, talkUntil, ev, evA, pause, key, pressE, stOf, state, flag, markCheck, needleCheck, momentStill, goIx, goTrig, tpA, emitHit, still, give, marks, waitFor, YES, lastLog: () => lastLog }); }
  curBeat = 'end'; check('no console errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} catch (e) { console.error('FATAL', e && e.message || e); rows.push({ beat: curBeat, name: 'fatal: ' + (e && e.message), ok: false }); }
finally {
  clearTimeout(killer);
  const fails = rows.filter((r) => !r.ok);
  console.log(`\nquest-walk: ${rows.length - fails.length}/${rows.length} checks passed; stills in docs/test-reports/quest-walk/`);
  for (const f of fails) console.log('  FAIL [' + f.beat + '] ' + f.name);
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { /* temp profile left */ }
  process.exit(fails.length ? 1 : 0);
}
