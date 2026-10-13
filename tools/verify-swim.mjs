// SWIM-03c: headless check of swimming on the real game. Boots world_m1 at the Braid deep reach (?at=), asserts swimming + gear
// hidden (hands gate shut) + a still; then drops into Glasswater (surface -58, 5+ m deep) for a still with the eye under water.
// Run: node tools/verify-swim.mjs 9575 (PC-B slot k2 range 9575-9649; next port is CDP)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { SEA_EDGE_CONFIG } from '../game/js/quest/seaEdge.js';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9575);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const backend = process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend), 'backend must be webgpu');

const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-swim-'));
const out = path.join(ROOT, 'docs/test-reports/captures'); mkdirSync(out, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails); });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  async function shot(name) { await pause(350); const s = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(out, name + '.png'), Buffer.from(s.data, 'base64')); }
  // Braid deepest reach (world_m1: x 1018.6, y 984, 1.44 m deep, surface -89.85); start 2 m above the surface so it drops in.
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?at=1018.6,984,-88,90,0&backend=${backend}` });
  const q = '(()=>{const h=window.__debug&&window.__debug.playerHandle;if(!h)return null;const b=h.data.components.body,t=h.data.transform;return {swimming:!!b.swimming,z:t.z,eye:t.z+b.eyeH,waterZ:b.waterZ,x:t.x,y:t.y,sword:window.__debug.hands?window.__debug.hands.handOf("sword"):null};})()';
  // Headless has no pointer lock -> main.js isPaused() (look.locked false) freezes the sim, so the body would hover at the pose. Same trick as verify-pointshadows.
  await evaluate(cdp, 'setInterval(() => { if (window.__debug && window.__debug.look) window.__debug.look.locked = true; }, 30), true');
  let st = null;
  for (let i = 0; i < 120; i++) { await pause(500); st = await evaluate(cdp, q); if (st && st.swimming) break; }
  assert.ok(st && st.swimming, 'Braid: swimming after the drop ' + JSON.stringify({ st, errors, diag: await evaluate(cdp, '(()=>{const w=__debug.engine.world,wa={surfaceZ:0,depth:0,region:""},t=__debug.playerHandle.data.transform;const wet=!!w.waterAt(t.x,t.y,wa);return {wet,surfaceZ:wa.surfaceZ,depth:wa.depth,region:wa.region,groundAt:w.floorAt?w.floorAt(t.x,t.y):null,locked:!!(__debug.look&&__debug.look.locked)};})()') }));
  assert.ok(!st.sword, 'gear stowed while swimming (sword hand empty) ' + JSON.stringify(st));
  await shot('swim-braid-' + backend);
  // SWIM-HOOKS-01: the stamina ring is drawn under the MP bar while swimming; after a few seconds in the water the stamina has dropped.
  await pause(3000);
  const ring = await evaluate(cdp, '(()=>{const w=window.__debug.swimWire;return w&&w.vitals?{stamina:w.vitals.state.stamina,visible:w.vitals.visible(__debug.playerHandle.data.components.body),monster:w.monster?w.monster.name:null}:null;})()');
  assert.ok(ring && ring.visible && ring.stamina < 100, 'stamina ring visible + draining while swimming ' + JSON.stringify(ring));
  await shot('swim-ring-' + backend);
  // Under water: put the body 4 m below the Glasswater surface (-58); the eye is under until the buoyancy lift reaches the surface.
  await evaluate(cdp, '(()=>{const h=__debug.playerHandle,t=h.data.transform;t.x=1230;t.y=505;t.z=-62;h.data.components.body.vz=0;})()');
  let under = null;
  for (let i = 0; i < 20; i++) { await pause(100); const s2 = await evaluate(cdp, q); if (s2 && s2.swimming && s2.eye < s2.waterZ - 0.05) { under = s2; await shot('swim-under-' + backend); break; } }
  // SWIM-ASSETS-01: sea monster circle still - teleport into the warn band of the south sea (z = sea surface -96), wait for state 'circle'.
  await evaluate(cdp, `(()=>{const h=__debug.playerHandle,t=h.data.transform;t.x=1525;t.y=${1770 + SEA_EDGE_CONFIG.warnM + 4};t.z=-95;h.data.components.body.vz=0;})()`);
  let mon = null;
  for (let i = 0; i < 40; i++) { await pause(250); mon = await evaluate(cdp, '(()=>{const w=__debug.swimWire;const m=w&&w.monster;return m?{state:m.name,x:m.x,y:m.y,z:m.z,clip:m.clip,hidden:!!(m.ent&&m.ent.components&&m.ent.components.voxel&&m.ent.components.voxel.hidden)}:null;})()'); if (mon && mon.state === 'circle') { await shot('swim-monster-circle-' + backend); break; } }
  assert.ok(mon && mon.state === 'circle' && mon.clip === 'circle' && mon.hidden === false, 'sea monster circling in the warn band ' + JSON.stringify({ mon, errors }));

  // STRAND-SIGN-01: still of the warning sign + net stakes from the beach (sign at 1384,1742; stakes ~60 m out, row x 1352..1416). Stand 7 m inland of the sign, face the sea.
  await evaluate(cdp, '(()=>{const h=__debug.playerHandle,t=h.data.transform;t.x=1384;t.y=1735;t.z=-93;t.yaw=0;h.data.components.body.vz=0;})()');
  await pause(1500); await shot('strand-sign-' + backend);

  console.log(JSON.stringify({ backend, braid: st, ring, mon, under: under || 'eye not under water in the sampled window (still not taken)' }));
  assert.deepEqual(errors, []);
  console.log('Swim: Braid swim + gear stowed' + (under ? ' + under-water still' : '') + ' PASS');
} finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw Error('Unexpected profile path');
  await pause(300); // Windows: the just-killed browser can hold the profile dir open for a moment
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.warn('[cleanup] temp profile left behind:', e.message); }
}
