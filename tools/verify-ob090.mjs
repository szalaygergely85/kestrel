// OB-090 headless stills at the river bank / ford (water look). Run: node tools/verify-ob090.mjs 9725 -> docs/test-reports/captures/ob090-*.png
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9725);
validatePort(port);
if (port < 9725 || port + 1 > 9799) throw new Error('PC-B lane B1 range is 9725-9799 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob090-'));
const capDir = path.join(ROOT, 'docs', 'test-reports', 'captures'); mkdirSync(capDir, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, fails = 0;
const report = (name, okk, info) => { if (!okk) fails++; console.log(`${okk ? 'PASS' : 'FAIL'} ${name}${info === undefined ? '' : ' ' + JSON.stringify(info)}`); };
const ev = (s) => evaluate(cdp, s);
async function still(name) { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(capDir, `ob090-${name}.png`), Buffer.from(r.data, 'base64')); }
const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k }); await pause(70); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); await pause(150); };
const tele = (x, y, z) => ev(`(()=>{const p=__debug.playerHandle.data.transform;p.x=${x};p.y=${y};p.z=${z};return 1;})()`);
const mouse = (type, button) => ev(`document.querySelector('canvas').dispatchEvent(new MouseEvent('${type}',{button:${button},bubbles:true}))`);
const mp = () => ev('__debug.playerHandle.data.components.mana.mp');
const potions = () => ev(`__debug.playerHandle.data.components.inventory.slots.reduce((a,s)=>a+(s.id==='potion.mp'?s.n:0),0)`);
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await ev('!!(window.__debug && window.__debug.playerHandle && window.__debug.look)')) { ready = true; break; } }
  if (!ready) throw new Error('boot failed');
  await ev('__debug.look.locked = true');
  await pause(6000);
  const views = [['a1', 1046, 1062, -87.3, 270, -22], ['a5', 1040, 1074, -88, 250, -14]];
  for (const [n, x, y, z, yaw, pitch] of views) {
    await tele(x, y, z); await ev(`(__debug.look.yawDeg=${yaw},__debug.look.pitchDeg=${pitch},1)`); await pause(5000); await still(n);
    console.log(n, await ev('JSON.stringify(__debug.playerHandle.data.transform)'));
  }
} catch (e) { fails++; console.log('FAIL harness ' + (e && e.message)); }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {}
  process.exitCode = fails ? 1 : 0;
}
