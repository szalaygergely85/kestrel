// ED-MESH-01f: physical mesh drag and committed live collider verification on a real GPU.
import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,killTree} from '../capture-browser.mjs';
const port=Number(process.argv[2] || 9880);validatePort(port);if(port<9800 || port>9998)throw Error('Lane C port required');
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-mesh-live-')),out=path.join(ROOT,'docs/test-reports/captures');mkdirSync(out,{recursive:true});
const server=spawn('python',['-c','import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()',String(port)],{cwd:ROOT,stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,cdp;
try {
 await waitForHttp(`http://127.0.0.1:${port}/`,10000);
 browser=spawn(findBrowserBinary(),['--headless=new',`--remote-debugging-port=${port+1}`,...buildLaunchFlags({}),'--no-sandbox',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 cdp=await connectCdp(port+1,15000);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const errors=[];cdp.onEvent((m,p)=>{if(m==='Runtime.exceptionThrown')errors.push(p.exceptionDetails);});
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/tools/editor/index.html?grid=400x150&physics=mesh`});
 let ready=false;for(let i=0;i<120;i++){await pause(500);if(await evaluate(cdp,'!!window.__editor')){ready=true;break;}}assert.ok(ready,JSON.stringify(errors));
 const gpu=await evaluate(cdp,`(()=>{const e=__editor,gl=e.rt.gl;Object.assign(e.cam,{x:1475,y:1034,z:e.world.floorAt(1475,1034)+1.8,yawDeg:0,pitchDeg:-12});e.placeAt('prop',{x:1475,y:1028},'@mesh/quaternius/Rock_Medium_1');e.frame.markDirty();return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);})()`);
 assert.doesNotMatch(gpu,/swiftshader|software|llvmpipe/i);await pause(500);
 const initial=await evaluate(cdp,`(()=>{const e=__editor;window.__meshLiveWorld=e.world;window.__meshCollider=e.world.colliders.find(c=>c.id==='meshes:static');window.__meshCalls={setter:0,collider:0};const setter=e.world.setMeshPlacement,rebuild=e.world.rebuildMeshColliders;e.world.setMeshPlacement=function(...args){__meshCalls.setter++;return setter.apply(this,args);};e.world.rebuildMeshColliders=function(...args){__meshCalls.collider++;return rebuild.apply(this,args);};return {id:e.selection.id,undo:e.undoStack.size,rebuild:e.rebuildRuns,mode:e.world.physicsMode,origin:{...e.world.structures.find(s=>s.id===e.selection.id).origin}};})()`);
 await cdp.send('Runtime.evaluate',{expression:"import('./ray.js').then(m=>window.__meshRay=m)",awaitPromise:true});
 const point=await evaluate(cdp,`(()=>{const e=__editor,m=__meshRay,s=e.world.structures.find(s=>s.id===e.selection.id);const p=m.projectPoint(e.cam,e.rt.cols,e.rt.rows,e.rt.pxCellW,e.rt.pxCellH,{x:s.origin.x,y:s.origin.y,z:s.origin.z+0.8},'mesh');for(let dy=-8;dy<=8;dy++)for(let dx=-8;dx<=8;dx++){const col=Math.round(p.col)+dx,row=Math.round(p.row)+dy,hit=e.pickAt(col,row);if(hit?.kind==='meshStructure'&&hit.structureId===s.id){const r=document.querySelector('#screen').getBoundingClientRect();return {x:r.x+(col+.5)*r.width/e.rt.cols,y:r.y+(row+.5)*r.height/e.rt.rows};}}throw Error('No mesh pick cell');})()`);
 assert.ok(Number.isFinite(point?.x)&&Number.isFinite(point?.y),JSON.stringify(point));
 const state=()=>evaluate(cdp,`(()=>{const e=__editor,s=e.world.structures.find(s=>s.id===${JSON.stringify(initial.id)}),item=e.doc.files.get('world/world_m1').def.structures.find(s=>s.id===${JSON.stringify(initial.id)});return {origin:{...s.origin},doc:{...item.origin},undo:e.undoStack.size,rebuild:e.rebuildRuns,sameWorld:e.world===__meshLiveWorld,sameCollider:e.world.colliders.find(c=>c.id==='meshes:static')===__meshCollider,calls:{...__meshCalls}};})()`);
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:point.x+100,y:point.y});await pause(500);
 const held=await state();assert.notDeepEqual(held.origin,initial.origin);assert.deepEqual(held.doc,initial.origin);assert.equal(held.undo,initial.undo);assert.equal(held.rebuild,initial.rebuild);assert.equal(held.sameCollider,true);assert.ok(held.calls.setter>0);assert.equal(held.calls.collider,0);
 const shot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,'mesh-live-drag.png'),Buffer.from(shot.data,'base64'));
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:point.x+100,y:point.y});await pause(500);
 const committed=await state();assert.deepEqual(committed.doc,held.origin);assert.deepEqual(committed.origin,held.origin);assert.equal(committed.sameWorld,true);assert.equal(committed.rebuild,initial.rebuild);assert.equal(committed.undo,initial.undo+1);assert.equal(committed.calls.collider,initial.mode==='mesh'?1:0);
 await evaluate(cdp,'__editor.doUndo()');await pause(350);let undone=await state();assert.deepEqual(undone.origin,initial.origin);assert.equal(undone.sameWorld,true);assert.equal(undone.rebuild,initial.rebuild);
 await evaluate(cdp,'__editor.doRedo()');await pause(350);const redone=await state();assert.deepEqual(redone.origin,held.origin);assert.equal(redone.sameWorld,true);assert.equal(redone.rebuild,initial.rebuild);
 await evaluate(cdp,'__editor.doUndo()');await pause(300);
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:point.x+80,y:point.y});await pause(300);
 const cancelBefore=await state();await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',code:'Escape',key:'Escape'});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',code:'Escape',key:'Escape'});await pause(350);await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:point.x+80,y:point.y});await pause(200);
 const cancelled=await state();assert.deepEqual(cancelled.origin,initial.origin);assert.deepEqual(cancelled.doc,initial.origin);assert.equal(cancelled.calls.collider,cancelBefore.calls.collider);assert.equal(cancelled.rebuild,initial.rebuild);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({gpu,grid:[400,150],initial,held,committed,redone,cancelled}));console.log('Physical mesh preview/release/undo/redo/Escape, no World reload, deferred collider rebuild PASS');
}finally{cdp?.close();if(browser?.pid)killTree(browser.pid);if(server.pid)killTree(server.pid);if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()))throw Error('Unexpected profile path');rmSync(profile,{recursive:true,force:true});}
