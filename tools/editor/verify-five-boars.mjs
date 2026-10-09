// QUEST-CHAIN-02c: production homes, clearance and owner views; no world edits.
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,killTree} from '../capture-browser.mjs';
const port=Number(process.argv[2] || 9880);validatePort(port);
if(port<9800 || port>9998)throw Error('Lane C port required');
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-five-boars-'));
const out=path.join(ROOT,'docs/test-reports/captures');mkdirSync(out,{recursive:true});
const server=spawn('python',['tools/serve.py',String(port)],{cwd:ROOT,stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,cdp;
try {
 await waitForHttp(`http://127.0.0.1:${port}/`,10000);
 browser=spawn(findBrowserBinary(),['--headless=new',`--remote-debugging-port=${port+1}`,...buildLaunchFlags({}),'--no-sandbox',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 cdp=await connectCdp(port+1,15000);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const errors=[];cdp.onEvent((m,p)=>{if(m==='Runtime.exceptionThrown')errors.push(p.exceptionDetails);});
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/tools/editor/index.html?grid=400x150&backend=webgpu&physics=mesh`});
 let ready=false;for(let i=0;i<120;i++){await pause(500);if(await evaluate(cdp,'!!window.__editor')){ready=true;break;}}
 assert.ok(ready,JSON.stringify(errors));
 const result=await cdp.send('Runtime.evaluate',{returnByValue:true,awaitPromise:true,expression:`(async()=>{const e=__editor,w=e.world,t=w.terrain,a=await navigator.gpu.requestAdapter(),info=a.info;
 return {gpu:[info.vendor,info.architecture,info.device,info.description].join(' '),backend:e.rt.device.backend,grid:[e.rt.cols,e.rt.rows],
 boars:['boar1','boar2','boar3','boar4','boar5'].map(id=>{const p=w.get(id).data.transform,eps=.5;
 const slope=Math.atan(Math.hypot((t.heightAt(p.x+eps,p.y)-t.heightAt(p.x-eps,p.y))/(2*eps),(t.heightAt(p.x,p.y+eps)-t.heightAt(p.x,p.y-eps))/(2*eps)))*180/Math.PI;
 return {id,x:p.x,y:p.y,z:p.z,slope,ground:t.heightAt(p.x,p.y),floor:w.floorAt(p.x,p.y)};})};})()`});
 assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));const evidence=result.result.value;
 assert.equal(evidence.backend,'webgpu');assert.doesNotMatch(evidence.gpu,/swiftshader|software|llvmpipe/i);assert.deepEqual(evidence.grid,[400,150]);
 const fresh=evidence.boars.slice(2);
 for(const b of fresh){assert.ok(b.slope<30);assert.ok(Math.abs(b.floor-b.ground)<.15,`${b.id} has structure support instead of ground`);}
 for(const a of fresh)for(const b of evidence.boars)if(a.id!==b.id)assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=18);
 for(const b of fresh){
  await evaluate(cdp,`(()=>{const e=__editor;Object.assign(e.cam,{x:${b.x+5},y:${b.y},z:e.world.floorAt(${b.x+5},${b.y})+1.6,yawDeg:270,pitchDeg:-8});e.frame.markDirty();})()`);
  await pause(700);
  const shot=await cdp.send('Page.captureScreenshot',{format:'png'});
  writeFileSync(path.join(out,`${b.id}-home.png`),Buffer.from(shot.data,'base64'));
 }
 assert.deepEqual(errors,[]);writeFileSync(path.join(out,'five-boars.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));console.log('Five boar homes: ground, slope, spacing and real-GPU 400x150 PASS');
}finally{cdp?.close();if(browser?.pid)killTree(browser.pid);if(server.pid)killTree(server.pid);if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()))throw Error('Unexpected profile path');rmSync(profile,{recursive:true,force:true});}
