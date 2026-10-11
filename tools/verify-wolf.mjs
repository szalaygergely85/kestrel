// WOLF-01: headless check at ?pose=outwall. Run: node tools/verify-wolf.mjs <port 9500-9574> [backend]
// With MAP-26's wolf1..5 anchors present: wolves exist as beasts (species wolf, 3 hp), the sim is stepped by hand with
// the player standing 8 m from the pack and the attack token is never shared. Without anchors it prints SKIP.
import { spawn } from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9540);
const backend = process.argv[3] || 'webgpu';
validatePort(port);
if (port < 9500 || port + 1 > 9574) throw new Error('PC-B lane B1 range is 9500-9574 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-wolf-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = [];
  cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`dev=1&pose=outwall&backend=${backend}`)}` });
  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle)')) { ready = true; break; } }
  assert.ok(ready, 'world never ready: ' + JSON.stringify(errors));
  const r = JSON.parse(await evaluate(cdp, `(()=>{const b=window.__debug.beasts;if(!b)return JSON.stringify({wolves:0});
    const w=[];for(let i=0;i<b.count;i++)if(b.wolf[i])w.push(i);if(!w.length)return JSON.stringify({wolves:0});
    const t=window.__debug.playerHandle.data.transform;let maxTok=0;
    for(let k=0;k<1800;k++){b.step(t.x,t.y,t.z);let n=0;for(const i of w){const s=b.state[i];if(s===3||s===4)n++;}if(n>maxTok)maxTok=n;}
    return JSON.stringify({wolves:w.length,hp:b.entities[w[0]].components.health.max,maxTok});})()`));
  if (!r.wolves) console.log('wolf: SKIP (no wolf1..5 anchors in the world yet - MAP-26)');
  else { assert.ok(r.hp >= 3, 'wolf hp ' + r.hp + ' (base 3, US-129a band multiplier at the Outwall)'); assert.ok(r.maxTok <= 1, 'token shared'); console.log(`wolf: PASS (${r.wolves} wolves, max attackers ${r.maxTok})`); }
  assert.deepEqual(errors, [], 'console errors: ' + JSON.stringify(errors));
  globalThis.__wolfOk = true;
} finally {
  try { cdp && cdp.close && cdp.close(); } catch {}
  if (browser) killTree(browser);
  killTree(server);
  setTimeout(() => process.exit(globalThis.__wolfOk ? 0 : 1), 3000).unref(); // never hang on an open CDP socket (batch waited 40 min)
}
