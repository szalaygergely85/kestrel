// FLICKER-STILL-WALK-01: flicker score at 4 fixed spots with the player STANDING STILL (camera does not move, time frozen).
// Run: node tools/flicker-walk.mjs <port> [backend=webgpu] [--baseline [file]] [--save]   (PC-B ports 9500-9999, CDP = port+1)
//   no flag      : print the score per spot, write docs/test-reports/flicker-walk.md
//   --save       : write the run as the baseline json (docs/test-reports/flicker-walk-baseline.json or the given file)
//   --baseline   : compare with the baseline json, exit 1 if a spot is > 1.5x baseline
// Default path = stable pass OFF (D-119): no `stable=1` in the query; the report header says so.
// Method: the live flicker harness (game/js/dev/flickerLive.js runLivePoses -> flickerStep/flickerReprojStep from
// engine/render/gpu/flicker.js, the same scoring as tools/flicker-gate.mjs) with four extra poses `walk:true, stepM:0`
// (walkCam with 0 m = the camera never moves; wind speed is 0 in the harness, `at=` freezes the clock). The poses are added
// to the shared POSES_ALL array from a document-start script, then `&flickerpose=<slug>` selects one per page load.
// Score = glyphOnlyPct (mean % of same-surface cells whose glyph changed between consecutive frames, 30 frames).
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

// [slug, x, y, yawDeg, pitchDeg]: poses of tools/visqa-sweep.mjs SPOTS (meadow-road, forest-edge, cemetery, ford)
export const SPOTS = [
  ['meadow', 1440, 1040, 270, 0],
  ['forestEdge', 1172, 1044, 90, 0],
  ['cemetery', 1644, 1382, 0, 0],
  ['ford', 1010, 1072, 90, 0],
];
export const FACTOR = 1.5, ABS_EPS = 0.05; // ABS_EPS: a 0.00 baseline must not fail on 0.03
export const DEFAULT_BASELINE = path.join(ROOT, 'docs', 'test-reports', 'flicker-walk-baseline.json');
export const REPORT = path.join(ROOT, 'docs', 'test-reports', 'flicker-walk.md');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Pure. current/baseline: { spots: {slug: {score}} } -> { ok, rows:[{spot,score,baseline,limit,verdict}], messages }. */
export function compareBaseline(current, baseline, factor = FACTOR) {
  const rows = [], messages = [];
  const names = [...new Set([...Object.keys(baseline.spots || {}), ...Object.keys(current.spots || {})])];
  for (const spot of names) {
    const b = baseline.spots?.[spot]?.score, c = current.spots?.[spot]?.score;
    if (!isNum(c)) { rows.push({ spot, score: null, baseline: isNum(b) ? b : null, limit: null, verdict: 'FAIL' }); messages.push(`spot "${spot}" is missing from this run`); continue; }
    if (!isNum(b)) { rows.push({ spot, score: c, baseline: null, limit: null, verdict: 'NEW' }); continue; }
    const limit = b * factor + (b === 0 ? ABS_EPS : 0);
    const bad = c > limit;
    rows.push({ spot, score: c, baseline: b, limit, verdict: bad ? 'FAIL' : 'PASS' });
    if (bad) messages.push(`spot "${spot}" ${c.toFixed(2)} % > ${factor}x baseline ${b.toFixed(2)} % (limit ${limit.toFixed(2)})`);
  }
  return { ok: rows.every((r) => r.verdict !== 'FAIL'), rows, messages };
}

const f2 = (v) => (isNum(v) ? v.toFixed(2) : '-');
/** Pure markdown report. run: { spots:{slug:{score,totalPct,rawPct,shiftPct,cols,rows}}, sha, date, backend }; result: compareBaseline() output or null. */
export function formatReport(run, result = null) {
  const L = ['# Flicker, standing still (FLICKER-STILL-WALK-01)', '',
    `Path: default, stable pass OFF (D-119). Backend ${run.backend || 'webgpu'}. Player standing, camera fixed, time frozen, ${run.frames || 30} frames per spot. ${run.date || ''} ${run.sha || ''}`.trim(), '',
    'Score = glyphOnly % per frame pair (tools/flicker-gate.mjs scoring). A still camera should score near 0.', '',
    '| spot | glyphOnly % | total % | raw % | shift % | grid |' + (result ? ' baseline | verdict |' : ''), '|---|---|---|---|---|---|' + (result ? '---|---|' : '')];
  for (const [slug, s] of Object.entries(run.spots)) {
    const r = result && result.rows.find((x) => x.spot === slug);
    L.push(`| ${slug} | ${f2(s.score)} | ${f2(s.totalPct)} | ${f2(s.rawPct)} | ${f2(s.shiftPct)} | ${s.cols || '-'}x${s.rows || '-'} |` + (result ? ` ${f2(r?.baseline)} | ${r?.verdict || '-'} |` : ''));
  }
  if (result) { L.push('', `Gate (> ${FACTOR}x baseline fails): ${result.ok ? 'PASS' : 'FAIL'}`, ...result.messages.map((m) => '- ' + m)); }
  return L.join('\n') + '\n';
}

