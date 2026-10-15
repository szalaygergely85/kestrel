// B1-MAIN hooks 7: real-game check of the Ford cellar ladder (UNDER-03) and the crypt door gate (UNDER-02).
// Cellar: stand at the trapdoor, REAL E -> player z near -92.5, E at the ladder -> back on the surface.
// Crypt: no key -> door stays shut; give key via the ?dev=1 hook window.__kestrel.giveItem('key.crypt'), E -> under.crypt.doorOpen.
// Run: node tools/verify-under.mjs {port}   (PC-B port 9500-9999; CDP = port+1)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9575);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-under-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, code = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + JSON.stringify(extra) : '')); if (!ok) code = 1; };
const press = async () => { for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, text: type === 'keyDown' ? 'e' : undefined }); await pause(900); };
const boot = async (at) => {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&save=1&nopause=1&title=0&at=${at}` });
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__kestrel && window.__kestrel.giveItem)')) return pause(1500); }
  throw new Error('game did not boot');
};
const pos = () => evaluate(cdp, `(()=>{const t=window.__debug.playerHandle.data.transform;return {x:t.x,y:t.y,z:t.z};})()`);
const stand = (id, dy, dz) => evaluate(cdp, `(()=>{const d=window.__debug,a=d.world.entity('${id}').transform,t=d.playerHandle.data.transform;t.x=a.x;t.y=a.y+(${dy});t.z=a.z+(${dz});return [a.x,a.y,a.z];})()`);
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  // --- cellar
  await boot('1000.5,1057.5,0,90,0');
  console.log('anchor', JSON.stringify(await stand('cellarTrapdoor', -0.4, 0.05)));
  await pause(600);
  await press(); await pause(600);
  const down = await pos(); console.log('after E at trapdoor', JSON.stringify(down));
  check('cellar: player below ground (z near -92.5)', Math.abs(down.z - -92.5) < 3, down);
  await stand('cellarLadder', -0.4, 0.05); await pause(400);
  await press(); await pause(600);
  const up = await pos(); console.log('after E at ladder', JSON.stringify(up));
  check('cellar: back on the surface', up.z > -90.5, up);
  // --- crypt
  await boot('1649,1372.9,0,90,0');
  await stand('cemeteryCryptDoor', -1.5, 0.05); await pause(600);
  const door = () => evaluate(cdp, `!!window.__debug.world.state['under.crypt.doorOpen']`);
  await press();
  check('crypt: no key -> door stays shut', (await door()) === false);
  await evaluate(cdp, `window.__kestrel.giveItem('key.crypt')`);
  await press();
  check('crypt: with key -> doorOpen flag set', (await door()) === true);
} catch (e) { console.error('FAIL', e.message); code = 1; }
finally { try { cdp && cdp.close && cdp.close(); } catch {} if (browser) killTree(browser.pid); killTree(server.pid); process.exit(code); }
