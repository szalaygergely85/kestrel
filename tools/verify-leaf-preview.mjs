// LEAF-PREVIEW-01: real GPU fixture and physical controls. Run: node tools/verify-leaf-preview.mjs 9886
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,evaluateAsync,killTree} from './capture-browser.mjs';
const port=Number(process.argv[2] || 9886);
validatePort(port);
if(port<9800 || port>9998) throw new Error('Lane C port must be 9800..9998 (next port is CDP)');
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-leaf-preview-'));
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
 const requested=process.argv[3] || 'webgpu';
 assert.ok(['webgpu'].includes(requested),'backend must be webgpu');
 for(const backend of ['webgpu']){
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/game/leaf-preview.html?backend=${backend}`});
  let ready=false;for(let i=0;i<100;i++){await pause(300);if(await evaluate(cdp,'!!window.__leafPreview')){ready=true;break;}}assert.ok(ready,JSON.stringify(errors));
  const state=await evaluate(cdp,`(()=>{const p=__leafPreview;return {info:p.info,grid:[p.rt.cols,p.rt.rows],ready:p.pipeline.ready,complete:p.pipeline.frameComplete,gpu:p.rt.gl ? p.rt.gl.getParameter(p.rt.gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) : p.info.label};})()`);
  assert.equal(state.info.backend,backend);assert.deepEqual(state.grid,[400,150]);assert.doesNotMatch(state.gpu,/swiftshader|software|llvmpipe/i);console.log(JSON.stringify({backend,...state}));
  await shot('leaf-'+backend+'-soft');
  const geometry=await evaluateAsync(cdp,'(async()=>{const g=await __leafPreview.pipeline.readbackGeometry();return Array.from(g.GI).filter(v=>v!==0).length;})()');
  assert.ok(geometry>0,'fixture must draw geometry');
  for(const id of ['soft','distance']){
   const btn=await evaluate(cdp,`(()=>{const r=document.querySelector('#${id}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
   await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...btn});
   await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...btn});
   if(id==='soft')await shot('leaf-'+backend+'-hard');
  }
  assert.equal(await evaluate(cdp,'__leafPreview.soft'),false);assert.equal(await evaluate(cdp,'__leafPreview.far'),true);
  await shot('leaf-'+backend+'-far-hard');
 }
 assert.deepEqual(errors,[]);console.log('leaf preview GPU checks PASS');
}finally{
 if(cdp)cdp.close();if(browser)await killTree(browser.pid);await killTree(server.pid);
 await pause(400);rmSync(profile,{recursive:true,force:true});
}

