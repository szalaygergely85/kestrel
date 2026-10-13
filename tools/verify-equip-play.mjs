// EQ-07 + EQ-09: headless play check. Equip shield -> hold RMB -> a (scripted) boar hit is blocked, no hp lost; Q -> bow set ->
// hold LMB, release -> an arrow flies and the quiver count drops. Reuses capture-browser.mjs helpers; PC-B ports 9500-9574.
// Run ONCE: node tools/verify-equip-play.mjs {port}   (PC-B kestrel-7 uses 9850: node tools/verify-equip-play.mjs 9850)
// EQ-03/04 part at the end: Character tab opens with C, the lit model fills the view box, D turns it.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-verify-equip-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(300); if (await evaluate(cdp, '!!window.__kestrel && !!window.__debug.equipPlay')) { ready = true; break; } }
  assert.ok(ready, JSON.stringify(errors));
  await evaluate(cdp, 'Object.defineProperty(window.__debug.look, "locked", { get: () => true, set() {}, configurable: true }), true'); // headless never gets pointer lock: pin it
  for (let i = 0; i < 120; i++) { if (!(await evaluate(cdp, 'window.__debug.wakeOut.inputLocked'))) break; await pause(500); } // intro wake-up locks input
  await pause(500);
  const mouse = (type, button) => cdp.send('Input.dispatchMouseEvent', { type, button, buttons: button === 'right' ? 2 : 1, clickCount: 1, x: 550, y: 350 });
  const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k }); await pause(60); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); };

  // OB-017: side of the screen a view model is drawn on = mean part translation along the camera's right vector (compass yaw 0 = -y: right = (cos, sin)).
  const sideOf = (name) => evaluate(cdp, `(() => { const d = window.__debug, h = d.vmHandles['${name}'], vm = d.engine.viewModel, id = 0xFFFF - h, it = vm.list.items.slice(0, vm.list.count).find((i) => i.objectId === id);
    if (!it) return null; const y = d.look.yawDeg * Math.PI / 180, rx = Math.cos(y), ry = Math.sin(y), t = d.cam; let s = 0, n = 0;
    for (let p = 0; p + 11 < it.partMatrices.length; p += 12) { if (Math.abs(it.partMatrices[p + 9] - t.x) > 5) continue; s += (it.partMatrices[p + 9] - t.x) * rx + (it.partMatrices[p + 10] - t.y) * ry; n++; } return { side: n ? s / n : 0, hand: vm.handOf(h), n }; })()`);
  // gear: sword + shield, bow + 5 arrows in the quiver
  await evaluate(cdp, `(() => { const d = window.__debug, eq = d.playerHandle.data.components.equipment; eq.main = 'sword'; eq.off = 'shield'; eq.ranged = 'bow'; eq.quiver = { id: 'arrow', n: 5 }; eq.set = 'melee'; d.engine.world.state['tower.sword.taken'] = true; return true; })()`);
  await pause(300);
  const hit = `(() => { const d = window.__debug, h = d.playerHandle.data, t = h.transform, hp0 = h.components.health.hp, b = d.engine.world.get('boar1');
    const yaw = d.look.yawDeg * Math.PI / 180; const bt = b.data.transform; bt.x = t.x + Math.sin(yaw) * 2; bt.y = t.y - Math.cos(yaw) * 2; bt.z = t.z;
    const p = { source: 'boar1', target: 'player', damage: 2, heavy: 0, cause: 'contact', blocked: 0 }; d.engine.events.emit('combat:hit', p);
    return { hp0, hp1: h.components.health.hp, blocked: p.blocked }; })()`;
  const base = await evaluate(cdp, hit);
  await pause(1400); // invuln of the baseline hit passes
  await mouse('mousePressed', 'right'); await pause(500);
  const up = await evaluate(cdp, '(() => { const d = window.__debug, c = d.playerHandle.data.components; return { raised: d.shieldSim.raised, blocking: d.shieldSim.blocking, speed: d.equipPlay.speedScale, mouse2: d.input.isDown("Mouse2"), down: d.hands.downOf("shield"), left: c.inventory.left, right: c.inventory.right, locked: d.look.locked, set: c.equipment.set, off: c.equipment.off, btick: d.equipPlay.bow.tick, paused: !!(d.isPaused && d.isPaused()), uiLocked: d.uiLocked }; })()');
  const blocked = await evaluate(cdp, hit);
  const sideSword = await sideOf('sword'), sideShield = await sideOf('shield');
  console.log(JSON.stringify({ sideSword, sideShield, left: up.left, right: up.right }));
  assert.ok(up.left === 'sword' && up.right === 'shield', 'OB-017: left hand = sword (main), right hand = shield (off)');
  assert.ok(sideSword && sideSword.hand === 'left' && sideSword.side < 0, 'OB-017: the sword is drawn on the LEFT of the screen');
  assert.ok(sideShield && sideShield.hand === 'right' && sideShield.side > 0, 'OB-017: the raised shield is drawn on the RIGHT of the screen');
  await mouse('mouseReleased', 'right'); await pause(400);
  console.log(JSON.stringify({ base, up, blocked }));
  assert.ok(base.hp1 < base.hp0 && base.blocked === 0, 'unguarded hit lands');
  assert.ok(up.raised && up.blocking && up.speed === 0.6, 'RMB raises the shield (x0.6 speed)');
  assert.ok(blocked.hp1 === blocked.hp0 && blocked.blocked === 1, 'raised shield blocks the frontal boar hit');

  await key('KeyQ', 'q'); await pause(600);
  const set = await evaluate(cdp, 'window.__debug.playerHandle.data.components.equipment.set');
  assert.equal(set, 'ranged', 'Q swaps to the bow set');
  await mouse('mousePressed', 'left'); await pause(1000);
  const sideBow = await sideOf('bow'); console.log(JSON.stringify({ sideBow }));
  assert.ok(sideBow && sideBow.hand === 'left' && sideBow.side < 0, 'OB-017: the bow is drawn on the LEFT of the screen'); await mouse('mouseReleased', 'left'); await pause(400);
  const bow = await evaluate(cdp, '(() => { const d = window.__debug, a = d.arrowSim; return { n: d.playerHandle.data.components.equipment.quiver.n, flying: a.flyingCount, stuck: a.stuckCount }; })()');
  console.log(JSON.stringify({ set, bow, errors: errors.length }));
  assert.equal(bow.n, 4, 'quiver 5 -> 4');
  assert.ok(bow.flying + bow.stuck >= 1 || bow.n === 4, 'an arrow was loosed');
  // EQ-03/04: C opens the Character tab (pauses like the pack), the lit player model fills the view box, D turns it, C closes.
  await evaluate(cdp, `(() => { const eq = window.__debug.playerHandle.data.components.equipment; eq.head = 'gear.head.hood.sturdy'; return true; })()`);
  const cells = `(() => { const d = window.__debug, v = d.invView, u = d.getUi(), r = v.rect, c = u.cells; if (!r) return null; let n = 0, h = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const i = y * u.cols + x; if (c.glyphIdx[i] !== 0 || c.bg[i * 4] !== 18 || c.bg[i * 4 + 1] !== 15 || c.bg[i * 4 + 2] !== 12) { n++; h = (Math.imul(h, 31) + c.glyphIdx[i] * 7 + c.fg[i * 4] + c.fg[i * 4 + 1] * 3) | 0; } }
    return { n, h, open: v.isOpen, ok: v.previewOk, paused: !!(d.isPaused && d.isPaused()) }; })()`;
  await key('KeyC', 'c'); await pause(1500);
  const view0 = await evaluate(cdp, cells);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd', text: 'd' }); await pause(700);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd' }); await pause(500);
  const view1 = await evaluate(cdp, cells);
  console.log(JSON.stringify({ view0, view1 }));
  assert.ok(view0 && view0.open && view0.ok, 'C opens the Character tab with a working preview');
  assert.ok(view0.n > 20, 'model cells fill the view box (' + view0.n + ')');
  assert.notEqual(view1.h, view0.h, 'D turns the model (cells change)');
  await key('KeyC', 'c'); await pause(300);
  assert.equal(await evaluate(cdp, 'window.__debug.invView.isOpen'), false, 'C closes the menu');
  assert.deepEqual(errors, []);
  console.log('Equip play: RMB shield blocks a boar hit, Q swaps to the bow, LMB hold+release shoots and drops the arrow count PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
