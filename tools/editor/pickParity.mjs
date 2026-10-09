// ED-WG-01c-baseline (docs/architecture.md 38.21 item 3): pick-parity golden for the editor.
// Records, for a 9x5 cell lattice at 5 camera poses, window.__editor.pickAt(col,row) (kind, ids, world point, face)
// and compares a later run against it (same kind + structureId + entityId, world within 0.05 m).
// pickAt may be sync (GL path today) or async (after ED-WG-01b/c) - the page side always awaits it.
// Run: node tools/editor/pickParity.mjs <port> [backend=webgl2] --write golden.json | --check golden.json
//   [--root <dir>]  serve another checkout (e.g. ../game_project_test for the pre-01b baseline). Port 9500-9998 (PC-B).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, evaluateAsync, killTree } from '../capture-browser.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i < 0 ? null : args[i + 1]; };
const port = Number(args[0]); validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const backend = args[1] && !args[1].startsWith('--') ? args[1] : 'webgl2';
const writeTo = flag('--write'), checkFrom = flag('--check');
if (!writeTo === !checkFrom) throw new Error('give exactly one of --write <file> / --check <file>');
const root = path.resolve(flag('--root') || ROOT);
const COLS_N = 9, ROWS_N = 5, TOL = 0.05;

// Page side: define the 5 poses from the loaded world (deterministic per commit), then sample the lattice.
const PAGE = `(async () => {
  const E = window.__editor, w = E.world, cam = E.cam, D = Math.PI / 180;
  const ent = (id) => { const e = w._entities.get(id); const t = e && e.transform; return t ? (t.pos || t.position || t) : null; };
  const st = w.structures.find((s) => s.id === 'roadS00'), b = st.bbox;
  const prop = ent('tower.beaconBowl') || ent('tower.practiceTarget');
  const look = (name, tx, ty, tz, dist, yaw, pitch) => {
    const c = Math.cos(pitch * D), dx = Math.sin(yaw * D), dy = -Math.cos(yaw * D);
    return { name, x: tx - dist * c * dx, y: ty - dist * c * dy, z: tz - dist * Math.sin(pitch * D), yawDeg: yaw, pitchDeg: pitch };
  };
  const spawn = { x: cam.x, y: cam.y, z: cam.z };
  const poses = [
    look('terrain', spawn.x, spawn.y + 24, 2, 14, 0, -40),
    look('voxelProp', prop.x, prop.y, prop.z, 9, 150, -35),
    look('meshKind9', (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2, 18, 200, -25),
    look('towerStructure', spawn.x, spawn.y - 18, 8, 26, 0, -20),
    { name: 'sky', x: spawn.x, y: spawn.y, z: spawn.z + 40, yawDeg: 60, pitchDeg: 5 },
  ];
  const out = { cols: E.rt.cols, rows: E.rt.rows, poses: [] };
  for (const p of poses) {
    Object.assign(cam, { x: p.x, y: p.y, z: p.z, yawDeg: p.yawDeg, pitchDeg: p.pitchDeg });
    E.frame.markDirty?.();
    await new Promise((r) => setTimeout(r, 900)); // let the frame loop render + settle (sprites, mesh rebuild)
    const cells = [];
    for (let j = 0; j < ${ROWS_N}; j++) for (let i = 0; i < ${COLS_N}; i++) {
      const col = Math.floor((i + 0.5) / ${COLS_N} * E.rt.cols), row = Math.floor((j + 0.5) / ${ROWS_N} * E.rt.rows);
      const r = await E.pickAt(col, row);
      cells.push({ col, row, kind: r.kind, structureId: r.structureId || null, entityId: r.entityId || null,
        world: r.world ? { x: r.world.x, y: r.world.y, z: r.world.z } : null, face: r.face ?? null, cell: r.cell || null });
    }
    out.poses.push({ name: p.name, cam: { x: p.x, y: p.y, z: p.z, yawDeg: p.yawDeg, pitchDeg: p.pitchDeg }, cells });
  }
  return JSON.stringify(out);
})()`;

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-pickparity-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: root, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, code = 0;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/tools/editor/index.html?backend=${backend}&dev=1` });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) { await pause(300); ready = await evaluate(cdp, '!!(window.__editor && window.__editor.world && window.__editor.pickAt)'); }
  if (!ready) throw new Error('editor did not boot (no window.__editor.pickAt)');
  await pause(1500);
  const res = JSON.parse(await evaluateAsync(cdp, PAGE));
  res.backend = backend;
  if (writeTo) {
    writeFileSync(writeTo, JSON.stringify(res, null, 1));
    const kinds = {}; for (const p of res.poses) for (const c of p.cells) kinds[`${p.name}:${c.kind}`] = (kinds[`${p.name}:${c.kind}`] || 0) + 1;
    console.log('golden written', writeTo, JSON.stringify(kinds));
  } else {
    const gold = JSON.parse(readFileSync(checkFrom, 'utf8'));
    const bad = [];
    if (gold.cols !== res.cols || gold.rows !== res.rows) bad.push(`grid ${gold.cols}x${gold.rows} vs ${res.cols}x${res.rows}`);
    gold.poses.forEach((gp, pi) => gp.cells.forEach((g, ci) => {
      const c = res.poses[pi]?.cells[ci]; const tag = `${gp.name}[${g.col},${g.row}]`;
      if (!c) return bad.push(tag + ' missing');
      if (c.kind !== g.kind || c.structureId !== g.structureId || c.entityId !== g.entityId) return bad.push(`${tag} ids ${g.kind}/${g.structureId}/${g.entityId} -> ${c.kind}/${c.structureId}/${c.entityId}`);
      if (!!c.world !== !!g.world) return bad.push(tag + ' world presence differs');
      if (g.world && Math.hypot(c.world.x - g.world.x, c.world.y - g.world.y, c.world.z - g.world.z) > TOL) bad.push(`${tag} world moved ${JSON.stringify(g.world)} -> ${JSON.stringify(c.world)}`);
    }));
    console.log(bad.length ? `pickParity FAIL (${bad.length}/${gold.poses.length * COLS_N * ROWS_N}):\n  ${bad.slice(0, 20).join('\n  ')}` : `pickParity PASS (${gold.poses.length * COLS_N * ROWS_N} cells, ${backend})`);
    if (bad.length) code = 1;
  }
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(400); try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(code);
