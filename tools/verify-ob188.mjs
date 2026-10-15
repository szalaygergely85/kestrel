// OB-188: real-game check of the meadow waystone. New Game state with burl.stone accepted, stand 1.7 m west of the stone
// (collider r 0.9 + player r 0.35 = nearest reachable), press the REAL E key, report prompt / hint / woken flag.
// Run: node tools/verify-ob188.mjs {port}   (PC-B port 9500-9574; CDP = port+1)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9500);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob188-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, code = 0;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&save=1&nopause=1&title=0&at=1426.3,1040,0,90,0` });
  let ready = false;
  for (let i = 0; i < 150; i++) { await pause(300); if (await evaluate(cdp, '!!(window.__debug && window.__debug.world && window.__debug.playerHandle && window.__debug.relayWake && window.__debug.saveRelay)')) { ready = true; break; } }
  if (!ready) throw new Error('game did not boot');
  // state: crystal attuned (boar hand-in done), burl.follow done, burl.stone accepted. told flag deliberately NOT set (old-save case).
  const setup = await evaluate(cdp, `(()=>{const d=window.__debug,w=d.world,b=d.saveRelay.quest.book;
    w.state['aether.attuned']=true; d.look.locked=true; w.state['burl.arrived']=true; if(new URLSearchParams(location.search).get('x')!=='noTold'||true) w.state['dlg.bear.stone.told']=globalThis.__told!==false;
    for(const k of ['q.burl.follow.accept','q.burl.follow.handin','q.burl.stone.accept']){try{b.actKey(k);}catch(e){}}
    const ids=['burl.follow','burl.stone'].map(id=>[id,b.statusOf(id)]);
    const st=w.get('endMarker').data.transform; const t=d.playerHandle.data.transform; t.x=st.x-1.7; t.y=st.y; t.z=st.z+0.05;
    return {stone:[st.x,st.y,st.z],ids,rec:d.relayWake.relays.map(r=>({ws:r.wsId,prompt:r.rec.prompt,requires:r.rec.requires||null}))};})()`);
  console.log('setup', JSON.stringify(setup));
  await pause(800);
  const press = async () => { for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, text: type === 'keyDown' ? 'e' : undefined }); await pause(500); };
  const snap = () => evaluate(cdp, `(()=>{const d=window.__debug,w=d.world,r=d.relayWake.relays.find(x=>x.stone);return {prompt:r&&r.rec.prompt,woken:!!w.state['waystone.waystone.woken'],told:!!w.state['dlg.bear.stone.told'],stoneX:w.get('endMarker').data.transform.x,playerXY:[d.playerHandle.data.transform.x,d.playerHandle.data.transform.y],lookLocked:!!(d.look&&d.look.locked),paused:!!(d.pauseUp&&d.pauseUp())};})()`);
  console.log('before E', JSON.stringify(await snap()));
  await press();
  console.log('after E', JSON.stringify(await snap()));
  await pause(1500);
  console.log('after 1.5 s', JSON.stringify(await snap()));
} catch (e) { console.error('FAIL', e.message); code = 1; }
finally { try { cdp && cdp.close && cdp.close(); } catch {} if (browser) killTree(browser.pid); killTree(server.pid); process.exit(code); }