/** Pure: window.__flicker (runLivePoses result) -> run.spots entry for one slug. */
export function spotFromFlicker(fl, slug) {
  const p = fl && fl.poses && fl.poses[slug];
  if (!p) throw new Error(`no pose "${slug}" in window.__flicker: ${JSON.stringify(fl && fl.error ? fl.error : Object.keys((fl && fl.poses) || {}))}`);
  return { score: p.glyphOnlyPct, totalPct: p.totalPct, rawPct: p.glyphOnlyRawPct, shiftPct: p.shiftPct, cols: p.cols, rows: p.rows, used: p.used };
}

async function main() {
  const args = process.argv.slice(2);
  const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--baseline'));
  const port = Number(pos[0]); validatePort(port);
  if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
  const backend = pos[1] || 'webgpu';
  const bi = args.indexOf('--baseline'); const save = args.includes('--save');
  const blPath = bi >= 0 && args[bi + 1] && !args[bi + 1].startsWith('--') ? path.resolve(args[bi + 1]) : DEFAULT_BASELINE;
  if (bi >= 0 && !save && !existsSync(blPath)) throw new Error('no baseline at ' + blPath + ' (run with --save first)');
  const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-flickerwalk-'));
  const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  let browser, cdp; const run = { spots: {}, backend, frames: 30 };
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
    browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({ backend }), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    cdp = await connectCdp(port + 1, 15000);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `import('/game/js/dev/flickerLive.js').then((m)=>{for(const [s,x,y,yaw,pitch] of ${JSON.stringify(SPOTS)})m.POSES_ALL.push({slug:s,x,y,yawDeg:yaw,pitchDeg:pitch,groundEye:true,walk:true,stepM:0,inAvg:false});});` });
    for (const [slug, x, y, yaw, pitch] of SPOTS) {
      // no `stable=1`: stable pass OFF (D-119). `at=` freezes the clock and skips the title; grid/rays pinned like the gate.
      const url = `http://127.0.0.1:${port}/game/index.html?flickerlive=1&flickerpose=${slug}&at=${x},${y},0,${yaw},${pitch}&grid=480x180&rays=4${backend === 'webgpu' ? '&backend=webgpu' : ''}`;
      await cdp.send('Page.navigate', { url });
      let fl = null;
      for (let i = 0; i < 600 && !fl; i++) { await pause(500); try { fl = await evaluate(cdp, 'window.__flicker ? JSON.parse(JSON.stringify(window.__flicker, (k,v)=>k==="dump"?undefined:v)) : null'); } catch { /* navigating */ } }
      if (!fl) throw new Error('timeout waiting for window.__flicker at ' + slug);
      run.spots[slug] = spotFromFlicker(fl, slug);
      console.log(slug.padEnd(11) + 'glyphOnly ' + f2(run.spots[slug].score) + ' %  total ' + f2(run.spots[slug].totalPct) + ' %');
    }
  } finally {
    cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
    await pause(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
  }
  run.date = new Date().toISOString().slice(0, 10);
  let result = null;
  if (bi >= 0 && !save) { result = compareBaseline(run, JSON.parse(readFileSync(blPath, 'utf8'))); console.log('baseline gate: ' + (result.ok ? 'PASS' : 'FAIL')); for (const m of result.messages) console.log('  ' + m); }
  if (save) { writeFileSync(blPath, JSON.stringify({ date: run.date, spots: Object.fromEntries(Object.entries(run.spots).map(([k, v]) => [k, { score: v.score }])) }, null, 2) + '\n'); console.log('baseline written: ' + path.relative(ROOT, blPath)); }
  mkdirSync(path.dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, formatReport(run, result));
  console.log('report: ' + path.relative(ROOT, REPORT));
  process.exitCode = result && !result.ok ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('flicker-walk: ' + e.message); process.exit(1); });
}
