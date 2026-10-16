// FOLIAGE-CAP-BENCH (D-085): how many LOD0 foliage triangles in ONE zone still fit the GPU budget?
// Run: node tools/bench-foliage-cap.mjs --gpu rtx --quality ultra --port 9725   (or --gpu intel --quality high)
// Opens the default world at a pose, fills a zone around the player with forest_edge-mix tree placements through
// world.placeMesh (the call the ED-FOLIAGE brush path ends in) up to 0.5/1/1.5/2/3 M LOD0 tris, orbits 10 s per step.
// Stats: __debug.wgPipeline.stats.{gpuMsP50,gpuMsP95} + __debug.engine.loop.stats.jsMs. Writes docs/test-reports/foliage-cap-<gpu>-<date>.md.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const STEPS_M = [0.5, 1.0, 1.5, 2.0, 3.0];
/** D-085 limits in GPU ms p95: RTX 8 at every preset, Intel 10 at high. */
export const D085_LIMITS = { rtx: 8, intel: 10 };

export function pct(arr, p) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))];
}

export function parseArgs(argv) {
  const o = { gpu: 'rtx', quality: 'ultra', port: 9725, pose: 'roadSouth', seconds: 10, grid: '480x180' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--gpu') o.gpu = String(argv[++i]);
    else if (a === '--quality') o.quality = String(argv[++i]);
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--pose') o.pose = String(argv[++i]);
    else if (a === '--seconds') o.seconds = Number(argv[++i]);
    else if (a === '--grid') o.grid = String(argv[++i]);
  }
  if (!D085_LIMITS[o.gpu]) throw new Error('--gpu must be rtx or intel');
  if (!['high', 'ultra'].includes(o.quality)) throw new Error('--quality must be high or ultra');
  return o;
}

/** Limit (ms GPU p95) for gpu kind + quality; null when D-085 sets none (intel at ultra). */
export function limitFor(gpu, quality) {
  if (gpu === 'rtx') return D085_LIMITS.rtx;
  return quality === 'high' ? D085_LIMITS.intel : null;
}

/**
 * samples: [{ tris, gpu:number[] (p50 snapshots), gpu95:number[], js:number[] }] ascending by tris.
 * The cap is the largest step before the first step above the limit (a later step never rescues it).
 * A step without GPU timer data (or no limit) makes the verdict UNKNOWN.
 */
export function evaluate(samples, limit) {
  const rows = samples.map((s) => ({ tris: s.tris, gpuP50: pct(s.gpu, 0.5), gpuP95: pct(s.gpu95, 0.95), jsP95: pct(s.js, 0.95) }));
  let cap = null, firstOver = null, unknown = false;
  for (const r of rows) {
    r.pass = Number.isFinite(r.gpuP95) && limit != null ? r.gpuP95 <= limit : null;
    if (r.pass === null) { unknown = true; break; }
    if (!r.pass) { firstOver = r.tris; break; }
    cap = r.tris;
  }
  const verdict = unknown ? 'UNKNOWN' : cap === null ? 'NONE' : firstOver === null ? 'ALL' : 'CAP';
  return { rows, limit, cap, firstOver, verdict };
}

const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
export function formatResult(ev) {
  const head = ['LOD0 tris', 'GPU p50', 'GPU p95', 'JS p95', 'D-085'];
  const body = ev.rows.map((r) => [(r.tris / 1e6).toFixed(2) + ' M', f(r.gpuP50), f(r.gpuP95), f(r.jsP95), r.pass === null ? '?' : r.pass ? 'ok' : 'OVER']);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (c) => c.map((x, i) => x.padStart(w[i])).join('  ');
  const table = [line(head), w.map((n) => '-'.repeat(n)).join('  '), ...body.map(line)].join('\n');
  const lim = ev.limit == null ? 'no D-085 limit' : `<= ${ev.limit} ms GPU p95`;
  const txt = ev.verdict === 'UNKNOWN' ? 'UNKNOWN (no GPU timer data, or no D-085 limit for this gpu/quality)'
    : ev.verdict === 'NONE' ? `NONE of the steps fits (${lim}); try a smaller step`
    : ev.verdict === 'ALL' ? `all steps fit up to ${(ev.cap / 1e6).toFixed(1)} M (${lim}); raise the top step`
    : `${(ev.cap / 1e6).toFixed(1)} M (${lim}; first over at ${(ev.firstOver / 1e6).toFixed(1)} M)`;
  return { table, summary: `FOLIAGE_TRI_CAP candidate (largest step inside D-085): ${txt}` };
}

export function reportMarkdown(ev, meta) {
  const r = formatResult(ev);
  return `# Foliage cap bench ${meta.gpu} ${meta.date}\n\nquality ${meta.quality}, pose ${meta.pose}, grid ${meta.grid}, ${meta.seconds} s orbit per step, ${meta.sha || 'sha n/a'}\n\n\`\`\`\n${r.table}\n\`\`\`\n\n${r.summary}\n`;
}

