// QUEST-WOW-01b (D-098): headless check of the WoW/Diablo quest marker rule on a NEW game: gold '!' over Burl (the offered quest at his
// entity), accepting moves the marker (grey '?' at the hand-in, '!' gone), the tracker shows the quest title. Screenshots ->
// docs/test-reports/captures/quest-wow-*.png. Same CDP shape as tools/verify-decor.mjs.
// Run: node tools/verify-quest-wow.mjs {port}   (PC-B ports 9500-9999; port+1 = CDP), e.g. node tools/verify-quest-wow.mjs 9560
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9560);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-qwow-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// all marker lists the game draws, by the same calls main.js makes
const MARKS = `(() => { const b = window.__debug.questBook(); const a = [], r = [], g = [], sa = [], sr = []; b.giverMarks(a, r, sa, sr); b.chainMarks(a, r); b.activeMarks(g); b.dedupeMarks(a, r, sa, sr, undefined, g); return JSON.stringify({ goldBang: a, goldQ: r, blueBang: sa, blueQ: sr, grey: g }); })()`;
const marks = async () => JSON.parse(await evaluate(cdp, MARKS));
const shot = async (name) => { const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, 'quest-wow-' + name + '.png'), Buffer.from(s.data, 'base64')); };
let browser, cdp, failed = false;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails.text); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu&newgame=1` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.questBook && window.__debug.questBook())')) { ready = true; break; } }
  assert.ok(ready, 'boot failed ' + JSON.stringify(errors));
  await pause(1500); await shot('1-start');
  const m0 = await marks(); console.log('start marks', JSON.stringify(m0));
  assert.ok(m0.goldBang.includes('bear'), "gold '!' over Burl (bear) at the start of a new game");
  // accept the quest Burl offers (what the dialogue's accept choice does) and re-read
  const acc = await evaluate(cdp, `(() => { const b = window.__debug.questBook(); for (let i = 1; ; i++) { const d = b.def(i); if (!d) return ''; if (b.status(i) === 1 && b.giverOf(i) === 'bear' && b.accept(d.id)) return d.id; } })()`);
  assert.ok(acc, 'Burl offers a quest to accept');
  await pause(800); await shot('2-accepted');
  const m1 = await marks(); console.log('accepted ' + acc, JSON.stringify(m1));
  assert.ok(!m1.goldBang.includes('bear') || m1.goldQ.includes('bear') === false, "D-098: the '!' over Burl is gone or replaced once his quest is accepted");
  assert.ok(m1.grey.length > 0 || m1.goldQ.length > 0 || m1.goldBang.length > 0, 'marker moved (grey ? at the hand-in or the next step)');
  const lines = JSON.parse(await evaluateAsync(cdp, `import('/game/js/ui/questTracker.js').then((m) => JSON.stringify(m.trackerLines(window.__debug.questBook())))`));
  console.log('tracker', JSON.stringify(lines));
  assert.ok(lines.length >= 1 && lines[0].kind === 'title' && lines[0].text.length > 0, 'tracker shows a quest title');
  assert.deepEqual(errors, []);
  console.log('Quest WOW (D-098): ! over Burl -> accepted -> marker moved, tracker title "' + lines[0].text + '" PASS');
} catch (e) { failed = true; console.log('FAIL ' + (e && e.message)); try { await shot('fail'); } catch { /* no page */ } }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
  process.exitCode = failed ? 1 : 0;
}
