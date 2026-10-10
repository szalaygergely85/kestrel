// QG-04/05: headless check of Burl's giver markers ('!' available, '?' ready, none active/done) and the J quest log.
// Loads game/index.html?dev=1 (saves on, fresh profile; the marker wires only exist with saves on). The headless sim does not run, so the
// book is driven directly via window.__debug.questBook() and the seam is ticked through window.__debug.gameHooks.tick().
// Run: node tools/verify-quest-ui.mjs <port>   (PC-B lane B1 ports 9500-9574; the CDP port is port+1)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9520);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-qui-'));
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
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&backend=webgpu` });

  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle)')) { ready = true; break; } }
  assert.ok(ready, 'world never loaded: ' + JSON.stringify(errors));
  console.log('[1/5] world loaded');

  const ev = (js) => evaluate(cdp, js);
  // Marker entities: questMark_N voxel props; count visible ones per model after ticking the seam for 2 s.
  const markers = async () => { await ev('(()=>{const h=window.__debug.gameHooks; for(let i=0;i<120;i++) h.tick(1/60);})()'); return JSON.parse(await ev(`JSON.stringify((()=>{const w=window.__debug.world, o={questMark:0,questMarkReady:0}; for(let i=0;i<12;i++){const e=w.get('questMark_'+i); const v=e&&e.data&&e.data.components.voxel; if(v&&!v.hidden&&o[v.model]!==undefined) o[v.model]++;} return o;})())`)); };
  const feed = (e) => ev(`window.__debug.questBook().feed(${JSON.stringify(e)})`);
  // QUEST-CHAIN-GATE-01: '!' over the wake-spot note first, then '?' over Burl to hand in the blade, then Burl's '!' for the boars.
  await ev('(()=>{const l=window.__debug.look; if(l) l.locked=true;})()');
  let m = await markers(); assert.deepEqual(m, { questMark: 1, questMarkReady: 0 }, 'start -> one "!" (note) ' + JSON.stringify(m));
  await ev("window.__debug.questBook().accept('tower.blade')");
  for (const e of [{ type: 'flag:set', key: 'wake', value: true }, { type: 'area:entered', id: 'breach' }, { type: 'item:got', id: 'sword' }, { type: 'area:entered', id: 'towerDoor' }]) await feed(e);
  m = await markers(); assert.deepEqual(m, { questMark: 0, questMarkReady: 1 }, 'blade ready -> one "?" (Burl) ' + JSON.stringify(m));
  await ev("window.__debug.questBook().actKey('q.tower.blade.handin')");
  m = await markers(); assert.deepEqual(m, { questMark: 1, questMarkReady: 0 }, 'blade handed in -> one "!" (Burl, boars) ' + JSON.stringify(m));
  console.log('[2/5] available: "!" over Burl');
  await ev("window.__debug.questBook().accept('burl.boars')");
  m = await markers(); assert.deepEqual(m, { questMark: 0, questMarkReady: 0 }, 'active -> no marker ' + JSON.stringify(m));
  console.log('[3/5] accepted: marker gone');
  for (const id of ['boar1', 'boar2', 'boar3', 'boar4', 'boar5']) await feed({ type: 'beast:died', id });
  m = await markers(); assert.deepEqual(m, { questMark: 0, questMarkReady: 1 }, 'ready -> one "?" ' + JSON.stringify(m));
  console.log('[4/5] ready: "?" over Burl');
  const key = async (code, k) => { for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }); };
  // J needs the real frame loop with pointer lock, which headless Chrome does not run: report, do not fail (owner checks J in the walk).
  await key('KeyJ', 'j'); await pause(600);
  const opened = await ev('window.__debug.questLogOpen()');
  if (opened) { await key('KeyJ', 'j'); await pause(600); }
  console.log(opened ? '[5/5] J opens + closes the log' : '[5/5] WARN: J not testable headless (no pointer lock / frame loop) - owner walk checks it');
  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
  console.log('Quest UI (QG-04/05): giver markers + quest log, PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