// In-page: harvest tree meshes already placed in the world, then add placements around the player up to targetTris (cumulative).
const FILL_JS = (targetTris) => `(()=>{ const d=window.__debug, w=d.engine.world;
  if(!window.__fc){ const pal=[['CommonTree_1',3],['CommonTree_2',3],['CommonTree_3',2],['Pine_1',2],['Pine_2',2],['DeadTree_1',1]]; const meshes=[];
    for(const s of w.structures){ if(s.kind!=='mesh'||!s.mesh.triCount) continue; const id=String(s.mesh.id||s.mesh.name||''); for(const [n,wt] of pal) if(id.includes(n)&&!meshes.some(m=>m.n===n)) meshes.push({n,wt,mesh:s.mesh}); }
    const p=d.playerHandle&&d.playerHandle.pos; window.__fc={meshes,tris:0,n:0,px:p?p.x:0,py:p?p.y:0}; }
  const S=window.__fc; if(!S.meshes.length) return JSON.stringify({err:'no tree meshes harvested from world.structures (NEEDS kestrel-2: expose assets on __debug)'});
  const wsum=S.meshes.reduce((a,m)=>a+m.wt,0); let guard=0;
  while(S.tris<${targetTris}&&guard++<400000){ const k=S.n++, a=k*2.399963, r=3.5*Math.sqrt(k+1);
    const x=S.px+r*Math.cos(a), y=S.py+r*Math.sin(a); let pk=((k*2654435761>>>0)%1000)/1000*wsum, m=S.meshes[0]; for(const c of S.meshes){ if((pk-=c.wt)<0){m=c;break;} }
    const z=w.floorAt(x,y); if(!Number.isFinite(z)) continue; w.placeMesh(m.mesh,{x,y,z},'fol_bench_'+k,(k*47)%360,undefined,0.8+((k*7)%50)/100); S.tris+=m.mesh.triCount; }
  return JSON.stringify({tris:S.tris,n:S.n}); })()`;

async function main() {
  const cb = await import('./capture-browser.mjs');
  const { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate: evalPage, killTree, todayStr, shortShaSync } = cb;
  const o = parseArgs(process.argv.slice(2));
  validatePort(o.port);
  if (o.port === 8000 || o.port < 9500 || o.port + 1 > 9999) throw new Error('use a PC-B port 9500-9998 (next port is CDP)');
  const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-bench-foliage-'));
  const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(o.port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  let browser, cdp; const samples = [];
  try {
    await waitForHttp(`http://127.0.0.1:${o.port}/`, 10000);
    browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${o.port + 1}`, ...buildLaunchFlags({ backend: 'webgpu' }), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    cdp = await connectCdp(o.port + 1, 15000);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${o.port}/game/index.html?pose=${o.pose}&grid=${o.grid}&quality=${o.quality}&title=0` });
    let ready = false;
    for (let i = 0; i < 400 && !ready; i++) {
      await pause(300);
      ready = await evalPage(cdp, '(()=>{const d=window.__debug;return !!(d&&d.wgPipeline&&d.wgPipeline.ready&&d.engine&&d.engine.world&&d.engine.world.terrain&&d.engine.world.terrain.farReady);})()').catch(() => false);
    }
    if (!ready) throw new Error('page not ready');
    // headless: no pointer lock -> keep look.locked; orbit = slow yaw rotation (about one turn per 10 s)
    await evalPage(cdp, '(()=>{ const d=window.__debug; setInterval(()=>{ if(d.look){ d.look.locked=true; d.look.yaw=(d.look.yaw||0)+0.0105; } },16); })()', true);
    for (const m of STEPS_M) {
      const fill = JSON.parse(await evalPage(cdp, FILL_JS(m * 1e6)));
      if (fill.err) throw new Error(fill.err);
      await pause(3000); // GPU upload + warm-up
      await evalPage(cdp, '(()=>{ const d=window.__debug; window.__fs={gpu:[],gpu95:[],js:[]}; clearInterval(window.__fiv); window.__fiv=setInterval(()=>{ const s=d.wgPipeline.stats; if(s){ window.__fs.gpu.push(s.gpuMsP50); window.__fs.gpu95.push(s.gpuMsP95); } const l=d.engine.loop&&d.engine.loop.stats; if(l) window.__fs.js.push(l.jsMs); },100); })()', true);
      await pause(o.seconds * 1000);
      const raw = JSON.parse(await evalPage(cdp, 'clearInterval(window.__fiv); JSON.stringify(window.__fs)'));
      const nan = (a) => a.map((v) => (v === null ? NaN : v)); // JSON turns NaN into null
      samples.push({ tris: fill.tris, gpu: nan(raw.gpu), gpu95: nan(raw.gpu95), js: nan(raw.js) });
      console.error(`[step] ${m} M target -> ${fill.tris} tris, ${fill.n} placements`);
    }
  } finally {
    cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
    await pause(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup]', e.message); }
  }
  const ev = evaluate(samples, limitFor(o.gpu, o.quality));
  const meta = { gpu: o.gpu, quality: o.quality, pose: o.pose, grid: o.grid, seconds: o.seconds, date: todayStr(), sha: shortShaSync() };
  const r = formatResult(ev);
  console.log(r.table + '\n' + r.summary);
  const file = path.join(ROOT, 'docs', 'test-reports', `foliage-cap-${o.gpu}-${meta.date}.md`);
  writeFileSync(file, reportMarkdown(ev, meta)); console.log('wrote ' + path.relative(ROOT, file));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
