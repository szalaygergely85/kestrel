// BEAST-WIRE-01: headless check that the spawn director is live in the real game: kill group 0, fast-forward the director clock, assert it respawns (sim slots alive again), difficulty applies, no page errors. CDP shape of verify-decor.mjs.
// Run: node tools/verify-beast-respawn.mjs {port}    (PC-B ports 9500-9574; port+1 = CDP). Needs window.__debug.beastDir (main.js).
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const args = process.argv.slice(2);
const port = Number(args[0] || 9575);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const backend = args[1] && !args[1].startsWith('--') ? args[1] : 'webgpu';
assert.ok(backend === 'webgpu', 'backend must be webgpu');
const atIx = args.indexOf('--at'), at = atIx >= 0 ? args[atIx + 1] : '1045.96,1066.69,-87.13,246,-11';

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-beastresp-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, failed = false, warns = [];
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; warns = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails.text); if (m === 'Runtime.consoleAPICalled' && (p.type === 'warning' || p.type === 'error')) warns.push(p.type + ': ' + p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=${backend}&at=${at}` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.beastDir && window.__debug.beasts)')) { ready = true; break; } }
  assert.ok(ready, 'boot failed or window.__debug.beastDir missing ' + JSON.stringify(errors));
  const r = JSON.parse(await evaluate(cdp, `(() => { const w = window.__debug.beastDir, d = w.dir, g = w.groups[0];
    for (let k = 0; k < g.slots.length; k++) { d.memberDied(0); }
    const dead = d.dead[0], before = d.respawns;
    for (let k = 0; k < 400; k++) w.step(100, -5000, -5000, -1, 0);
    const hard = w.setDifficulty('hard'), n = g.slots.length;
    return JSON.stringify({ groups: w.groups.length, dead, respawned: d.respawns - before, alive: d.alive[0], n, hard, diff: d.diffName });
  })()`));
  console.log(JSON.stringify(r));
  assert.ok(r.groups > 0, 'groups built from the regional herds');
  assert.equal(r.dead, 1, 'group dead after memberDied x N');
  assert.ok(r.respawned >= 1 && r.alive === r.n, 'director respawned the group');
  assert.equal(r.hard, true); assert.equal(r.diff, 'hard');
  assert.deepEqual(errors, []);
  assert.deepEqual(warns.filter((w) => /used in submit while destroyed/i.test(w)), [], 'OB-119: no destroyed-buffer submit warnings');
  console.log('Beast respawn wire PASS');
} catch (e) { failed = true; console.log('FAIL ' + (e && e.message)); for (const w of warns.filter((x) => /decor|WgCell|WebGPU|gpu/i.test(x)).concat(warns).slice(0, 12)) console.log('  console ' + w); }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
  process.exitCode = failed ? 1 : 0;
}
