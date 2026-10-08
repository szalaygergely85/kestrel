// S8-C-07: real-GPU item card preview. Run: node tools/verify-item-card.mjs 9886 webgpu (or webgl2)
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,killTree} from './capture-browser.mjs';
const port=Number(process.argv[2] || 9886);
validatePort(port);
if(port<9800 || port>9998) throw new Error('Lane C port must be 9800..9998 (next port is CDP)');
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-item-card-'));
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
 assert.ok(['webgpu','webgl2'].includes(requested),'backend must be webgpu or webgl2');
 for(const backend of [requested]){
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/game/js/ui/itemGetCard.preview.html?backend=${backend}`});
  let ready=false;for(let i=0;i<100;i++){await pause(300);if(await evaluate(cdp,'!!window.__itemGetCardPreview')){ready=true;break;}}assert.ok(ready,JSON.stringify(errors));
  const state=await evaluate(cdp,`(()=>{const p=__itemGetCardPreview;return {info:p.info,grid:[p.rt.cols,p.rt.rows],gpu:p.rt.gl ? p.rt.gl.getParameter(p.rt.gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) : p.info.label};})()`);
  assert.equal(state.info.backend,backend==='webgl2' ? 'gl2' : backend);assert.deepEqual(state.grid,[400,150]);assert.doesNotMatch(state.gpu,/swiftshader|software|llvmpipe/i);console.log(JSON.stringify({backend,...state}));
  const btn=await evaluate(cdp,'(()=>{const r=document.querySelector("#three").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...btn});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...btn});
  for(const id of ['shield','key.small','heart.piece']) {
   assert.equal(await evaluate(cdp,'__itemGetCardPreview.view.snapshot().id'),id);
   assert.equal(await evaluate(cdp,'__itemGetCardPreview.paused'),true);
   for(let i=0;i<80;i++){if(await evaluate(cdp,'__itemGetCardPreview.view.snapshot().phase==="show" && __itemGetCardPreview.view.snapshot().age>=0.3'))break;await pause(50);}
   const snap=await evaluate(cdp,'__itemGetCardPreview.view.snapshot()');console.log(JSON.stringify({backend,expected:id,...snap}));
   assert.ok(snap.age>=0.25,JSON.stringify({snap,errors}));
   const cpu=await evaluate(cdp,`(()=>{const p=__itemGetCardPreview,P=ASSETS.uiStyle.itemGetCard.panel;let written=0;
    for(let y=0;y<P.h;y++)for(let x=0;x<P.w;x++)written+=p.ui.cells.mask[(P.y+y)*p.ui.cols+P.x+x]===1 ? 1 : 0;
    const line=(y,x,n)=>Array.from(p.ui.cells.glyphIdx.slice(y*p.ui.cols+x,y*p.ui.cols+x+n),v=>String.fromCharCode(v+32)).join('');
    return {written,title:line(P.y+1,P.x,P.w),kind:line(P.y+6,P.x+15,38)};})()`);
   assert.equal(cpu.written,56*11);assert.ok(cpu.title.includes(await evaluate(cdp,`ASSETS.items.defs[${JSON.stringify(id)}].name`)));
   await shot('item-card-'+id.replace('.','-')+'-'+backend);
   await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',code:'Space',key:' '});
   await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',code:'Space',key:' '});
   for(let i=0;i<80;i++){if(await evaluate(cdp,`__itemGetCardPreview.view.snapshot().id!==${JSON.stringify(id)} && __itemGetCardPreview.view.snapshot().phase!=="gap"`))break;await pause(50);}
  }
  assert.equal(await evaluate(cdp,'__itemGetCardPreview.view.isOpen'),false);
  assert.equal(await evaluate(cdp,'__itemGetCardPreview.paused'),false);
 }
 assert.deepEqual(errors,[]);console.log('Item-get card: three physical guarded dismissals and pause sequence on the requested real-GPU backend PASS');

}finally{cdp?.close();if(browser?.pid)killTree(browser.pid);if(server.pid)killTree(server.pid);if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()))throw Error('Unexpected profile path');rmSync(profile,{recursive:true,force:true});}
