// VISQA-01: visual-QA sweep. Live clock (NOT ?at=/?pose=, those freeze liveLook), god mode + ground snap, ~11 spots x 3 hours.
// Run: node tools/visqa-sweep.mjs <port> (PC-B 9500-9999, CDP = port+1)  -> docs/test-reports/visqa/<spot>-<hh>.png + index.md
// Env: HOURS=9,13,22  ONLY=ford,bend (spot filter)  SETTLE=6000 (ms per spot)
// VISQA-10: `node tools/visqa-sweep.mjs <port> --set 2` -> underground interiors, 3-4 m close-ups of characters/animals and
// UI screens opened with real CDP key events, default game hour -> docs/test-reports/visqa/s2-<name>.png + "## Set 2" in index.md.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { pickCliffPose, pickEntity } from './visqa-pick.mjs';
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
  ['smoke-fire', 958, 1011, 0, 6, 'VISQA-15: smokeFire1 brazier at the base of the goblin smoke plume (958,1004)'],
];
// VISQA-10 set 2. Interiors: [name, x, y, zFloor (null = ground snap), yawDeg, pitchDeg, note] (world coords from the level origins in world_m1)
export const INTERIORS = [
  ['crypt', 1674, 1375.3, -56.8, 0, 4, 'crypt last room (level 24,29) looking north at torch1a/2b'],
  ['ford-cellar', 999.2, 1062.2, -92.5, 45, 0, 'Ford smugglers cellar SW corner looking NE (lantern + 2 torches)'],
  ['sea-cave', 1618.5, 1729.5, -95.31, 0, 4, 'Strand sea cave chamber from the south mouth'],
  ['goblin-tunnel', 944.5, 945.5, -88.8, 315, 8, 'VISQA-31: goblin tunnel room from its SE corner (level 21,31.5) looking NW at torchRoom (level 16.5,27.5)'],
  ['bear-den', 1584, 437, 11.76, 0, 4, 'northwood bear den chamber from the mouth side (no lights in level)'],
];
// Close-ups: [name, finder js (an entity with .transform), note]; camera 3.5 m in front of the entity, looking back at it
export const CLOSEUPS = [
  ['burl', "__debug.world.entity('bear')", 'Burl (npc bear)', 'inplace'],
  ['rook', "((e)=>e&&e.id==='rook'?e:null)(__debug.world.entity('rook'))", 'Rook (perched crow, on the Ford ruin crate; seen from the side, his front faces the ruin wall)', 'inplace'],
  ['warden', "__debug.world.entity('warden_northwood')", 'region warden (char.kit)'],
  ['boar', "__debug.beasts.entities.find((e)=>e&&/boar/i.test(e.components&&e.components.voxel&&e.components.voxel.model||''))", 'first boar'],
  ['wolf', `((r)=>r&&r.entity)((${pickEntity})(__debug.beasts.entities,{kind:'wolf'}))`, 'first wolf (brain.species wolf / model wolf); wolves live ~600 m west, unbound far from the player, so the camera goes to the wolf', 'inplace'],
  ['skeleton', "(__debug.beasts.entities.find((e)=>e&&/skel/i.test(e.components&&e.components.voxel&&e.components.voxel.model||'')&&e.transform.z>-5)||__debug.beasts.entities.find((e)=>e&&/skel/i.test(e.components&&e.components.voxel&&e.components.voxel.model||'')))", 'first surface skeleton (crypt ones do not render when pinned to the meadow)'],
];
// VISQA-19: front of a creature = (sin yaw, -cos yaw) of its own yaw (0 = north); per-subject sign override if a model faces the other way
const FRONT = {}; // per-subject sign override for npc yaw (beasts are pinned through the sim: steer x/y + facing fx/fy, which is their model front)
// UI: [name, keys pressed (CDP Input.dispatchKeyEvent), close keys, note]
export const UI_SCREENS = [
  ['inventory', ['KeyI'], ['KeyI'], 'pack (I)'],
  ['character', ['KeyC'], ['KeyC'], 'character / equipment (C)'],
  ['journal', ['KeyJ'], ['KeyJ'], 'quest journal (J)'],
  ['map', ['KeyM'], ['KeyM'], 'map (M)'],
  ['pause', [], [], 'pause menu (pointer lock lost = what Esc does in a real browser)'],
  ['settings', ['KeyS', 'Enter'], ['Escape', 'Escape'], 'Settings from the pause menu (S selects, Enter opens)'],
];
const set2 = process.argv.includes('--set') && process.argv[process.argv.indexOf('--set') + 1] === '2';
const port = Number(process.argv[2] || 9725); validatePort(port);
const hours = (process.env.HOURS || '9,13,22').split(',').map(Number);
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const spots = SPOTS.filter((s) => !only || only.includes(s[0]));
const settle = Number(process.env.SETTLE || 6000);
// LOOK-LINEAR-01: EXTRA='&looklin=1' (query added at every hour), OUTDIR=docs/test-reports/looklin, SUFFIX=-on (file <spot>-<hh><SUFFIX>.png; with SUFFIX no index.md is written)
const EXTRA = process.env.EXTRA || '', SUFFIX = process.env.SUFFIX || '';
const outDir = path.join(ROOT, process.env.OUTDIR || 'docs/test-reports/visqa'); mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-visqa-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp; const rows = [];
const shot = async (name, pose, note) => { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); const file = `s2-${name}.png`; writeFileSync(path.join(outDir, file), Buffer.from(r.data, 'base64')); rows.push({ file, pose, note }); console.log('still', file, pose); };
const key = async (code) => { const k = code.startsWith('Key') ? code.slice(3).toLowerCase() : code; await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k }); await pause(120); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); await pause(120); };
async function runSet2() {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?save=0&nopause=1&quality=medium&backend=webgpu&title=0` });
  let ok = false;
  for (let i = 0; i < 600 && !ok; i++) { await pause(300); try { ok = !!(await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.world && window.__debug.beasts) && !/Checking your graphics/.test(document.body.innerText||"")')); } catch { /* navigating */ } }
  if (!ok) throw new Error('set 2: never ready');
  await pause(12000); // let the opening title card fade (it sat over the first interior still)
  await evaluate(cdp, '(__debug.vitals&&__debug.vitals.setGodMode&&__debug.vitals.setGodMode(true)),true');
  const place = (x, y, z, yaw, pitch) => evaluate(cdp, `(()=>{const t=__debug.playerHandle.data.transform;t.x=${x};t.y=${y};const T=__debug.world.terrain;const g=${z == null ? `(T.groundAt||T.heightAt).call(T,${x},${y})` : z};t.z=(g==null?t.z:g+0.05);t.yawDeg=${yaw};t.pitchDeg=${pitch};const L=__debug.look;if(L){L.yawDeg=${yaw};L.pitchDeg=${pitch};}return +t.z.toFixed(2)})()`);
  for (const [name, x, y, z, yaw, pitch, note] of INTERIORS) {
    await place(x, y, z, yaw, pitch); await pause(settle);
    const zNow = await evaluate(cdp, '+__debug.playerHandle.data.transform.z.toFixed(2)');
    await shot(name, `${x},${y} z ${z} (now ${zNow}) yaw ${yaw}`, note);
  }
  // VISQA-19: the player stays on the open meadow (underground spots got undone by the unstuck/ground logic: Rook ended at the tower);
  // the SUBJECT is moved 3.5 m in front of the camera, turned to face it, and re-pinned right before the still (a wolf trots away fast), then put back.
  const MX = 1440, MY = 1040, D = 3.5;
  for (const [name, finder, note, mode] of CLOSEUPS) {
    const found = await evaluate(cdp, `(()=>{const e=${finder};return !!(e&&e.transform)})()`).catch(() => false);
    if (!found) { rows.push({ file: `s2-${name}.png`, pose: 'not found', note }); console.log('closeup', name, 'NOT FOUND', name === 'wolf' ? '- no wolf in range' : ''); continue; }
    if (mode === 'inplace') { // VISQA-19/24: npcs (Burl walks, Rook sits underground) stay where the sim keeps them; the camera goes 3.5 m in front of them, looking back
      const cam = async () => { const q = await evaluate(cdp, `(()=>{const E0=${finder},B0=__debug.beasts,i0=B0.entities.indexOf(E0);if(i0>=0&&${name === 'wolf'}){const t=E0.transform,fx=B0.fx[i0],fy=B0.fy[i0],n=Math.hypot(fx,fy)||1,px=fx/n,py=fy/n;return [t.x+px*${D},t.y+py*${D},t.z,(Math.atan2(-px,py)*180/Math.PI+360)%360]}const t=${finder}.transform,side=${name === 'rook' ? 1 : 0},a=((t.yawDeg||0)+(side?90:0))*Math.PI/180;return [t.x+Math.sin(a)*${D},t.y-Math.cos(a)*${D},t.z,((t.yawDeg||0)+(side?90:0)+180)%360]})()`); await place(q[0], q[1], name === 'rook' ? q[2] - 0.9 : null, q[3], name === 'wolf' ? -12 : 0); return q; };
      await cam(); await pause(2800); let q = await cam(); for (let k = 0; k < 3; k++) { await pause(250); q = await cam(); } await pause(120); q = await cam(); // wolves keep walking: re-aim right before the still
      const mi = await evaluate(cdp, `(()=>{const e=${finder};const v=e.components&&e.components.voxel;return 'model '+(v&&v.model)+' yaw '+((e.transform.yawDeg)||0).toFixed(0)+' at '+e.transform.x.toFixed(1)+','+e.transform.y.toFixed(1)+' z '+(+e.transform.z).toFixed(1)})()`);
      await shot(name, 'in place, camera ' + q.map((v) => Math.round(v)).join(',') + ' ' + mi, note); continue;
    }
    await place(MX, MY, null, 270, -6); await pause(600); // camera looks west
    const S = FRONT[name] || 1, yawSubject = S > 0 ? 90 : 270; // subject at the west side; its front must point east (toward the camera)
    const pin = `(()=>{const e=${finder};const t=e.transform,T=__debug.world.terrain,x=${MX - D},y=${MY},g=(T.groundAt||T.heightAt).call(T,x,y);t.x=x;t.y=y;if(g!=null)t.z=g;t.yawDeg=${yawSubject};if(e.velocity){e.velocity.x=0;e.velocity.y=0;}const B=__debug.beasts,i=B&&B.entities?B.entities.indexOf(e):-1;if(i>=0){B.steer.x[i]=x;B.steer.y[i]=y;B.steer.vx[i]=0;B.steer.vy[i]=0;B.fx[i]=1;B.fy[i]=0;if(B.dormant)B.dormant[i]=0;if(B.dormTile)B.dormTile[i]=0;if(B.steer.active)B.steer.active[i]=1;if(B.down)B.down[i]=0;}return [t.x,t.y,t.z]})()`;
    const saved = await evaluate(cdp, `(()=>{const e=${finder};const t=e.transform;window.__vqSaved=[t.x,t.y,t.z,t.yawDeg];return window.__vqSaved})()`);
    await evaluate(cdp, pin); await pause(900); await evaluate(cdp, pin); await pause(120);
    const info = await evaluate(cdp, `(()=>{const e=${finder};const t=e.transform,p=__debug.playerHandle.data.transform;const v=e.components&&e.components.voxel;return 'model '+(v&&v.model)+' cam '+p.x.toFixed(1)+','+p.y.toFixed(1)+' subject '+t.x.toFixed(1)+','+t.y.toFixed(1)+' z '+(+t.z).toFixed(1)+' yaw '+(t.yawDeg||0).toFixed(0)+' (home '+window.__vqSaved.map((v)=>Math.round(v)).join(',')+')'})()`);
    const kd = await evaluate(cdp, `(()=>{const B=__debug.beasts,e=${finder},i=B.entities.indexOf(e);return JSON.stringify({i,kindIdx:B.kindIdx?B.kindIdx[i]:(B.sim&&B.sim.kindIdx?B.sim.kindIdx[i]:null),brain:e.components.brain&&{species:e.components.brain.species,beastKind:e.components.brain.beastKind},keys:Object.keys(B).slice(0,40).join(',')})})()`).catch((e) => String(e)); console.log('closeup kind', name, kd);
    await shot(name, info, note);
    await evaluate(cdp, `(()=>{const e=${finder};const t=e.transform,s=window.__vqSaved;t.x=s[0];t.y=s[1];t.z=s[2];t.yawDeg=s[3];return true})()`);
  }
  await place(1440, 1040, null, 270, 0); await pause(2000); // start meadow behind the UI screens
  for (const [name, open, close, note] of UI_SCREENS) {
    if (name === 'pause') await evaluate(cdp, "Object.defineProperty(__debug.look,'locked',{get:()=>false,set:()=>{},configurable:true}),true");
    for (const c of open) await key(c);
    await pause(900); await shot('ui-' + name, open.join('+') || 'lock lost', note);
    for (const c of close) await key(c);
    await pause(400);
  }
}
const killer = setTimeout(() => { console.error('visqa-sweep timeout'); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid); process.exit(2); }, 900000);
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({ backend: 'webgpu' }), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  cdp.onEvent((m, p) => { if (m === 'Runtime.exceptionThrown') console.log('EXC', JSON.stringify(p.exceptionDetails).slice(0, 400)); if (m === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) console.log('console', p.type, (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)); });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  if (set2) await runSet2();
  for (const h of (set2 ? [] : hours)) {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?save=0&nopause=1&quality=medium&backend=webgpu&title=0&time=${h}${EXTRA}${(process.env.QS || '').split('|')[hours.indexOf(h)] || ''}` });   // QS='&scatter=0|&aamesh=0' = extra query per HOURS entry (dev probe)
    let ok = false;
    for (let i = 0; i < (Number(process.env.READY_TRIES) || 600) && !ok; i++) { await pause(300); try { ok = !!(await evaluate(cdp, '!!(window.__debug && window.__debug.playerHandle && window.__debug.world) && !/Checking your graphics/.test(document.body.innerText||"")')); } catch { /* navigating */ } }
    if (!ok) throw new Error('never ready ' + JSON.stringify(await evaluateAsync(cdp, '(async()=>location.href+" "+document.readyState+" "+document.title+" "+document.body.innerHTML.length+" "+JSON.stringify(window.__debug&&window.__debug.bootErrors))()').catch((e) => String(e))));
    await pause(4000);
    for (let [name, x, y, yaw, pitch, note] of spots) {
      if (name === 'cliff') { // VISQA-21: steepest slope within 60 m of the spot (tools/visqa-pick.mjs pickCliffPose, injected), camera 12 m back looking up at it
        const pose = await evaluate(cdp, `(()=>{const T=__debug.world.terrain,g=(a,b)=>(T.groundAt||T.heightAt).call(T,a,b);return (${pickCliffPose})(g,${x},${y},60,12,1.6)})()`).catch(() => null);
        if (pose) { x = pose.x; y = pose.y; yaw = pose.yaw; pitch = pose.pitch; console.log('cliff pose', JSON.stringify(pose)); } else console.log('cliff pose: NO slope found near', x, y, '(keeping the spot)');
      }
      const gz = await evaluate(cdp, `(()=>{const t=__debug.playerHandle.data.transform;t.x=${x};t.y=${y};if(__debug.vitals&&__debug.vitals.setGodMode)__debug.vitals.setGodMode(true);const T=__debug.world.terrain,gz=(T.groundAt||T.heightAt).call(T,${x},${y});t.z=(gz==null?t.z:gz+0.2);t.yawDeg=${yaw};t.pitchDeg=${pitch};const L=__debug.look;if(L){L.yawDeg=${yaw};L.pitchDeg=${pitch};}return gz})()`);
      // VISQA-09: a new game has Burl at the tower; for the home spot put him at his post-departure home (walks.home, OB-212)
      if (name === 'burl-home') await evaluate(cdp, `(()=>{const b=__debug.world.get('bear');if(b&&b.data.transform){b.data.transform.x=1404;b.data.transform.y=1010;const T=__debug.world.terrain;const g=(T.groundAt||T.heightAt).call(T,1404,1010);if(g!=null)b.data.transform.z=g;}return !!b})()`);
      await pause(settle);
      if (process.env.EVAL) console.log('eval', name, h, JSON.stringify(await evaluate(cdp, process.env.EVAL.replace(/\$X/g, x).replace(/\$Y/g, y))));   // dev probe (env EVAL, $X/$Y = spot)
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = `${name}-${String(h).padStart(2, '0')}${SUFFIX}.png`;
      writeFileSync(path.join(outDir, file), Buffer.from(s.data, 'base64'));
      rows.push({ name, h, file, x, y, yaw, pitch, gz, note }); console.log('still', file, 'gz', gz);
    }
  }
} finally {
  clearTimeout(killer); cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}
if (SUFFIX) { console.log('wrote', rows.length, 'stills (SUFFIX set: no index.md)'); process.exit(0); }
const idxPath = path.join(outDir, 'index.md');
let oldIdx = ''; try { oldIdx = readFileSync(idxPath, 'utf8'); } catch {}
const s2At = oldIdx.indexOf('\n## Set 2'), set2Old = s2At >= 0 ? oldIdx.slice(s2At) : '';
if (set2) {
  let s2 = `\n## Set 2 (VISQA-10)\n\n\`node tools/visqa-sweep.mjs <port> --set 2\` - default hour, god mode; interiors at the floor z, close-ups 3.5 m, UI via real key events.\n\n| still | pose / key | note |\n|---|---|---|\n`;
  for (const r of rows) s2 += `| ${r.pose === 'not found' ? '-' : `![${r.file}](${r.file})`} | ${r.pose} | ${r.note} |\n`;
  writeFileSync(idxPath, (s2At >= 0 ? oldIdx.slice(0, s2At) : oldIdx) + s2);
  console.log('wrote', rows.length, 'set-2 stills + index.md'); process.exit(0);
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
writeFileSync(idxPath, md + set2Old);
console.log('wrote', rows.length, 'stills + index.md');
