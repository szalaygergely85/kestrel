// OB-048/OB-049: open a note, press Esc (and E / click), check the note closes and the pause menu does NOT open on that press.
// Run: node tools/verify-note-close.mjs 9500   (PC-B lane B1 ports 9500-9574; CDP = port+1)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port + 1 > 9999) throw new Error('CDP port is port+1');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-note-close-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.openNote && window.__debug.world && window.__debug.playerHandle)')) { ready = true; break; } }
  assert.ok(ready, 'game did not boot');
  await evaluate(cdp, 'window.__debug.look.locked = true'); // headless has no pointer lock; unlocked = paused sim (note never steps)
  const key = async (code, key_) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: key_ }); await pause(60); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: key_ }); await pause(400); };
  const state = () => evaluate(cdp, '({note: !!__debug.isNoteOpen(), pause: !!__debug.pauseUp()})');
  const noteId = await evaluate(cdp, 'Object.keys(window.ASSETS.notes)[0]');
  for (const [name, code, k] of [['Esc', 'Escape', 'Escape'], ['E', 'KeyE', 'e']]) {
    await evaluate(cdp, `__debug.openNote(${JSON.stringify(noteId)})`); await pause(2500); // headless sim is slow to step: the fade-in must finish before Esc/E can close
    assert.equal((await state()).note, true, 'note open before ' + name);
    await key(code, k);
    const s = await state();
    assert.equal(s.note, false, name + ' closes the note');
    assert.equal(s.pause, false, name + ': pause menu must not open on the same press');
    console.log('PASS', name, JSON.stringify(s));
  }
  // OB-049 dialogue: talk to Burl (bear), Esc, expect the box closed. Headless has no pointer lock (look.locked=false), so the lock-loss
  // edge that arms escGrace cannot occur here: pause state is reported only; the grace itself is covered by escGrace.test.js.
  const opened = await evaluate(cdp, '!!(__debug.dialogue && __debug.dialogue.openFor("bear"))');
  if (opened) {
    await key('Escape', 'Escape');
    const d = await evaluate(cdp, '({open: !!__debug.dialogue.open, grace: __debug.dialogue.escGrace.active, pause: !!__debug.pauseUp()})');
    assert.equal(d.open, false, 'Esc closes the dialogue');
    console.log('PASS dialogue Esc', JSON.stringify(d), '(pause/grace informational headless)');
  } else console.log('SKIP dialogue (bear not openable here)');
  // OB-068: Esc in the pause menu = Resume (menu hidden, world not paused-looking, no auto re-open); a second Esc opens pause again.
  await evaluate(cdp, 'window.__debug.look.locked = false'); await pause(600); // lock stub is refused in headless: stays unlocked
  assert.equal(await evaluate(cdp, '!!__debug.pauseUp()'), true, 'pause menu up while unlocked');
  await key('Escape', 'Escape');
  assert.equal(await evaluate(cdp, '!!__debug.pauseUp()'), false, 'Esc in pause menu resumes (menu hidden)');
  await pause(600); assert.equal(await evaluate(cdp, '!!__debug.pauseUp()'), false, 'resumed state sticks while unlocked');
  await key('Escape', 'Escape');
  assert.equal(await evaluate(cdp, '!!__debug.pauseUp()'), true, 'second Esc opens pause again');
  console.log('PASS pause Esc resume');
  console.log('ALL PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
}
