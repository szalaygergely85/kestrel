// QUEST-HANDIN-BROWSER-01 (OB-209): headless real-game check of every opening-chain HAND-IN (the main-chain quests that end on a '?' over a character).
// Per step: [offer] '!' over the giver -> talk + Accept (real KeyE + dialogue runner) -> objective via dev hooks (teleport / combat:hit / flags, as tools/verify-quest-walk.mjs)
//   -> READY and gold '?' over the hand-in character -> hand-in talk -> status DONE, reward granted exactly once (a 2nd talk changes nothing) -> marks gone.
// One PASS/FAIL line per step; a still of the failing moment goes to docs/test-reports/opening-chain-<step>.png. Exit 1 on any FAIL.
// The step ids are the `quest.<id>.done` hand-in flags of the m1 chain (the same rule game/js/quest/allQuests.e2e.test.js uses); cross-check: tools/verify-opening-chain.test.mjs.
// Run: node tools/verify-opening-chain.mjs <port 9500-9999>   (CDP = port+1; own static server + headless browser, both killed at the end; never port 8000)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

/** The opening chain's hand-in quests in play order. giver = world entity that offers it ('!'), handIn = character that takes it ('?'). */
export const STEPS = [
  { quest: 'tower.blade', giver: 'noteKeepLight', handIn: 'bear' },
  { quest: 'burl.boars', giver: 'bear', handIn: 'bear' },
  { quest: 'burl.follow', giver: 'bear', handIn: 'bear' },
  { quest: 'burl.stone', giver: 'bear', handIn: 'bear' },
  { quest: 'mq.bend.call', giver: 'rook', handIn: 'rook' },
];
export const STEP_IDS = STEPS.map((s) => s.quest);

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) await main();

