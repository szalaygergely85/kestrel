#!/usr/bin/env node
// tools/verify-prompt-scale.mjs {port}  (OB-051b, docs/architecture.md 38.48)
// Boots the game headless, waits for an interaction prompt and asserts the
// prompt row cells of the UI layer carry bit 7 (2x scaled) with an even origin
// and width 2*len. Saves docs/test-reports/ob051/prompt.png. Own server on {port}
// (9500-9999), stops only itself. NOTE: needs game/js/main.js uiStyle.prompt.scale = 2.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const port = Number(process.argv[2] || process.env.PORT);
if (!(port >= 9500 && port <= 9999)) { console.error('usage: verify-prompt-scale.mjs <port 9500-9999>'); process.exit(2); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs/test-reports/ob051');
mkdirSync(out, { recursive: true });

const server = spawn('python', ['-m', 'http.server', String(port)], { cwd: root, stdio: 'ignore' });
const chrome = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let browser = null, code = 1;
const cleanup = () => { try { browser && browser.kill(); } catch {} try { server.kill(); } catch {} };
process.on('exit', cleanup);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const cdpPort = port + 1 <= 9999 ? port + 1 : port - 1;
  const { existsSync } = await import('node:fs');
  const exe = chrome.find((p) => existsSync(p));
  if (!exe) throw new Error('no chrome/edge found (set CHROME)');
  browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${cdpPort}`, '--window-size=1280,720', '--user-data-dir=' + path.join(out, '.profile'),
    `http://localhost:${port}/game/index.html?debug=1`], { stdio: 'ignore' });
  let ws = null;
  for (let i = 0; i < 60 && !ws; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
      const pg = list.find((t) => t.type === 'page');
      if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl);
    } catch {}
  }
  if (!ws) throw new Error('no CDP page');
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { pend.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

  // Page hook: __debug.getUi() (UiLayer) - the debug handle main.js exposes; adapt here if renamed.
  const probe = `(() => { const d = window.__debug; const ui = d && d.getUi && d.getUi(); if (!ui) return null;
    const c = ui.cells, W = ui.cols, H = ui.rows; let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, flagged = 0, opaque = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!c.mask[i] || c.bg[i * 4 + 3] !== 255) continue; opaque++;
      if (c.fg[i * 4 + 3] & 128) { flagged++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } }
    return { flagged, opaque, minX, maxX, minY, maxY }; })()`;
  let res = null;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    res = await evalJs(probe);
    if (res && res.flagged > 0) break;
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) writeFileSync(path.join(out, 'prompt.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('probe', JSON.stringify(res));
  const okAll = res && res.flagged > 0 && res.flagged === res.opaque && res.minX % 2 === 0 && res.minY % 2 === 0
    && (res.maxX - res.minX + 1) % 2 === 0 && res.maxY - res.minY === 1;
  console.log(okAll ? 'PASS prompt carries 2x bit, even origin, 2 rows' : 'FAIL (no prompt in reach, scale not 2 in main.js, or __debug.getUi missing)');
  code = okAll ? 0 : 1;
  try { ws.close(); } catch {}
} catch (e) { console.error('ERROR', e.message); }
cleanup();
process.exit(code);
