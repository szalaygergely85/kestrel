// OB-170 repro: "touching the second waystone doesn't finish the quest". Drives the REAL game (headless Chrome) through the m1 chain as far as __debug allows,
// wakes the first waystone, then stands at the Bend stone (relayBend), aims at it and presses a real KeyE. Prints prompt / hint, aether.attuned, waystone flags,
// the m1 objective list and D-098 markers before/after, console errors; shots in docs/test-reports/captures/ob170-*.png.
// Run: node tools/verify-ob170.mjs 9540   (PC-B ports 9500-9999; CDP = port+1). Starts/kills only its own python server + Chrome.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9540);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B port range is 9500-9999 (next port is CDP)');
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob170-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (s) => evaluate(cdp, s), evA = (s) => evaluateAsync(cdp, s);
let browser, cdp;
const errors = [];
const shot = async (name) => { await pause(700); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, 'ob170-' + name + '.png'), Buffer.from(s.data, 'base64')); };
const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k }); await pause(70); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); await pause(150); };
// page-side snapshot: aether flag, waystone flags, relay prompt/hint, m1 objectives (tracker lines + undone objective ids), D-098 marker ids
const SNAP = `(async () => { const D = window.__debug, w = D.world, q = D.saveRelay.quest, b = q.book, { trackerLines } = await import('/game/js/ui/questTracker.js');
  const st = {}; for (const k of Object.keys(w.state)) if (/^(waystone\\.|aether\\.|dlg\\.bear\\.stone|burl\\.)/.test(k)) st[k] = w.state[k];
  const a = [], r = [], sa = [], sr = [], g = []; b.giverMarks(a, r, sa, sr); b.chainMarks(a, r); b.activeMarks(g); b.dedupeMarks(a, r, sa, sr, undefined, g);
  const done = q.state.completed.slice(), def = b.def(0), next = def.objectives.filter((o) => !done.includes(o.id)).map((o) => o.id);
  const rw = D.relayWake, rb = rw.relays.find((x) => x.wsId === 'ws_roadBend');
  const rec = w.interactables.find((x) => x.key === 'relay.ws_roadBend');
  return JSON.stringify({ state: st, flags: Object.keys(q.state.flags || {}).filter((k) => /waystone|burl|aether/.test(k)), mainDone: done, nextObjectives: next, tracker: trackerLines(b, 60, []).map((l) => l.text),
    marks: { avail: a, ready: r, grey: g }, relay: rb ? { phase: rb.phase, prompt: rec && rec.prompt, requires: rec && rec.requires } : null,
    hint: { left: rw.hintLeft, line: rw.hintLine }, targetKey: w.interaction && w.interaction.targetKey, noticeActive: !!(D.notice && D.notice.active), noticeTitle: D.notice && D.notice.title }); })()`;