async function main() {
  const port = Number(process.argv[2] || 9725);
  validatePort(port);
  if (port < 9500 || port + 1 > 9999) throw new Error('PC-B port range is 9500-9999 (next port is CDP)');
  const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-opening-'));
  const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const url = `http://127.0.0.1:${port}/game/index.html?voxelbench=0&save=1&nopause=1&title=0&backend=webgpu`;
  const errors = [], results = []; let browser, cdp;
  const killer = setTimeout(() => { console.error('verify-opening-chain timeout'); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid); process.exit(2); }, 1500000);
  const ev = (js) => evaluate(cdp, js), evA = (js) => evaluateAsync(cdp, js);
  const J = JSON.stringify;

  // page-side helpers (trimmed from tools/verify-quest-walk.mjs LIB): window.__t
  const LIB = `(() => { const D = window.__debug, w = D.world, p = D.playerHandle.data, t = p.transform, c = p.components, sl = (ms) => new Promise((r) => setTimeout(r, ms));
    const book = () => D.saveRelay.quest.book;
    const T = window.__t = { D, w, sl,
      st: (id) => book().statusOf(id),
      ix: (k) => w.interactables.find((r) => r.key === k),
      trig: (id) => w.triggers.find((r) => r.key === 'world.' + id),
      flag: (k) => !!w.state[k] || !!D.saveRelay.quest.state.flags[k],
      invSum: () => JSON.stringify(c.inventory.slots.map((s) => s && [s.id, s.n])),
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
      async dlg(prefs = []) { const r = D.dialogue.runner; for (let n = 0; n < 400 && D.dialogue.open; n++) {
          if (r.state === 'choosing') { const ch = []; for (let i = 0; i < r.choiceCount; i++) ch.push(String(r.choiceText(i))); let k = 0;
            out: for (const q of prefs) for (let i = 0; i < ch.length; i++) if (new RegExp(q, 'i').test(ch[i])) { k = i; break out; }
            r.selected = k; r.choose(); } else r.press();
          await sl(50); } await sl(300); return true; } };
    return true; })()`;

  const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k.length === 1 ? k : undefined }); await pause(70); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); await pause(120); };
  const pressE = async (n = 1) => { for (let i = 0; i < n; i++) { await key('KeyE', 'e'); await pause(450); } };
  const stOf = (id) => ev(`__t.st(${J(id)})`); // 0 unavailable, 1 available, 2 active, 3 ready, 4 done
  const flag = (k) => ev(`__t.flag(${J(k)})`);
  const completed = (id) => ev(`JSON.stringify(__t.D.saveRelay.quest.state.completed).includes(${J('"' + id + '"')})`);
  async function waitFor(fn, ms, step = 400) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await pause(step); } return false; }
  const goIx = (k, off = 0.9) => evA(`(async () => { await __t.goIx(${J(k)}, ${off}); return true; })()`);
  const goTrig = async (...ids) => { for (const id of ids) await evA(`(async () => { await __t.goTrig(${J(id)}); return true; })()`); };
  const tpA = (x, y) => evA(`(async () => { await __t.tp(${x}, ${y}); return true; })()`);
  const emitHit = (target) => ev(`(() => { __t.D.engine.events.emit('combat:hit', { target: ${J(target)}, damage: 999, source: 'player', cause: 'sword' }); return true; })()`);
  const marks = async () => JSON.parse(await ev(`(() => { const b = __t.D.saveRelay.quest.book, gA = [], gR = [], sA = [], sR = []; b.markLists(gA, gR, sA, sR); return JSON.stringify({ gA, gR, sA, sR }); })()`));
  const YES = ['ok|yes|will|do it|i.ll|take|accept|sure|done|here|ready|deliver|thanks|follow|boar|help|call|pulse|knot|seen|read|report'];
  async function talk(id) { // stand next to the npc, real E, run the dialogue (choices by regex prefs)
    await ev('(() => { for (let k = 0; k < 4; k++) __t.D.notice.update(10, false); return true; })()');
    await evA(`__t.goNpc(${J(id)})`); await pause(300);
    let open = await ev('__t.D.dialogue.open');
    for (let i = 0; i < 3 && !open; i++) { if (i > 0) { await evA(`__t.goNpc(${J(id)}, ${[1.2, -1.2, 2.2][i]})`); await pause(200); } await pressE(1); open = await ev('__t.D.dialogue.open'); }
    if (open) await evA(`__t.dlg(${J(YES)})`);
    return open;
  }
  async function talkUntil(npc, id, want, max = 9) { for (let i = 0; i < max; i++) { if ((await stOf(id)) >= want) return true; await talk(npc); } return (await stOf(id)) >= want; }
  async function still(step) { try { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(ROOT, 'docs', 'test-reports', `opening-chain-${step}.png`), Buffer.from(r.data, 'base64')); } catch (e) { /* best effort */ } }

  // per-step drivers (the same events the route walk uses): accept() takes the quest, complete() meets its objectives
  const DRIVE = {
    async 'tower.blade'() { // wake -> read the note (accept) -> sword -> tower door
      await ev("(__t.w.state['quest.wakeT'] = 100, true)"); await pause(1500); await ev('(__t.D.playerHandle.data.components.body.eyeH = __t.D.engine.physics.eyeHeight, true)');
      await waitFor(() => completed('wake'), 8000);
      return {
        accept: async () => { await goIx('tower.noteKeepLight', 0.8); await pause(300); for (let i = 0; i < 3 && (await stOf('tower.blade')) < 2; i++) await pressE(1); await key('Escape', 'Escape'); },
        complete: async () => {
          await evA("(async () => { const m = await __t.marker('breach'); await __t.tp(m.x, m.y, 0.3); await __t.sl(500); return true; })()");
          const bm = await evA("__t.marker('breach')"); await evA(`(async () => { await __t.goIx('tower.sword', 0.8, ${J(bm)}); return true; })()`);
          await waitFor(async () => { if (await ev("__t.invSum().includes('\"sword\"') || __t.D.saveRelay.quest.state.items.includes('sword')")) return true; await pressE(1); return false; }, 6000, 100);
          await goTrig('towerDoor'); await pause(600);
        } };
    },
    async 'burl.boars'() {
      return { accept: () => talkUntil('bear', 'burl.boars', 2), complete: async () => {
        for (const id of ['boar1', 'boar2', 'boar3', 'boar4', 'boar5']) { const r = await ev(`(() => { const h = __t.w.get(${J(id)}); return h ? [h.data.transform.x, h.data.transform.y] : null; })()`); if (r) await tpA(r[0] - 2, r[1]); await emitHit(id); await pause(300); }
      } };
    },
    async 'burl.follow'() { // Burl walks to the stone; her arrival ends the follow step (and offers/accepts burl.stone)
      return { accept: () => talkUntil('bear', 'burl.follow', 2), complete: async () => {
        for (let i = 0; i < 200; i++) {
          if ((await ev("__t.w.state['burl.phase']")) >= 2) break;
          await ev("(() => { const h = __t.D.playerHandle.data.components.health; if (h.hp < h.max) h.hp = h.max; const b = __t.w.get('bear').data.transform, t = __t.D.playerHandle.data.transform; if (Math.hypot(b.x - t.x, b.y - t.y) > 6) { t.x = b.x - 2; t.y = b.y; } return 1; })()"); await pause(500);
        }
      } };
    },
    async 'burl.stone'() { // accepted by the follow arrival; tell + wake the waystone -> READY; the hand-in is Burl's departure talk
      return { accept: async () => {}, complete: async () => {
        for (let i = 0; i < 4 && !(await flag('dlg.bear.stone.told')); i++) { if (!(await waitFor(() => ev('__t.D.dialogue.open'), i ? 3000 : 20000))) await talk('bear'); else await evA('__t.dlg(["ok|yes|thanks|stone|wake"])'); await pause(500); }
        for (let i = 0, woken = false; i < 5 && !woken; i++) { if (await ev('__t.D.dialogue.open')) await evA('__t.dlg(["ok|yes|thanks"])'); await goIx('stone.waystone', 1.2); await pressE(1); woken = await waitFor(() => completed('waystone'), 4000); }
      } };
    },
    async 'mq.bend.call'() { // road west -> Bend relay -> pulse seen + knot read, then Rook's talk accepts (and may already be READY)
      return { accept: async () => {
        await goTrig('roadWest', 'bendRelay'); await goIx('relay.ws_roadBend', 1.2); await pressE(1);
        await waitFor(() => flag('waystone.ws_roadBend.woken'), 15000); await waitFor(() => flag('relay.bend.pulseSeen'), 15000);
        await goIx('qi.knot', 0.9); await pressE(2); await waitFor(() => flag('lore.knot.read'), 4000);
        await talkUntil('rook', 'mq.bend.call', 2);
      }, complete: async () => {} };
    },
  };

  async function runStep(s) {
    const why = [];
    const need = (ok, msg) => { if (!ok) why.push(msg); return ok; };
    const d = await DRIVE[s.quest]();
    const m0 = await marks();
    if ((await stOf(s.quest)) === 1) need(m0.gA.includes(s.giver), `no gold '!' over ${s.giver} while available (${J(m0)})`);
    await d.accept();
    need((await stOf(s.quest)) >= 2, 'not accepted (status ' + await stOf(s.quest) + ')');
    await d.complete();
    const ready = await waitFor(async () => (await stOf(s.quest)) >= 3, 6000);
    if ((await stOf(s.quest)) === 3) { const m = await marks(); need(m.gR.includes(s.handIn), `READY but no gold '?' over ${s.handIn} (${J(m)})`); }
    else need(ready, 'never READY (status ' + await stOf(s.quest) + ')');
    if ((await stOf(s.quest)) < 4) await talkUntil(s.handIn, s.quest, 4, 4);
    if (!need((await stOf(s.quest)) === 4, 'not handed in (status ' + await stOf(s.quest) + ')')) return why;
    need(!(await marks()).gR.includes(s.handIn), `gold '?' still over ${s.handIn} after the hand-in`);
    const inv1 = await ev('__t.invSum()'); await talk(s.handIn); await pause(400); // a second talk must not pay the reward again
    need((await ev('__t.invSum()')) === inv1, 'reward paid twice (inventory changed on a 2nd talk)');
    need((await stOf(s.quest)) === 4, 'status left DONE after a 2nd talk');
    return why;
  }

  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
    browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    cdp = await connectCdp(port + 1, 15000);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    cdp.onEvent((m, p) => {
      if (m === 'Runtime.exceptionThrown') errors.push(J(p.exceptionDetails).slice(0, 300));
      if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push((p.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 300));
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) { await pause(300); ready = await ev('!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.saveRelay && window.__debug.relayWake && window.__debug.dialogue && window.__debug.playerHandle.data.components.health)'); }
    if (!ready) throw new Error('game never ready: ' + J(errors));
    await pause(1500); await ev(LIB);
    if (!(await ev("localStorage.getItem('kestrel.save.slot.0') === null"))) throw new Error('profile not fresh (New Game expected)');
    for (const s of STEPS) {
      let why;
      try { why = await runStep(s); } catch (e) { why = ['threw: ' + String(e && e.message || e).slice(0, 200)]; }
      const ok = why.length === 0; results.push({ step: s.quest, ok });
      console.log((ok ? 'PASS ' : 'FAIL ') + s.quest.padEnd(16) + (ok ? '' : ' | ' + why.join('; ')));
      if (!ok) await still(s.quest);
    }
    const ce = errors.length === 0; results.push({ step: 'console', ok: ce });
    console.log((ce ? 'PASS ' : 'FAIL ') + 'console errors'.padEnd(16) + (ce ? '' : ' | ' + J(errors.slice(0, 3))));
  } catch (e) { console.error('FATAL', e && e.message || e); results.push({ step: 'fatal', ok: false }); }
  finally {
    clearTimeout(killer);
    cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
    await pause(300); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { /* temp profile left */ }
    const fails = results.filter((r) => !r.ok);
    console.log(`opening-chain: ${results.length - fails.length}/${results.length} passed`);
    process.exit(fails.length ? 1 : 0);
  }
}
