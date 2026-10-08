// S8-C-16: memory-only editor scale verification on a real GPU.
import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,killTree} from '../capture-browser.mjs';
const port=Number(process.argv[2] || 9880);validatePort(port);if(port<9800 || port>9998)throw Error('Lane C port required');
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-mesh-scale-')),out=path.join(ROOT,'docs/test-reports/captures');mkdirSync(out,{recursive:true});
const server=spawn('python',['-c','import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()',String(port)],{cwd:ROOT,stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,cdp;
try {
 await waitForHttp(`http://127.0.0.1:${port}/`,10000);
 browser=spawn(findBrowserBinary(),['--headless=new',`--remote-debugging-port=${port+1}`,...buildLaunchFlags({}),'--no-sandbox',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 cdp=await connectCdp(port+1,15000);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const errors=[];cdp.onEvent((m,p)=>{if(m==='Runtime.exceptionThrown')errors.push(p.exceptionDetails);});
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/tools/editor/index.html?grid=400x150`});
 let ready=false;for(let i=0;i<120;i++){await pause(500);if(await evaluate(cdp,'!!window.__editor')){ready=true;break;}}assert.ok(ready,JSON.stringify(errors));
 const gpu=await evaluate(cdp,`(()=>{const e=__editor,gl=e.rt.gl;Object.assign(e.cam,{x:1475,y:1034,z:e.world.floorAt(1475,1034)+1.8,yawDeg:0,pitchDeg:-12});e.placeAt('prop',{x:1475,y:1028},'@mesh/quaternius/Rock_Medium_1');e.frame.markDirty();return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);})()`);
 assert.doesNotMatch(gpu,/swiftshader|software|llvmpipe/i);await pause(500);
 const item=()=>evaluate(cdp,"(()=>{const e=__editor,s=e.selection;return e.doc.files.get(s.fileId).def.structures.find(it=>it.id===s.id);})()");
 const original=await item();assert.ok(original.mesh);const count=await evaluate(cdp,'__editor.undoStack.size');
 async function typeScale(value) {
  const result=await evaluate(cdp,`(()=>{const n=document.querySelector('[data-mesh-field="scale"]');n.value=${JSON.stringify(String(value))};n.dispatchEvent(new FocusEvent('blur'));return {value:n.value,error:n.parentNode.parentNode.querySelector('.insp-error').textContent};})()`);await pause(500);return result;
 }
 for(const invalid of [0.1,9]){const result=await typeScale(invalid);assert.equal((await item()).scale,undefined);assert.equal(await evaluate(cdp,'__editor.undoStack.size'),count);assert.match(result.error,/scale/);}
 await typeScale(1.37);assert.equal((await item()).scale,1.35);assert.equal(await evaluate(cdp,'__editor.undoStack.size'),count+1);
 await evaluate(cdp,'__editor.doUndo()');await pause(500);assert.deepEqual(await item(),original);
 await evaluate(cdp,'__editor.doRedo()');await pause(500);assert.equal((await item()).scale,1.35);
 const shot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,'mesh-scale-editor.png'),Buffer.from(shot.data,'base64'));
 await evaluate(cdp,'document.querySelector("#screen").focus()');
 await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',code:'Equal',key:'='});await pause(300);await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',code:'Equal',key:'='});await pause(500);
 assert.equal((await item()).scale,1.4);assert.deepEqual(errors,[]);console.log(JSON.stringify({gpu,grid:[400,150],typedRange:'PASS',snap:'1.37 -> 1.35',undoRedo:'PASS',keyStep:'1.35 -> 1.4'}));
}finally{cdp?.close();if(browser?.pid)killTree(browser.pid);if(server.pid)killTree(server.pid);if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()))throw Error('Unexpected profile path');rmSync(profile,{recursive:true,force:true});}
