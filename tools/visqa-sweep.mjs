// VISQA-01: visual-QA sweep. Live clock (NOT ?at=/?pose=, those freeze liveLook), god mode + ground snap, ~11 spots x 3 hours.
// Run: node tools/visqa-sweep.mjs <port> (PC-B 9500-9999, CDP = port+1)  -> docs/test-reports/visqa/<spot>-<hh>.png + index.md
// Env: HOURS=9,13,22  ONLY=ford,bend (spot filter)  SETTLE=6000 (ms per spot)
import { spawn } from 'node:child_process';
import { writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from './capture-browser.mjs';

// [name, x, y, yawDeg (0 = north/-y, 90 = east), pitchDeg, note]
export const SPOTS = [
  ['tower-door', 1488, 1040, 0, 6, 'tower SW door from the south'],
  ['meadow-road', 1440, 1040, 270, 0, 'start meadow, road west'],
  ['forest-in', 1250, 1062, 270, 0, 'densest tree cell (41..42,35)'],
  ['forest-edge', 1172, 1044, 90, 0, 'QL-B2 forestEdge zone, looking into the forest'],
  ['ford', 1010, 1072, 90, 0, 'fordWest, across the stepping stones'],
  ['bend', 1262, 1042, 0, 0, 'Bend relay/waystone'],
  ['cemetery', 1644, 1382, 0, 0, 'cemetery1'],
  ['braid-falls', 1238, 632, 0, 12, 'braidFalls from below'],
  ['cliff', 1552, 468, 0, 12, 'northwood hillside cliff face (~9 m rise at y 454-458), looking up from below (VISQA-09; the old 1250,596 spot stood in the outlet river)'],
  ['lake-shore', 1215, 547, 0, 0, 'Glasswater south shore'],
  ['burl-home', 1404, 1019, 0, 4, "Burl's new home (1404,1010)"],
];
const port = Number(process.argv[2] || 9725); validatePort(port);
const hours = (process.env.HOURS || '9,13,22').split(',').map(Number);
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const spots = SPOTS.filter((s) => !only || only.includes(s[0]));
const settle = Number(process.env.SETTLE || 6000);
const outDir = path.join(ROOT, 'docs/test-reports/visqa'); mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-visqa-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp; const rows = [];
const killer = setTimeout(() => { console.error('visqa-sweep timeout'); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid); process.exit(2); }, 900000);
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({ backend: 'webgpu' }), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') console.log('EXC', JSON.stringify(p.exceptionDetails).slice(0, 400)); if (m === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) console.log('console', p.type, (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)); });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (const h of hours) {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?save=0&nopause=1&quality=medium&backend=webgpu&title=0&time=${h}${(process.env.QS || '').split('|')[hours.indexOf(h)] || ''}` });   // QS='&scatter=0|&aamesh=0' = extra query per HOURS entry (dev probe)
    let ok = false;
    for (let i = 0; i < (Number(process.env.READY_TRIES) || 600) && !ok; i++) { await pause(300); try { ok = !!(await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.world) && !/Checking your graphics/.test(document.body.innerText||"")')); } catch { /* navigating */ } }
    if (!ok) throw new Error('never ready ' + JSON.stringify(await evaluateAsync(cdp, '(async()=>location.href+" "+document.readyState+" "+document.title+" "+document.body.innerHTML.length+" "+JSON.stringify(window.__debug&&window.__debug.bootErrors))()').catch((e) => String(e))));
    await pause(4000);
    for (const [name, x, y, yaw, pitch, note] of spots) {
      const gz = await evaluate(cdp, `(()=>{const t=__debug.playerHandle.data.transform;t.x=${x};t.y=${y};if(__debug.vitals&&__debug.vitals.setGodMode)__debug.vitals.setGodMode(true);const T=__debug.world.terrain,gz=(T.groundAt||T.heightAt).call(T,${x},${y});t.z=(gz==null?t.z:gz+0.2);t.yawDeg=${yaw};t.pitchDeg=${pitch};const L=__debug.look;if(L){L.yawDeg=${yaw};L.pitchDeg=${pitch};}return gz})()`);
      // VISQA-09: a new game has Burl at the tower; for the home spot put him at his post-departure home (walks.home, OB-212)
      if (name === 'burl-home') await evaluate(cdp, `(()=>{const b=__debug.world.get('bear');if(b&&b.data.transform){b.data.transform.x=1404;b.data.transform.y=1010;const T=__debug.world.terrain;const g=(T.groundAt||T.heightAt).call(T,1404,1010);if(g!=null)b.data.transform.z=g;}return !!b})()`);
      await pause(settle);
      if (process.env.EVAL) console.log('eval', name, h, JSON.stringify(await evaluate(cdp, process.env.EVAL.replace(/\$X/g, x).replace(/\$Y/g, y))));   // dev probe (env EVAL, $X/$Y = spot)
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = `${name}-${String(h).padStart(2, '0')}.png`;
      writeFileSync(path.join(outDir, file), Buffer.from(s.data, 'base64'));
      rows.push({ name, h, file, x, y, yaw, pitch, gz, note }); console.log('still', file, 'gz', gz);
    }
  }
} finally {
  clearTimeout(killer); cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}
// contact sheet from every still in the folder (a partial re-run with ONLY/HOURS keeps the other cells): one row per spot, one column per hour
const files = readdirSync(outDir).filter((f) => /-\d\d\.png$/.test(f));
const hs = [...new Set(files.map((f) => Number(f.slice(-6, -4))))].sort((a, b) => a - b);
let md = `# VISQA-01 sweep

\`node tools/visqa-sweep.mjs <port>\` - live clock, god mode + ground snap, quality=medium, webgpu, 1000x700.

| spot | pose | ${hs.map((h) => h + ':00').join(' | ')} |
|---|---|${hs.map(() => '---').join('|')}|
`;
for (const [name, x, y, yaw, pitch, note] of SPOTS) md += `| ${name} | ${x},${y} yaw ${yaw} pitch ${pitch} - ${note} | ${hs.map((h) => { const f = `${name}-${String(h).padStart(2, '0')}.png`; return files.includes(f) ? `![${f}](${f})` : '-'; }).join(' | ')} |
`;
writeFileSync(path.join(outDir, 'index.md'), md);
console.log('wrote', rows.length, 'stills + index.md');
