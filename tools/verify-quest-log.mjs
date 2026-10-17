// S8-C-11/12: real-GPU quest copy preview. Run: node tools/verify-quest-log.mjs 9886
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,killTree} from './capture-browser.mjs';
const port=Number(process.argv[2] || 9886);
validatePort(port);
if(port<9800 || port>9998) throw new Error('Lane C port must be 9800..9998 (next port is CDP)');
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-quest-writer-'));
const out=path.join(ROOT,'docs/test-reports/captures');mkdirSync(out,{recursive:true});
const server=spawn('python',['-c','import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()',String(port)],{cwd:ROOT,stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,cdp;
try{
 await waitForHttp(`http://127.0.0.1:${port}/`,10000);
 browser=spawn(findBrowserBinary(),['--headless=new',`--remote-debugging-port=${port+1}`,...buildLaunchFlags({}),'--no-sandbox',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 cdp=await connectCdp(port+1,15000);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const errors=[];cdp.onEvent((m,p)=>{if(m==='Runtime.exceptionThrown')errors.push(p.exceptionDetails);});
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 async function shot(name){await pause(350);const s=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,name+'.png'),Buffer.from(s.data,'base64'));}
 for(const backend of ['webgpu']){
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/game/js/ui/questLog.preview.html?backend=${backend}`});
  let ready=false;for(let i=0;i<100;i++){await pause(300);if(await evaluate(cdp,'!!window.__questLogPreview')){ready=true;break;}}assert.ok(ready,JSON.stringify(errors));
  const state=await evaluate(cdp,`(()=>{const p=__questLogPreview;return {info:p.info,grid:[p.rt.cols,p.rt.rows],gpu:p.rt.gl ? p.rt.gl.getParameter(p.rt.gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) : p.info.label};})()`);
  assert.equal(state.info.backend,backend);assert.deepEqual(state.grid,[400,150]);assert.doesNotMatch(state.gpu,/swiftshader|software|llvmpipe/i);console.log(JSON.stringify({backend,...state}));
  assert.equal(await evaluate(cdp,'__questLogPreview.view.getObjectiveLine()'),'Get up from the wreck');
  await shot('quest-writer-start-'+backend);
  const btn=await evaluate(cdp,'(()=>{const r=document.querySelector("#next").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
  for(let i=0;i<6;i++) {
   await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...btn});
   await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...btn});await pause(100);
   assert.equal(await evaluate(cdp,'__questLogPreview.state.completed.length'),i+1);
   if(i===2)await shot('quest-writer-middle-'+backend);
  }
  assert.equal(await evaluate(cdp,'__questLogPreview.view.getObjectiveLine()'),'');
  await shot('quest-writer-complete-'+backend);
 }
 assert.deepEqual(errors,[]);console.log('Approved quest copy: six physical button clicks, both real-GPU backends PASS');

}finally{cdp?.close();if(browser?.pid)killTree(browser.pid);if(server.pid)killTree(server.pid);if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()))throw Error('Unexpected profile path');rmSync(profile,{recursive:true,force:true});}
