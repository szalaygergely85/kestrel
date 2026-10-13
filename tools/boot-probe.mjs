#!/usr/bin/env node
// tools/boot-probe.mjs - headless boot timing: time to __debug.playerHandle, boot stage card, slowest requests, 404s.
//   node tools/boot-probe.mjs --port 9620 [--backend webgpu] [--query save=0] [--root <dir>]
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';
import { ROOT as R0, findBrowserBinary, waitForHttp, killTree, connectCdp, buildLaunchFlags, validatePort } from './capture-browser.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const port = Number(args.port); validatePort(port);
const ROOT = args.root ? path.resolve(args.root) : R0;
const backend = args.backend || 'webgpu';
const url = `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`backend=${backend}&${args.query || 'save=0'}`)}`;
const h = {}; const T0 = Date.now();
const cleanup = () => { if (h.b) killTree(h.b.pid); if (h.s) killTree(h.s.pid); if (h.dir) { try { rmSync(h.dir, { recursive: true, force: true }); } catch {} } };
setTimeout(() => { console.error('boot-probe: overall timeout'); cleanup(); process.exit(2); }, Number(args.timeout || 150) * 1000);
try {
  h.s = spawn('python', ['tools/serve.py', String(port)], { cwd: ROOT, stdio: 'ignore' });
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  const dbg = port + 1; validatePort(dbg);
  h.dir = path.join(os.tmpdir(), 'kestrel-bp-' + port);
  h.b = spawn(findBrowserBinary(), [`--remote-debugging-port=${dbg}`, '--headless=new', ...buildLaunchFlags({ backend }), '--no-sandbox', '--window-size=1280,720', `--user-data-dir=${h.dir}`, 'about:blank'], { stdio: 'ignore' });
  const cdp = await connectCdp(dbg, 15000);
  const reqs = new Map(); const logs = [];
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  cdp.onEvent((method, p) => { const m = { method };
    if (m.method === 'Network.requestWillBeSent') reqs.set(p.requestId, { url: p.request.url, t0: p.timestamp });
    else if (m.method === 'Network.loadingFinished') { const r = reqs.get(p.requestId); if (r) { r.t1 = p.timestamp; r.size = p.encodedDataLength; } }
    else if (m.method === 'Network.responseReceived') { const r = reqs.get(p.requestId); if (r) r.status = p.response.status; }
    else if (m.method === 'Runtime.consoleAPICalled' && (args.all || /boot|stage|ms since/i.test(JSON.stringify(p.args)))) { const l = p.args.map((a) => a.value !== undefined ? a.value : (a.description || a.type)).join(' ').slice(0, 4000); logs.push(l); if (args.all) console.log(((Date.now()-T0)/1000).toFixed(1)+'s '+l.slice(0,200)); };
  });
  const t0 = Date.now();
  await cdp.send('Page.navigate', { url });
  const r = await cdp.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, timeout: 200000, expression: `(async()=>{const s=performance.now();for(let i=0;i<4000&&!((${args.wait||'window.__debug&&window.__debug.playerHandle'}));i++)await new Promise(r=>setTimeout(r,50));return {ready:!!((${args.wait||'window.__debug&&window.__debug.playerHandle'})),t:performance.now()}})()` });
  console.log('time to ready (page ms):', JSON.stringify(r.result.value), 'wall ms', Date.now() - t0);
  console.log(logs.join('\n'));
  const list = [...reqs.values()].filter((x) => x.t1).map((x) => ({ ...x, d: (x.t1 - x.t0) * 1000 })).sort((a, b) => b.d - a.d);
  console.log('requests', reqs.size, 'slowest:'); for (const x of list.slice(0, 8)) console.log(' ', x.d.toFixed(0), 'ms', x.status, x.url.replace(/^.*127.0.0.1:\d+/, ''), x.size);
  console.log('non-200:', [...reqs.values()].filter((x) => x.status && x.status >= 400).map((x) => x.url.replace(/^.*127.0.0.1:\d+/, '') + ' ' + x.status).join(', '));
} finally { cleanup(); }
process.exit(0);
