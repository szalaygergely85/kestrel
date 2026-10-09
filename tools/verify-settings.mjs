// S8-C-04: real-GPU Settings preview. Run: node tools/verify-settings.mjs 9886 webgpu (or webgl2)
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,killTree} from './capture-browser.mjs';
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
 await key('ArrowDown');await key('ArrowDown');await key('ArrowLeft');assert.equal(await evaluate(cdp,'__settingsPreview.view.snapshot().volume'),0.6);
 await key('ArrowDown');await key('Enter');assert.equal(await evaluate(cdp,'__settingsPreview.view.snapshot().mute'),true);
 await key('Escape');assert.equal(await evaluate(cdp,'document.querySelector("#status").textContent'),'Back action received by preview');
 assert.deepEqual(errors,[]);console.log('Settings physical quality/shadows/volume/toggle/Esc and real-GPU preview PASS');
} finally {
 cdp?.close();if(browser?.pid)killTree(browser.pid);if(server.pid)killTree(server.pid);
 if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()))throw Error('Unexpected profile path');
 rmSync(profile,{recursive:true,force:true});
}