const snap = async (label) => { const s = JSON.parse(await evA(SNAP)); console.log('--- ' + label + ' ---\n' + JSON.stringify(s, null, 1)); return s; };
// stand `off` m west of entity `id` on the floor, aim the eye at it (the interaction test is a view-cone + reach test from the eye)
const FACE = (id, off) => `(async () => { const D = window.__debug, w = D.world, e = w.get(${JSON.stringify(id)}).data.transform, p = D.playerHandle.data, t = p.transform, c = p.components;
  const tx = e.x - ${off}, ty = e.y;
  t.x = tx; t.y = ty; let g = w.floorAt(tx, ty); t.z = g == null ? e.z : g + 0.6; c.body.vx = c.body.vy = c.body.vz = 0; D.vitals.clearSafe(); D.look.locked = true; await new Promise((r) => setTimeout(r, 700));
  g = w.floorAt(tx, ty); if (g != null && Math.abs(t.z - g) > 3) t.z = g + 0.6;
  const dx = e.x - t.x, dy = e.y - t.y, dz = (e.z + 1) - (t.z + (c.body.eyeH || 1.6)), h = Math.hypot(dx, dy) || 1e-6, yaw = Math.atan2(dx, -dy) * 180 / Math.PI, pitch = Math.atan2(dz, h) * 180 / Math.PI;
  D.look.yawDeg = yaw; D.look.pitchDeg = pitch; t.yawDeg = yaw; t.pitchDeg = pitch; await new Promise((r) => setTimeout(r, 400)); return true; })()`;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push('exception: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push('console.error: ' + p.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  // new game: fresh profile = no stored save; save relay on (same url shape as verify-ch12-run)
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?voxelbench=0&save=1&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await ev('!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.saveRelay && window.__debug.relayWake && window.__debug.playerHandle.data.components.health)')) { ready = true; break; } }
  if (!ready) throw new Error('game never ready: ' + JSON.stringify(errors));
  await pause(1500);
  await snap('boot');
  // --- m1 chain up to the first waystone, flag-level (what the real interactions end up setting) ---
  const chain = await ev(`(() => { const q = window.__debug.saveRelay.quest, b = q.book, log = [];
    for (const e of [{ type: 'flag:set', key: 'wake', value: true }, { type: 'area:entered', id: 'breach' }, { type: 'item:got', id: 'sword' }, { type: 'area:entered', id: 'towerDoor' }]) q.feed(e);
    for (const k of ['q.tower.blade.accept', 'q.tower.blade.handin', 'q.burl.boars.accept']) { try { b.actKey(k); } catch (e) { log.push(k + ': ' + e.message); } }
    q.questFlag('quest.burl.boars.done'); q.questFlag('burl.arrived'); return JSON.stringify({ blade: b.statusOf('tower.blade'), log }); })()`);
  console.log('chain (blade/boars/follow): ' + chain);
  await snap('after boars+follow (before first stone)');
  // --- wake the first waystone through the real relayWake.interact, after the crystal + Burl's stone talk (the gates the player passes) ---
  await ev("(() => { const s = window.__debug.world.state; s['aether.attuned'] = true; s['dlg.bear.stone.told'] = true; return true; })()");
  const first = await ev("JSON.stringify(window.__debug.relayWake.relays.map((r) => ({ ws: r.wsId, ent: r.entId, stone: r.stone, phase: r.phase })))");
  console.log('relays: ' + first);
  const firstEnt = JSON.parse(first).find((r) => r.ws === 'waystone');
  if (firstEnt) { await evA(FACE(firstEnt.ent, 3)); await shot('first-stone'); console.log('first stone interact -> ' + await ev("window.__debug.relayWake.interact('waystone')")); await pause(1500); }
  else console.log('WARN: no relay record for wsId "waystone"');
  await ev('(() => { const rw = window.__debug.relayWake; for (let i = 0; i < 400; i++) rw.step(1 / 60, null); return true; })()'); // finish the wake timer by hand (sim may not tick headless)
  const before = await snap('BEFORE bend (first stone woken)');
  // --- the Bend stone: stand 3 m west, aim, real KeyE ---
  await evA(FACE('relayBend', Number(process.env.OFF || 2.5)));
  console.log('DIAG ' + await evA(`(async () => { const D = window.__debug, w = D.world, rec = w.interactables.find((x) => x.key === 'relay.ws_roadBend'), p = D.playerHandle.data, t = p.transform;
    const L = D.look, eh = p.components.body.eyeH || 1.6; return JSON.stringify({ pick: rec && rec.pick, shapes: !!(rec && rec.pickShapes), propId: rec && rec.propId, bodyId: rec && rec.bodyId, used: rec && rec.usedKey && w.state[rec.usedKey], req: rec && rec.requires, radius: rec && rec.radius, eyeT: [t.x, t.y, t.z + eh], yaw: L.yawDeg, pitch: L.pitchDeg, n: w.interactables.length, los: (() => { const o = [], x1 = rec.pick.x0; for (const f of [0.3, 0.5, 0.8, 1, 1.5, 2]) { const x = t.x + f; o.push([f, w.losPointQ ? 1 : 0, (D.pointBlocked ? D.pointBlocked(w, x, t.y, t.z + eh) : null)]); } return o; })(), structAt: !!w.structureAt(t.x, t.y), keys: w.interactables.filter((x) => /relay|stone/.test(x.key)).map((x) => x.key) }); })()`));
  const pre = await snap('at bend, aimed, before E'); await shot('bend-before');
  await key('KeyE', 'e'); await pause(1200);
  await shot('bend-after-e1');
  const after = await snap('AFTER E (bend)');
  // a second E (touch) in case the first E only starts the wake
  await key('KeyE', 'e'); await pause(1200);
  const after2 = await snap('AFTER 2nd E (bend)'); await shot('bend-after-e2');
  // OB-170 / D-098 catch-up: the stone was woken WITHOUT feeding roadWest/bendRelay -> road, relayFound, relay1 must be done now
  { const left = after2.nextObjectives.filter((x) => ['road', 'relayFound', 'relay1'].includes(x)); console.log('CATCHUP ' + (after2.state['waystone.ws_roadBend.woken'] ? (left.length ? 'FAIL still pending ' + JSON.stringify(left) : 'OK chain advanced past road/relayFound/relay1') : 'SKIP (stone not woken)')); if (after2.state['waystone.ws_roadBend.woken'] && left.length) process.exitCode = 1; }
  await ev("(() => { const q = window.__debug.saveRelay.quest; q.feed({ type: 'area:entered', id: 'roadWest' }); q.feed({ type: 'area:entered', id: 'bendRelay' }); return true; })()"); await pause(500);
  const after3 = await snap('AFTER entering road+bend areas late'); console.log('LATE-AREAS nextObjectives ' + JSON.stringify(after3.nextObjectives));
  console.log('SUMMARY ' + JSON.stringify({
    prompt: pre.relay && pre.relay.prompt, targetKey: pre.targetKey, hintAfterE: after.hint, attunedBefore: before.state['aether.attuned'], attunedAfter: after2.state['aether.attuned'],
    bendWokenBefore: pre.state['waystone.ws_roadBend.woken'], bendWokenAfter: after2.state['waystone.ws_roadBend.woken'],
    firstWokenBefore: before.state['waystone.waystone.woken'], nextBefore: pre.nextObjectives, nextAfter: after2.nextObjectives,
    trackerBefore: pre.tracker, trackerAfter: after2.tracker, marksBefore: pre.marks, marksAfter: after2.marks }));
  console.log('console errors: ' + JSON.stringify(errors));
} catch (e) { console.log('FAIL ' + (e && e.message)); console.log('console errors: ' + JSON.stringify(errors)); process.exitCode = 1; }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
