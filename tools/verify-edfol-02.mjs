// ED-FOLIAGE-02 headless check: node tools/verify-edfol-02.mjs <port 9500-9574>
// Opens the editor, paints one foliage stroke through the Foliage controller, checks placements + one undo step, undo, redo.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2]);
validatePort(port);
if (!(port >= 9500 && port <= 9574)) throw new Error('PC-B port 9500-9574 required');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-edfol02-'));
const server = spawn('python', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/tools/editor/index.html?grid=400x150` });
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) { await pause(500); ready = await evaluate(cdp, '!!(window.__editor && window.__foliage && window.__foliage.fl.json)'); }
  assert.ok(ready, 'editor + foliage palette loaded ' + JSON.stringify(errors));
  const count = () => evaluate(cdp, `__editor.doc.files.get('world/'+__editor.doc.worldId).def.structures.filter(s=>s.id.startsWith('fol_')).length`);
  const steps = () => evaluate(cdp, '__editor.undoStack.size');
  const c0 = await count(), s0 = await steps();
  // one stroke near the camera: two moves, then release
  const painted = await evaluate(cdp, `(()=>{const e=__editor,f=__foliage,c=f.controller(),x=Math.round(e.cam.x)+10,y=Math.round(e.cam.y)+10;
    f.fl.st.op='paint';f.fl.st.density=12;f.fl.st.radius=8;f.fl.st.palette=f.fl.st.ids[0];
    c.start({x,y});c.move({x:x+6,y});const ghosts=c.ghosts().length;c.end();return {ghosts};})()`);
  await pause(800);
  const c1 = await count();
  assert.ok(c1 > c0, `stroke placed ${c1 - c0} (ghosts ${painted.ghosts})`);
  assert.equal(await steps(), s0 + 1, 'one undo step per stroke');
  await evaluate(cdp, '__editor.doUndo()'); await pause(800);
  assert.equal(await count(), c0, 'undo removes the stroke');
  await evaluate(cdp, '__editor.doRedo()'); await pause(800);
  assert.equal(await count(), c1, 'redo restores it');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ placed: c1 - c0, ghosts: painted.ghosts, undo: 'PASS', redo: 'PASS' }));
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  rmSync(profile, { recursive: true, force: true });
}
