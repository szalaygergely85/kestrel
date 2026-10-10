// QUEST-CHAIN-Q-01: headless check that tower.blade ends READY ('?' over bear) with note-first and sword-first. Run: node tools/verify-blade-chain.mjs <port 9500-9574>
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9530);
const backend = process.argv[3] || 'webgpu';
const outDir = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(outDir, { recursive: true });
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-blade-'));
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
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`dev=1&save=1&backend=${backend}`)}` });
  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.saveRelay && window.__debug.questBook())')) { ready = true; break; } }
  assert.ok(ready, 'world / saveRelay never ready (needs ?save=1): ' + JSON.stringify(errors));
  const D = (js) => evaluate(cdp, js);
  // The sim does not run headless: the fixed-step lines are replayed by hand (saveRelay.stepGame = main.js step; actKey = main.js note-accept line).
  for (const order of ['noteFirst', 'swordFirst']) {
    await D(`(()=>{const d=window.__debug,b=d.saveRelay.quest;b.reset(null,null);const w=d.world;delete w.state['notes.keepLight.read'];delete w.state['tower.sword.taken'];})()`);
    const st = (js) => D(`(()=>{const d=window.__debug,w=d.world,sr=d.saveRelay,o={wakeDone:true,canSave:false};const step=(x,y,z)=>sr.stepGame(1/60,w,{x,y,z},o);const read=()=>{w.state['notes.keepLight.read']=true;sr.quest.book.actKey('q.tower.blade.accept');};${js}})()`);
    assert.equal(await st("return sr.quest.book.statusOf('tower.blade')"), 1, 'available at boot');
    if (order === 'noteFirst') await st('read()');
    await st("const t=w.get('tower.noteKeepLight')||null;step(1486.5,1025,6.5);");
    await st("w.state['tower.sword.taken']=true;step(1497,1027,0.5);");
    await st("const z=w.triggers.find(q=>q.key==='world.towerDoor');step(z.x,z.y,w.heightAt(z.x,z.y)||0);");
    if (order === 'swordFirst') await st('read()');
    assert.equal(await st("return sr.quest.book.statusOf('tower.blade')"), 3, order + ': blade READY');
    const ready2 = await st("const a=[],r=[];sr.quest.book.giverMarks(a,r);return JSON.stringify(r)");
    assert.equal(ready2, '["bear"]', order + ": '?' over bear");
  }
  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
  console.log('blade chain (both orders): PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
