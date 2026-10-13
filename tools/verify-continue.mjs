// VERIFY-CONTINUE: real title-menu path on the default whole-map world (and ?grid=0): New game -> move -> force save ->
// reload -> title Continue -> assert no exceptions/console.error, pose ~ saved, entity ids unique, regional beasts + far camp
// members present exactly once. Guards the 'World.spawn: id already exists' Continue crash (WMP-09).
// Run: node tools/verify-continue.mjs 9600   (PC-B ports; CDP = port+1; second pass uses port+2/+3). Exit 1 on FAIL.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const base = Number(process.argv[2] || 9600);
validatePort(base);
if (base < 9500 || base + 3 > 9999) throw new Error('PC-B ports 9500-9999 (uses port..port+3)');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const READY = '!!(window.__debug && window.__debug.menuHost && window.__debug.world)';
// Drive the title menu with key edges until the wanted row is selected, then Enter.
const PICK = (id) => `(() => { const h = __debug.menuHost; const sel = () => { const s = h.menu.snapshot(); return s.rows[s.selected].id; };
  for (let i = 0; i < 6 && sel() !== ${JSON.stringify(id)}; i++) h.step((c) => c === 'ArrowDown'); if (sel() !== ${JSON.stringify(id)}) return 'row ' + ${JSON.stringify(id)} + ' unavailable';
  h.step((c) => c === 'Enter'); return 'ok'; })()`;
const INGAME = '!!(window.__debug.playerHandle && window.__debug.gameHooks && window.__debug.gameHooks.ctx.state.canSave && !__debug.menuHost.active)';
const SNAP = `(() => { const D = __debug, t = D.playerHandle.data.transform, ids = [], dup = [], homes = {}; const seen = new Set();
  D.world.forEachEntity((e) => { const id = e.id ?? (e.data && e.data.id); ids.push(id); { const b = e.components && e.components.brain; if (b && b.home && /^[A-Za-z]+\.[A-Za-z]+\.\d+$/.test(String(id))) homes[id] = [b.home[0], b.home[1]]; } if (seen.has(id)) dup.push(id); seen.add(id); });
  return { homes, pos: [t.x, t.y, t.z], n: ids.length, dup, beasts: ids.filter((i) => /^[a-z]+\.[A-Za-z]+\.\d+$/.test(String(i)) && !/^gobF\./.test(i)), farMembers: ids.filter((i) => /^gobF\./.test(String(i))) }; })()`;

async function pass(label, port, query) {
  validatePort(port);
  const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-continue-'));
  const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  let browser, cdp;
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
    const url = `http://127.0.0.1:${port}/game/index.html${query}`;
    async function waitFor(expr, what, tries = 300) {
      for (let i = 0; i < tries; i++) { await pause(300); if (await evaluate(cdp, expr).catch(() => false)) return; }
      assert.fail(`${label}: ${what} never happened: ${JSON.stringify(errors)}`);
    }
    // ---- run 1: new game, move, save ----
    await cdp.send('Page.navigate', { url });
    await waitFor(READY, 'title menu');
    assert.equal(await evaluate(cdp, PICK('new')), 'ok');
    await waitFor(INGAME, 'new game in world');
    await pause(1500);
    await evaluate(cdp, `(() => { const D = __debug, t = D.playerHandle.data.transform; t.x += 12; t.z += 0; D.vitals && D.vitals.clearSafe && D.vitals.clearSafe(); return 1; })()`);
    await pause(1500); // land + settle
    await evaluate(cdp, '__debug.gameHooks.ctx.requestSave()');
    assert.ok(await evaluate(cdp, "(localStorage.getItem('kestrel.save.slot.0') || '').length") > 0, `${label}: slot written`);
    const before = await evaluate(cdp, SNAP);
    assert.deepEqual(before.dup, [], `${label}: duplicate ids before save`);
    // ---- run 2: reload -> Continue ----
    await cdp.send('Page.navigate', { url });
    await waitFor(READY, 'title menu after reload');
    assert.equal(await evaluate(cdp, PICK('continue')), 'ok', `${label}: Continue available`);
    await waitFor(INGAME, 'Continue world');
    await pause(1500);
    const after = await evaluate(cdp, SNAP);
    const d = Math.hypot(before.pos[0] - after.pos[0], before.pos[2] - after.pos[2]);
    assert.ok(d < 3, `${label}: pose differs by ${d.toFixed(2)} m ${JSON.stringify([before.pos, after.pos])}`);
    assert.deepEqual(after.dup, [], `${label}: duplicate ids after Continue`);
    assert.deepEqual([...after.beasts].sort(), [...before.beasts].sort(), `${label}: regional beasts changed across Continue`);
    assert.equal(after.farMembers.length, before.farMembers.length, `${label}: far camp members changed`);
    assert.equal(new Set([...after.beasts, ...after.farMembers]).size, after.beasts.length + after.farMembers.length, `${label}: beast/camp ids not unique`);
    // WMP-09: herd homes + far camp (gobF.*) member homes are identical before/after Continue (generators avoid authored entities only)
    assert.ok(Object.keys(before.homes).length > 0, `${label}: no generated homes found`);
    assert.deepEqual(after.homes, before.homes, `${label}: herd / campFar homes changed across Continue`);
    assert.deepEqual(errors, [], `${label}: console errors / exceptions`);
    console.log(`${label}: PASS entities ${before.n}->${after.n}, beasts ${after.beasts.length}, far camp members ${after.farMembers.length}, pose drift ${d.toFixed(2)} m`);
  } finally {
    cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
    await pause(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] profile left:', e.message); }
  }
}

await pass('default world', base, '');
await pass('grid=0', base + 2, '?grid=0');
console.log('Continue (title menu, default + ?grid=0): no errors, pose kept, unique ids, beasts/camp present once PASS');
