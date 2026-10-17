// CUR-02: coin shows in the inventory (always) and on the HUD for 3 s after wallet:changed.
// Run: node tools/verify-coin-ui.mjs 9500   (PC-B lane B1 ports 9500-9574; CDP = port+1). Boot/__debug pattern of verify-note-close.mjs.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-coin-ui-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?debug=1` });
  let ready = false;
  for (let i = 0; i < 100; i++) { await pause(400); if (await evaluate(cdp, '!!(window.__debug && window.__debug.engine && window.__debug.engine.world && window.__debug.playerHandle)')) { ready = true; break; } }
  assert.ok(ready, 'game did not boot');
  const ev = (js) => evaluate(cdp, js);
  const shot = async (name) => { const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, 'coin-ui-' + name + '.png'), Buffer.from(s.data, 'base64')); };
  // inventory screen text rendered into a fake ui (no input needed)
  const invText = () => ev(`(()=>{const v=__debug.invView; const wasOpen=v.isOpen; v.open(); const cols=160,rows=60,ch=new Int32Array(cols*rows).fill(-1); const ui={cols,rows,setCellRGB(x,y,c){if(x>=0&&y>=0&&x<cols&&y<rows)ch[y*cols+x]=c+32;},clear(){}}; v.draw(ui); if(!wasOpen&&v.close)v.close(); let s=''; for(let i=0;i<ch.length;i++)s+=ch[i]<0?' ':String.fromCharCode(ch[i]); return s;})()`);
  assert.equal(await ev('__debug.coinHud.alpha()'), 0, 'HUD hidden at start');
  const base = await ev('__debug.saveRelay.wallet.get()');
  assert.match(await invText(), new RegExp('Coin ' + base + '(?!\d)'), 'inventory shows Coin ' + base);
  await ev('__debug.saveRelay.wallet.add(7)');
  assert.equal(await ev('__debug.coinHud.alpha()'), 1, 'HUD shown after change');
  await pause(500); await shot('hud');
  assert.match(await invText(), new RegExp('Coin ' + (base + 7) + '(?!\d)'), 'inventory shows new value');
  await pause(3500);
  assert.equal(await ev('__debug.coinHud.alpha()'), 0, 'HUD hidden after 3.5 s');
  console.log('PASS coin ui', base, '->', base + 7);
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
}
