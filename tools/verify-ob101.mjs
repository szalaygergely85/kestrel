// OB-090 headless stills at the river bank / ford (water look). Run: node tools/verify-ob101.mjs 9725 -> docs/test-reports/captures/ob101-*.png
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluate, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9725);
validatePort(port);
if (port < 9500 || port + 1 > 9999) throw new Error('PC-B lane B1 range is 9500-9999 (next port is CDP)');
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-ob101-'));
const capDir = path.join(ROOT, 'docs', 'test-reports', 'captures'); mkdirSync(capDir, { recursive: true });
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, fails = 0;
const report = (name, okk, info) => { if (!okk) fails++; console.log(`${okk ? 'PASS' : 'FAIL'} ${name}${info === undefined ? '' : ' ' + JSON.stringify(info)}`); };
const ev = (s) => evaluate(cdp, s);
async function still(name) { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(capDir, `ob101-${name}.png`), Buffer.from(r.data, 'base64')); }
const key = async (code, k) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, text: k }); await pause(70); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); await pause(150); };
const tele = (x, y, z) => ev(`(()=>{const p=__debug.playerHandle.data.transform;p.x=${x};p.y=${y};p.z=${z};return 1;})()`);
const mouse = (type, button) => ev(`document.querySelector('canvas').dispatchEvent(new MouseEvent('${type}',{button:${button},bubbles:true}))`);
const mp = () => ev('__debug.playerHandle.data.components.mana.mp');
const potions = () => ev(`__debug.playerHandle.data.components.inventory.slots.reduce((a,s)=>a+(s.id==='potion.mp'?s.n:0),0)`);
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/game/index.html?dev=1&title=0&quality=high&backend=webgpu&carpet=${process.env.CARPET||1}` });
  let ready = false;
  for (let i = 0; i < 200; i++) { await pause(300); if (await ev('!!(window.__debug && window.__debug.playerHandle && window.__debug.look)')) { ready = true; break; } }
  if (!ready) throw new Error('boot failed');
  await ev('__debug.look.locked = true');
  await pause(6000);
  const views = [['meadow'+(process.env.CARPET||1), 1436, 1000, null, 90, -30]];
  for (const [n, x, y, z, yaw, pitch] of views) {
    await ev(`(()=>{const p=__debug.playerHandle.data.transform;p.x=${x};p.y=${y};const w=__debug.world;p.z=(w&&w.heightAt?w.heightAt(${x},${y}):0)+1;return 1;})()`); await ev(`(__debug.look.yawDeg=${yaw},__debug.look.pitchDeg=${pitch},1)`); await pause(5000); await still(n);
    console.log(n, await ev(`(()=>{const c=__debug.world.carpet,cp=__debug.wgPipeline._carpetPass,nh=cp._nearH;const hist={};for(let i=0;i<c.classMap.length;i++){hist[c.classMap[i]]=(hist[c.classMap[i]]||0)+1}
const cm=c.classMap,at=(x,y)=>cm[Math.floor((y-c.y0)/2)*c.w+Math.floor((x-c.x0)/2)];const gz=__debug.world.heightAt(1440,1012);const ci=Math.floor((1440-c.x0)/(c.cellM||c.cfg.classCellM||1));
const T=__debug.world.terrain,g=T.near;const ty=(x,y)=>T.typeNames[g.type[Math.floor((x-g.x0)/g.cell)+Math.floor((y-g.y0)/g.cell)*g.w]];const st=(__debug.world.structures||[]).filter(s=>s.bbox&&s.bbox.x1>1425&&s.bbox.x0<1455&&s.bbox.y1>990&&s.bbox.y0<1025).map(s=>[s.id||s.name||s.kind,Object.values(s.bbox).map(Math.round)]);return JSON.stringify({st,nst:(__debug.world.structures||[]).length,names:0,types:[ty(1440,1012),ty(1440,1004),ty(1436,1000)],g:{x0:g.x0,y0:g.y0,w:g.w,h:g.h,cell:g.cell},cls:[at(1440,1002),at(1440,1004),at(1440,1020),at(1444,1010)],gz,nearAt:(()=>{const x=Math.floor((1440-nh.x0)/nh.cell),y=Math.floor((1012-nh.y0)/nh.cell);return nh.data[y*nh.w+x]})(),camz:__debug.wgPipeline._cam.z,x0:c.x0,y0:c.y0,w:c.w,h:c.h,hist,nh:nh&&{x0:nh.x0,y0:nh.y0,w:nh.w,h:nh.h,cell:nh.cell,s:nh.data[Math.floor(nh.w/2)+nh.w*Math.floor(nh.h/2)]},stats:cp.stats,ran:cp.ran,mask:c.mask&&{x0:c.mask.x0,y0:c.mask.y0,w:c.mask.w,h:c.mask.h},u:Array.from(cp.u.slice(0,64))})})()`));
  }
} catch (e) { fails++; console.log('FAIL harness ' + (e && e.message)); }
finally {
  cdp?.close(); if (browser?.pid) killTree(browser.pid); if (server.pid) killTree(server.pid);
  await pause(300);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {}
  process.exitCode = fails ? 1 : 0;
}
