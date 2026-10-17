// Screenshot section "0b. OB-092 grip hands close-up" of design/preview/chargen_kit.html.
// Usage: node tools/shot-chargen-hands.mjs <port 9500-9574>   (own static server + headless browser, both killed at the end)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, CAPTURES_DIR, findBrowserBinary, waitForHttp, killTree, connectCdp, evaluate } from './capture-browser.mjs';

const port = Number(process.argv[2]);
if (!(port >= 9500 && port <= 9999)) { console.error('usage: node tools/shot-chargen-hands.mjs <port 9500-9999>'); process.exit(2); }
const cdpPort = port + 1000 > 65000 ? port - 1000 : port + 1000;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

const bin = findBrowserBinary();
if (!bin) { server.close(); console.error('no Chrome/Edge found (set CHROME_PATH)'); process.exit(1); }
const userDir = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'shot-hands-'));
const proc = spawn(bin, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDir}`, '--window-size=1500,1400',
  '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let code = 0;
try {
  const cdp = await connectCdp(cdpPort);
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1400, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/design/preview/chargen_kit.html` });
  await waitForHttp(`http://127.0.0.1:${port}/design/preview/chargen_kit.html`, 5000);
  await sleep(3000);   // page script renders synchronously, then the kit JSON fetches re-render
  const rect = await evaluate(cdp, `(() => {
    const h = [...document.querySelectorAll('h3')].find((e) => e.textContent.startsWith('0b.'));
    if (!h) return null;
    const hands = document.getElementById('hands');
    h.scrollIntoView();
    const a = h.getBoundingClientRect(), b = hands.getBoundingClientRect();
    return { x: 0, y: a.top + scrollY, w: innerWidth, h: b.bottom - a.top };
  })()`);
  if (!rect) throw new Error('section 0b not found');
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: rect.x, y: rect.y, width: rect.w, height: Math.ceil(rect.h) + 8, scale: 1 } });
  fs.mkdirSync(CAPTURES_DIR, { recursive: true });
  const out = path.join(CAPTURES_DIR, 'ob092-hands.png');
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('wrote', out);
  cdp.close();
} catch (e) { console.error(String(e.message || e)); code = 1; }
finally { killTree(proc.pid); server.close(); try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {} }
process.exit(code);
