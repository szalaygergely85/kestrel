// Run: node tools/verify-poi.mjs {port}  (9500-9574; port+1 = CDP). Needs window.__debug.poi (main.js).
// POI-03 + POI-CHEST-01 (OB-141): teleport next to the first earned POI chest: found + map mark, press E, loot in the pack. Original note: the item is in the pack, the map mark exists.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const args = process.argv.slice(2);
const port = Number(args[0] || 9575);
if (!args[0]) console.log('usage: node tools/verify-poi.mjs {port 9500-9574}');
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const backend = args[1] && !args[1].startsWith('--') ? args[1] : 'webgpu';
assert.ok(backend === 'webgpu', 'backend must be webgpu');
const at = '1045.96,1066.69,-87.13,246,-11';

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-poi-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (js) => JSON.parse(await evaluate(cdp, `JSON.stringify((() => { ${js} })())`));
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
  for (let i = 0; i < 200; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.look && window.__debug.poi)')) { ready = true; break; } }
  assert.ok(ready, 'boot failed or window.__debug.poi missing (NEEDS B1-main) ' + JSON.stringify(errors));
  await evaluate(cdp, 'window.__debug.look.locked = true');
  const cd = await ev('const d = window.__debug.poi.wire.chestDefs(); const e = d[0]; return e ? { id: e.id, x: e.x, y: e.y, z: e.z, fx: e.frontX, fy: e.frontY } : null;');
  assert.ok(cd, 'a POI with an earned chest exists');
  const poiName = await ev(`const w = window.__debug.poi.wire; const d = w.defs.find((q) => q.id === ${JSON.stringify(cd.id.replace(/\.p\d+$/, ''))}); return d.name;`);
  // stand 1 m in front of the chest (front = chest -> player), looking at it (yaw 0 = -y, the chest test pose), then let the POI spawn + step
  await evaluate(cdp, `(() => { const t = window.__debug.playerHandle.data.transform; t.x = ${cd.x + cd.fx}; t.y = ${cd.y + cd.fy}; t.z = ${cd.z + 1}; })()`);
  await evaluate(cdp, 'window.__debug.look.yawDeg = 0; window.__debug.look.pitchDeg = -25');
  await pause(2500);
  const found = await ev(`const w = window.__debug.poi.wire; return w.defs.filter((d) => w.isFound(d.id)).map((d) => d.name);`);
  assert.ok(found.includes(poiName), 'Found: ' + poiName + ' (discovered), got ' + JSON.stringify(found));
  const marks = await ev('return window.__debug.poi.discover.marks().length;'); assert.ok(marks >= 1, 'M map has a mark');
  const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k }); await pause(90); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); await pause(150); };
  const packBefore = await ev('const inv = window.__debug.playerHandle.data.components.inventory; return JSON.stringify(inv.pack);');
  await key('KeyE', 'e'); await pause(3000);
  const opened = await ev(`return window.__debug.poi.wire.isFound(${JSON.stringify(cd.id.replace(/\.p\d+$/, ''))});`);
  const packAfter = await ev('const inv = window.__debug.playerHandle.data.components.inventory; return JSON.stringify(inv.pack);');
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, 'poi-chest.png'), Buffer.from(shot.data, 'base64'));
  console.log('POI ' + poiName + ' found=' + opened + ' pack before/after ' + packBefore + ' -> ' + packAfter);
  assert.notEqual(packAfter, packBefore, 'the chest loot went into the pack');
  assert.deepEqual(errors, []);
  console.log('POI discover + chest PASS');
} catch (e) { failed = true; console.log('FAIL ' + (e && e.message)); for (const w of warns.slice(0, 8)) console.log('  console ' + w); }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
  process.exitCode = failed ? 1 : 0;
}
