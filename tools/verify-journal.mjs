// OB-097: headless check of the two-pane J journal. Loads game/index.html?dev=1, feeds the first quest steps into the book, opens J and
// reads the pane contents via window.__debug.questLogSnapshot(). The summary must follow the active step's `journal` text.
// J needs the real frame loop with pointer lock; if headless cannot open it the check reports a WARN (owner walk checks it).
// Run: node tools/verify-journal.mjs <port>   (PC-B lane B1 ports 9500-9574; the CDP port is port+1)
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9530);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-journal-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [];
  cdp.onEvent((m, p) => {
    if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails);
    if (m === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze('dev=1&backend=webgpu')}` });
  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.questBook && window.__debug.questBook())')) { ready = true; break; } }
  assert.ok(ready, 'world never loaded: ' + JSON.stringify(errors));
  const ev = (js) => evaluate(cdp, js);
  const key = async (code, k) => { for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }); };
  await ev('(()=>{const l=window.__debug.look; if(l) l.locked=true;})()');
  const feed = (e) => ev(`window.__debug.questBook().feed(${JSON.stringify(e)})`);
  await feed({ type: 'flag:set', key: 'wake', value: true }); // first note read -> "climb up" step is active
  await key('KeyJ', 'j'); await pause(600);
  if (!(await ev('window.__debug.questLogOpen()'))) { console.log('WARN: J not testable headless (no pointer lock / frame loop) - owner walk checks it'); }
  else {
    const snap = async () => JSON.parse(await ev('JSON.stringify(window.__debug.questLogSnapshot())'));
    let s = await snap();
    assert.ok(s.left.length >= 1, 'LEFT pane lists the main quest: ' + JSON.stringify(s.left));
    assert.ok(s.right.some((l) => l.startsWith('You found a note')), 'RIGHT summary = active step journal: ' + JSON.stringify(s.right));
    assert.ok(s.right.some((l) => /^\[x\] Get up from the wreck\s+1\/1$/.test(l)), 'done step checked: ' + JSON.stringify(s.right));
    assert.ok(s.right.some((l) => /^\[>\] Climb to the top of the tower\s+0\/1$/.test(l)), 'active step highlighted: ' + JSON.stringify(s.right));
    for (const l of s.right) assert.ok(l.length <= 40, 'right pane line fits: ' + l);
    await key('KeyJ', 'j'); await pause(300);
    await feed({ type: 'area:entered', id: 'breach' });
    await key('KeyJ', 'j'); await pause(600);
    s = await snap();
    assert.ok(s.right.some((l) => l.startsWith('You found a note pinned to the wall. Climb up and take')), 'summary moved to the sword step: ' + JSON.stringify(s.right));
    await key('KeyJ', 'j'); await pause(300);
    console.log('OB-097 journal: two panes, summary follows the active step, PASS');
  }
  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
