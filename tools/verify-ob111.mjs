// OB-111 headless stills: the ford (?at=1045.96,1066.69,-87.13,246,-11) and the Braid bank (1029.5,990). Prints the F3-free state: look locked, under state.
// Run: node tools/verify-ob111.mjs 9725 -> docs/test-reports/captures/ob111-*.png
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9725);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob111-'));
const capDir = path.join(ROOT, 'docs', 'test-reports', 'captures'); mkdirSync(capDir, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, fails = 0;
const ev = (s) => evaluate(cdp, s);
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const SPOTS = [['ford', '1045.96,1066.69,-87.13,246,-11'], ['bank', '1029.5,990,-87.5,270,-11']];
  for (const [name, at] of SPOTS) {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&backend=webgpu&at=${at}` });
    let ready = false;   // WAIT until the world is loaded: player handle + look exist
    for (let i = 0; i < 200; i++) { await pause(300); if (await ev('!!(window.__debug && window.__debug.playerHandle && window.__debug.look)')) { ready = true; break; } }
    if (!ready) throw new Error('boot failed ' + name);
    await ev('window.__debug.look.locked = true');
    await pause(8000);   // terrain band + water pass settle
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(capDir, `ob111-${name}.png`), Buffer.from(r.data, 'base64'));
    console.log('PASS still', name, await ev('JSON.stringify(__debug.playerHandle.data.transform)'));
  }
} catch (e) { fails++; console.log('FAIL harness ' + (e && e.message)); }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {}
  process.exitCode = fails ? 1 : 0;
}
