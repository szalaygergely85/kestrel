// S8-C-08: real-GPU item copy/icon preview. Run: node tools/verify-item-defs.mjs 9886
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,killTree} from './capture-browser.mjs';
const port=Number(process.argv[2] || 9886);
validatePort(port);
if(port<9800 || port>9998) throw new Error('Lane C port must be 9800..9998 (next port is CDP)');
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-item-defs-'));
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
 for(const backend of ['webgpu','webgl2']){
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/game/js/quest/itemDefs.preview.html?backend=${backend}`});
  let ready=false;for(let i=0;i<100;i++){await pause(300);if(await evaluate(cdp,'!!window.__itemDefsPreview')){ready=true;break;}}assert.ok(ready,JSON.stringify(errors));
  const state=await evaluate(cdp,`(()=>{const p=__itemDefsPreview;return {info:p.info,grid:[p.rt.cols,p.rt.rows],ids:p.ids,gpu:p.rt.gl ? p.rt.gl.getParameter(p.rt.gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) : p.info.label};})()`);
  assert.equal(state.info.backend,backend==='webgl2' ? 'gl2' : backend);assert.deepEqual(state.grid,[400,150]);assert.equal(state.ids.length,12);assert.doesNotMatch(state.gpu,/swiftshader|software|llvmpipe/i);console.log(JSON.stringify(state));
  const cells=await evaluate(cdp,`(()=>{const p=__itemDefsPreview,A=ASSETS;let count=0;const errors=[];
    for(let i=0;i<p.ids.length;i++){const d=A.items.defs[p.ids[i]],bx=3+(i%3)*52,by=7+Math.floor(i/3)*12;
      for(let y=0;y<3;y++)for(let x=0;x<5;x++){const ch=d.icon.glyphs[y].charCodeAt(x);if(ch===32)continue;
        const cell=(by+y)*p.ui.cols+bx+x,k=A.items.keys[d.icon.fg[y][x]],hex=A.palette.colors[k.c];
        const expected=[1,3,5].map(j=>parseInt(hex.slice(j,j+2),16));count++;
        if(p.ui.cells.glyphIdx[cell]!==ch-32 || !p.ui.cells.mask[cell] || expected.some((n,j)=>p.ui.cells.fg[cell*4+j]!==n))errors.push(d.id+':'+x+','+y);
      }}return {count,errors};})()`);
  assert.deepEqual(cells.errors,[]);console.log(JSON.stringify({backend,cpuIconCells:cells.count}));
  await shot('item-defs-'+backend);
 }
 assert.deepEqual(errors,[]);console.log('Item definitions: both real-GPU backends PASS');

}finally{cdp?.close();if(browser?.pid)killTree(browser.pid);if(server.pid)killTree(server.pid);if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()))throw Error('Unexpected profile path');rmSync(profile,{recursive:true,force:true});}
