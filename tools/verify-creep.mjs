// UNDER-LIGHT-CREEP-01: still of the crypt interior (room 1) -> docs/test-reports/creep-crypt.png (needs B1-main wiring of game/js/quest/under/creep.js).
// Run: node tools/verify-creep.mjs {port}   (PC-B port 9500-9999; CDP = port+1)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9577);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-creep-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, code = 0;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  // crypt level origin (1650,1346,-60); room 1 centre local (24.5, 26.5), floor -56.8, facing north
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&save=1&nopause=1&title=0&at=1674.5,1372.5,-56.8,0,0` });
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle)')) break; }
  await pause(4000); // > 0.75 s creep fade-in + a few mote spawns
  const amb = await evaluate(cdp, `(()=>{const t=window.__debug.playerHandle.data.transform,s=window.__debug.world.structureAt(t.x,t.y);return s&&s.level&&s.level.ambience||null;})()`);
  console.log('ambience', amb); if (amb !== 'crypt') { console.log('FAIL not in crypt'); code = 1; }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const out = path.join(ROOT, 'docs', 'test-reports', 'creep-crypt.png'); writeFileSync(out, Buffer.from(shot.data, 'base64')); console.log('wrote', out);
} catch (e) { console.error('FAIL', e.message); code = 1; }
finally { try { cdp && cdp.close && cdp.close(); } catch {} if (browser) killTree(browser.pid); killTree(server.pid); process.exit(code); }
