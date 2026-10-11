// OB-048/OB-049: open a note, press Esc (and E / click), check the note closes and the pause menu does NOT open on that press.
// Run: node tools/verify-note-close.mjs 9500   (PC-B lane B1 ports 9500-9574; CDP = port+1)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-note-close-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?debug=1` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(400); if (await evaluate(cdp, '!!(window.__debug && window.__debug.openNote && window.__debug.engine && window.__debug.engine.world)')) { ready = true; break; } }
  assert.ok(ready, 'game did not boot');
  const key = async (code, key_) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: key_ }); await pause(60); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: key_ }); await pause(400); };
  const state = () => evaluate(cdp, '({note: !!__debug.isNoteOpen(), pause: !!__debug.pauseUp()})');
  const noteId = await evaluate(cdp, 'Object.keys(window.ASSETS.notes)[0]');
  for (const [name, code, k] of [['Esc', 'Escape', 'Escape'], ['E', 'KeyE', 'e']]) {
    await evaluate(cdp, `__debug.openNote(${JSON.stringify(noteId)})`); await pause(500);
    assert.equal((await state()).note, true, 'note open before ' + name);
    await key(code, k);
    const s = await state();
    assert.equal(s.note, false, name + ' closes the note');
    assert.equal(s.pause, false, name + ': pause menu must not open on the same press');
    console.log('PASS', name, JSON.stringify(s));
  }
  console.log('ALL PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
}
