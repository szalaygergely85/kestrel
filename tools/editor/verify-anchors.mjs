// CHEST-PLACE-01 / BOAR-ROSTER-01: memory-only anchor proposals on a real GPU.
import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,killTree} from '../capture-browser.mjs';
const port=Number(process.argv[2] || 9880);validatePort(port);if(port<9800 || port>9998)throw Error('Lane C port required');
const worldPath=path.join(ROOT,'content/worlds/world_m1.world.json'),sourceBefore=readFileSync(worldPath);
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-anchors-')),out=path.join(ROOT,'docs/test-reports/captures');mkdirSync(out,{recursive:true});
const server=spawn('python',['-c','import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()',String(port)],{cwd:ROOT,stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,cdp;
try {
 await waitForHttp(`http://127.0.0.1:${port}/`,10000);
 browser=spawn(findBrowserBinary(),['--headless=new',`--remote-debugging-port=${port+1}`,...buildLaunchFlags({}),'--no-sandbox',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 cdp=await connectCdp(port+1,15000);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const errors=[];cdp.onEvent((m,p)=>{if(m==='Runtime.exceptionThrown')errors.push(p.exceptionDetails);});
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/tools/editor/anchors.preview.html`});
 let ready=false;for(let i=0;i<120;i++){await pause(500);if(await evaluate(cdp,'!!window.__anchorPreview')){ready=true;break;}}assert.ok(ready,JSON.stringify(errors));
 const evidence=await evaluate(cdp,`(()=>{const p=__anchorPreview,e=p.editor,gl=e.rt.gl;return {gpu:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),grid:[e.rt.cols,e.rt.rows],chest:e.world.get(p.chest.id).data.transform,spawn:p.spawn,boars:p.rows.slice(1),coverBBox:p.coverBBox,originalEntityIds:p.originalEntityIds,entities:e.doc.files.get('world/world_m1').def.entities.map(e=>e.id)};})()`);
 assert.doesNotMatch(evidence.gpu,/swiftshader|software|llvmpipe/i);assert.deepEqual(evidence.grid,[400,150]);
 assert.deepEqual(evidence.entities,evidence.originalEntityIds.concat('hillsideChest'));
 assert.deepEqual(evidence.boars.map(b=>[b.id,b.x,b.y]),[['boar1',1461.01,1031],['boar2',1444.02,1035]]);
 assert.equal(evidence.spawn.x,1497);assert.equal(evidence.spawn.y,1027.5);assert.equal(evidence.spawn.yawDeg,330);
 for(const pose of ['chest','road','boars','spawn']) {
   const point=await evaluate(cdp,`(()=>{const r=document.querySelector('[data-pose="${pose}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
   await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
   await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await pause(700);
   assert.equal(await evaluate(cdp,'document.querySelector("#status").textContent'),pose+' view - proposal only');
   const shot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,'anchors-'+pose+'.png'),Buffer.from(shot.data,'base64'));
 }
 assert.ok(evidence.chest.y - 0.35 > evidence.coverBBox.y1,'chest footprint clear of cover bbox');
 assert.deepEqual(readFileSync(worldPath),sourceBefore,'production world byte-preserved');
 assert.deepEqual(errors,[]);writeFileSync(path.join(out,'anchors.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));console.log('Anchor proposals: source IDs/positions, preview-only chest, 400x150 real-GPU PASS');
}finally{cdp?.close();if(browser?.pid)killTree(browser.pid);if(server.pid)killTree(server.pid);if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()))throw Error('Unexpected profile path');rmSync(profile,{recursive:true,force:true});}
