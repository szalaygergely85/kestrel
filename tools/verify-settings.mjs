// S8-C-04: real-GPU Settings preview. Run: node tools/verify-settings.mjs 9886 webgpu (or webgl2)
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,evaluateAsync,killTree} from './capture-browser.mjs';
const port=Number(process.argv[2] || 9886), backend=process.argv[3] || 'webgpu';
validatePort(port);
if(port<9800 || port>9998)throw new Error('Lane C port must be 9800..9998');
assert.ok(['webgpu','webgl2'].includes(backend));
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-settings-'));
const out=path.join(ROOT,'docs/test-reports/captures');mkdirSync(out,{recursive:true});
const server=spawn('python',['-c','import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()',String(port)],{cwd:ROOT,stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,cdp;
try {
 await waitForHttp(`http://127.0.0.1:${port}/`,10000);
 browser=spawn(findBrowserBinary(),['--headless=new',`--remote-debugging-port=${port+1}`,...buildLaunchFlags({}),'--no-sandbox',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 cdp=await connectCdp(port+1,15000);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const errors=[];cdp.onEvent((m,p)=>{if(m==='Runtime.exceptionThrown')errors.push(p.exceptionDetails);});
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/game/js/ui/settings.preview.html?backend=${backend}`});
 let ready=false;for(let i=0;i<100;i++){await pause(300);if(await evaluate(cdp,'!!window.__settingsPreview')){ready=true;break;}}assert.ok(ready,JSON.stringify(errors));
 const state=await evaluate(cdp,`(()=>{const p=__settingsPreview;return {info:p.info,grid:[p.rt.cols,p.rt.rows],gpu:p.rt.gl ? p.rt.gl.getParameter(p.rt.gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) : p.info.label,options:p.view.snapshot()};})()`);
 assert.equal(state.info.backend,backend==='webgl2' ? 'gl2' : backend);assert.deepEqual(state.grid,[400,150]);assert.doesNotMatch(state.gpu,/swiftshader|software|llvmpipe/i);console.log(JSON.stringify(state));
 await pause(350);const shot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,'settings-'+backend+'.png'),Buffer.from(shot.data,'base64'));
 async function key(code,key=code){await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',code,key});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',code,key});}
 await key('ArrowRight');assert.equal(await evaluate(cdp,'__settingsPreview.view.snapshot().quality'),'ultra');
 await key('ArrowDown');assert.equal(await evaluate(cdp,'__settingsPreview.view.selectedId()'),'shadows');
 await key('ArrowLeft');assert.equal(await evaluate(cdp,'__settingsPreview.view.snapshot().shadows'),'low');
 await key('ArrowDown');assert.equal(await evaluate(cdp,'__settingsPreview.view.selectedId()'),'lodScale');
 await key('ArrowRight');assert.equal(await evaluate(cdp,'__settingsPreview.view.snapshot().lodScale'),1.25);
 await key('ArrowDown');await key('ArrowLeft');assert.equal(await evaluate(cdp,'__settingsPreview.view.snapshot().grid'),'320x120');
 await key('ArrowDown');await key('ArrowLeft');assert.equal(await evaluate(cdp,'__settingsPreview.view.snapshot().volume'),0.6);
 await key('ArrowDown');await key('Enter');assert.equal(await evaluate(cdp,'__settingsPreview.view.snapshot().mute'),true);
 await key('Escape');assert.equal(await evaluate(cdp,'document.querySelector("#status").textContent'),'Back action received by preview');
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/game/js/ui/titleMenu.preview.html?backend=${backend}`});
 for(let i=0;i<100;i++){await pause(100);if(await evaluate(cdp,'!!window.__titleMenuPreview'))break;}
 await key('ArrowDown');await key('ArrowDown');await key('ArrowDown');await key('Enter');
 assert.ok(await evaluate(cdp,'!!__titleMenuPreview.settings'));
 await pause(350);const titleShot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,'settings-title-'+backend+'.png'),Buffer.from(titleShot.data,'base64'));
 await key('Escape');assert.equal(await evaluate(cdp,'__titleMenuPreview.settings'),null);
 if(process.argv.includes('--game')) {
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/game/index.html?quality=high&grid=400x150&backend=${backend}`});
  let loaded=false;for(let i=0;i<1000;i++){await pause(300);if(await evaluate(cdp,'!!window.__debug?.menuHost && !!window.__bootReport')){loaded=true;break;}}
  assert.ok(loaded,'game menu never booted: '+JSON.stringify(errors));
  const gridSet=await evaluate(cdp,'__debug.engine.setGrid(400,150,{immediate:true})');assert.ok(!gridSet.error,JSON.stringify(gridSet));
  const gpu=await evaluate(cdp,'({backend:__debug.rt.backend,grid:[__debug.rt.cols,__debug.rt.rows],adapter:__debug.rt.device?.adapterInfo})');
  assert.deepEqual(gpu.grid,[400,150]);
  assert.equal(gpu.backend,backend==='webgl2'?'gl2':backend);assert.doesNotMatch(JSON.stringify(gpu),/swiftshader|software|llvmpipe|"fallback":true/i);
  await cdp.send('Runtime.evaluate',{expression:'document.querySelector("canvas").focus()'});
  // Existing host reads key edges at fixed steps: hold briefly for the game loop.
  async function gameKey(code,keyChar=code){await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',code,key:keyChar});await pause(150);await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',code,key:keyChar});await pause(150);}
  for(let i=0;i<5;i++) {
   if(await evaluate(cdp,'__debug.menuHost.menu.snapshot().rows[__debug.menuHost.menu.snapshot().selected].id === "settings"'))break;
   await gameKey('ArrowDown');
  }
  await gameKey('Enter');
  assert.ok(await evaluateAsync(cdp,'import("./js/ui/settings.js").then(m=>m.isSettingsOpen())'));
  await pause(350);const gameShot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,'settings-game-title-'+backend+'.png'),Buffer.from(gameShot.data,'base64'));
  await gameKey('Escape');
  // Start a fresh game, then open the same Settings module through pause's S key.
  await cdp.send('Runtime.evaluate',{expression:'__debug.menuHost.menu.handleKey("Escape"); while(__debug.menuHost.menu.snapshot().rows[__debug.menuHost.menu.snapshot().selected].id !== "new") __debug.menuHost.menu.handleKey("ArrowUp"); __debug.menuHost.menu.handleKey("Enter"); __debug.menuHost.menu.handleKey("Enter"); __debug.menuHost.consume()'});
  await pause(10000);await gameKey('Escape');await gameKey('KeyS','s');
  assert.ok(await evaluateAsync(cdp,'import("./js/ui/settings.js").then(m=>m.isSettingsOpen())'),'pause Settings did not open');
  await pause(350);const pauseShot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,'settings-game-pause-'+backend+'.png'),Buffer.from(pauseShot.data,'base64'));
  console.log('Real game title and pause Settings WebGPU captures PASS '+JSON.stringify(gpu));
 }
 assert.deepEqual(errors,[]);console.log('Settings physical quality/shadows/LOD/resolution/volume/toggle/Esc, title entry/return and real-GPU preview PASS');
} finally {
 cdp?.close();if(browser?.pid)killTree(browser.pid);if(server.pid)killTree(server.pid);
 if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()))throw Error('Unexpected profile path');
 rmSync(profile,{recursive:true,force:true});
}
