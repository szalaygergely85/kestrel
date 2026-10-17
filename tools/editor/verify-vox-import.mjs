// S8-C-20a: repeatable real-GPU import/placement check using generated VOX files.
// node tools/editor/verify-vox-import.mjs [9800..9998]; changes only browser memory.
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {makeVoxCube} from './voxImportFixture.mjs';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,evaluateAsync,killTree} from '../capture-browser.mjs';
const port=Number(process.argv[2] || 9880); validatePort(port); validatePort(port+1);
if(port<9800 || port>9998)throw Error('Use a lane C port in 9800..9998');
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-vox-import-'));
const out=path.join(ROOT,'docs/test-reports/captures');mkdirSync(out,{recursive:true});
const server=spawn('python',['-c','import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()',String(port)],{cwd:ROOT,stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,cdp;
try {
 await waitForHttp(`http://127.0.0.1:${port}/`,10000);
 browser=spawn(findBrowserBinary(),['--headless=new',`--remote-debugging-port=${port+1}`,...buildLaunchFlags({}),'--no-sandbox',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 cdp=await connectCdp(port+1,15000);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const errors=[];
 cdp.onEvent((m,p)=>{if(m==='Runtime.exceptionThrown')errors.push(p.exceptionDetails);});
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/tools/editor/index.html?grid=400x150`});
 let ready=false;
 for(let i=0;i<120;i++){
  await pause(500);ready=await evaluate(cdp,'!!window.__editor');if(ready)break;
  if(await evaluate(cdp,'window.__editorBoot?.phase==="failed"'))throw Error(await evaluate(cdp,'window.__editorBoot.error'));
 }
 assert.equal(ready,true,`editor boot timed out: ${JSON.stringify(errors)}`);
 const gpu=await evaluate(cdp,`(()=>{const e=__editor,gl=e.rt.gl,ext=gl.getExtension('WEBGL_debug_renderer_info');Object.assign(e.cam,{x:1475,y:1034,z:e.world.floorAt(1475,1034)+1.8,yawDeg:0,pitchDeg:-12});e.frame.markDirty();document.querySelector('[data-dock-tab="assets"]').click();return {gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),grid:[e.rt.cols,e.rt.rows],renderer:e.frame.renderer};})()`);
 assert.equal(gpu.renderer,'mesh');assert.deepEqual(gpu.grid,[400,150]);assert.doesNotMatch(gpu.gpu,/swiftshader|software|llvmpipe/i);
 console.log(JSON.stringify(gpu));
 async function click(selector){const p=await evaluate(cdp,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...p});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...p});}
 async function shot(name){await pause(500);const s=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,`${name}.png`),Buffer.from(s.data,'base64'));}
 await shot('vox-editor-before');
 for(const n of [16,40]){
  await evaluate(cdp,`window.showOpenFilePicker=async()=>[{getFile:async()=>new File([Uint8Array.from(atob('${makeVoxCube(n).toString('base64')}'),c=>c.charCodeAt(0))],'probe${n}.vox')}];`);
  await click('#assets-import-vox-btn');await pause(1000);
  const imported=await evaluate(cdp,`(()=>{const e=__editor,k=e.armedModelKey,p=e.frame.voxelPool.models.get(k);window.__voxBefore=JSON.stringify(e.doc.files.get('world/world_m1').def);return {key:k,meshOnly:!!e.assets.model(k)?.voxel?.meshOnly,packed:!!p,undo:e.undoStack.size,status:document.querySelector('#status').textContent};})()`);console.log(JSON.stringify(imported));
  assert.equal(imported.key,`probe${n}`);assert.equal(imported.packed,true);assert.equal(imported.meshOnly,n===40);
  const target=await evaluate(cdp,`(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return {x:r.x+r.width*${n===16?'.45':'.6'},y:r.y+r.height*.65};})()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...target});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...target});await pause(1000);
  const placed=await evaluate(cdp,`(()=>{const e=__editor,s=e.selection;window.__voxAfter=JSON.stringify(e.doc.files.get('world/world_m1').def);return {selection:s,undo:e.undoStack.size,item:e.doc.files.get(s.fileId).def[s.collection].find(it=>it.id===s.id)};})()`);
  assert.equal(placed.selection.collection,'entities');assert.equal(placed.item.components.voxel.model,imported.key);assert.equal(placed.undo,imported.undo+1);
  assert.equal(await evaluateAsync(cdp,'__editor.validateDoc()'),null,'imported placement validates');
  // ED-WG-01c move step: nudge the placed vox (same path as the field/drag edit), assert it moved, undo restores it.
  const pos=`(()=>{const e=__editor,s=e.selection,it=e.doc.files.get(s.fileId).def[s.collection].find(i=>i.id===s.id);return it.x+','+it.y+','+it.z;})()`;
  const posBefore=await evaluate(cdp,pos);
  await evaluate(cdp,"__editor.applyNudge('x',1)");await pause(500);
  const posMoved=await evaluate(cdp,pos);
  assert.notEqual(posMoved,posBefore,'nudge moved the placed vox');
  assert.equal(await evaluate(cdp,"JSON.stringify(__editor.doc.files.get('world/world_m1').def)===__voxAfter"),false,'move changed the doc');
  await evaluate(cdp,'__editor.doUndo()');await pause(500);
  assert.equal(await evaluate(cdp,pos),posBefore,'undo restores the pre-move position');
  assert.equal(await evaluate(cdp,"JSON.stringify(__editor.doc.files.get('world/world_m1').def)===__voxAfter"),true,'undo of move restores placed doc');
  await evaluate(cdp,'__editor.doUndo()');await pause(500);
  assert.equal(await evaluate(cdp,"JSON.stringify(__editor.doc.files.get('world/world_m1').def)===__voxBefore"),true,'undo restores authored world');
  await evaluate(cdp,'__editor.doRedo()');await pause(500);
  assert.equal(await evaluate(cdp,"JSON.stringify(__editor.doc.files.get('world/world_m1').def)===__voxAfter"),true,'redo restores imported placement');
  console.log(JSON.stringify({size:n,placed,validation:'PASS',undoRedo:'PASS'}));
  await shot(`vox-editor-placed-${n}`);
 }
 assert.deepEqual(errors,[],'no browser exceptions');
}finally{cdp?.close();if(browser?.pid)killTree(browser.pid);if(server.pid)killTree(server.pid);
 if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()))throw Error('Unexpected profile path');
 rmSync(profile,{recursive:true,force:true});}

