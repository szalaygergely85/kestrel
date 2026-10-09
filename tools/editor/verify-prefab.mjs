// ED-GROUP-1c: physical prefab save/stamp UI and real content reload on a GPU.
import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,killTree} from '../capture-browser.mjs';
const port=Number(process.argv[2] || 9880);validatePort(port);if(port<9800 || port>9998)throw Error('Lane C port required');
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-prefab-')),out=path.join(ROOT,'docs/test-reports/captures');mkdirSync(out,{recursive:true});
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
 const gpu=await evaluate(cdp,`(()=>{const e=__editor,gl=e.rt.gl;Object.assign(e.cam,{x:1475,y:1034,z:e.world.floorAt(1475,1034)+1.8,yawDeg:0,pitchDeg:-12});e.placeAt('prop',{x:1474.5,y:1028},'crate');const first={...e.selection};e.placeAt('prop',{x:1475.5,y:1028},'crate');e.selectItem(first,{toggle:true});e.frame.markDirty();return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);})()`);
 assert.doesNotMatch(gpu,/swiftshader|software|llvmpipe/i);
 // FSA adapter is an in-memory directory, so the real UI Save path writes no checkout file.
 await cdp.send('Runtime.evaluate',{expression:`(async()=>{
 window.__prefabDisk={'manifest.json':await (await fetch('../../content/manifest.json')).text()};
 const handle=key=>({getFile:async()=>({text:async()=>__prefabDisk[key]}),createWritable:async()=>({write:async text=>{__prefabDisk[key]=text;},close:async()=>{}})});
 window.showDirectoryPicker=async()=>({getFileHandle:async key=>handle(key),getDirectoryHandle:async()=>({getFileHandle:async key=>handle('prefabs/'+key)})});
 document.querySelector('[data-dock-tab="assets"]').click(); document.querySelector('#prefab-title').value='Browser crate pair';
 })()`,awaitPromise:true});
 assert.equal(await evaluate(cdp,'__editor.sel.items.length'),2);
 const rect=await evaluate(cdp,`(()=>{const r=document.querySelector('#save-prefab-btn').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});await pause(600);
 const saved=await evaluate(cdp,`(()=>({text:__prefabDisk['prefabs/browser_crate_pair.prefab.json'],manifest:JSON.parse(__prefabDisk['manifest.json']),row:!!document.querySelector('[data-prefab-id="browser_crate_pair"]')}))()`);
 assert.ok(saved.text);assert.ok(saved.row);assert.ok(saved.manifest.files.includes('prefabs/browser_crate_pair.prefab.json'));assert.equal(JSON.parse(saved.text).items.length,2);
 // Exercise the row arm, then physical viewport placement at two projected ground cells.
 await cdp.send('Runtime.evaluate',{expression:"import('./ray.js').then(m=>window.__prefabRay=m)",awaitPromise:true});
 const stamp=async(x,y)=>{
  const row=await evaluate(cdp,`(()=>{document.querySelector('#prefab-yaw').value='90';const r=document.querySelector('[data-prefab-id="browser_crate_pair"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...row});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...row});
  assert.equal(await evaluate(cdp,'__editor.armedModelKey'),'@prefab/browser_crate_pair');
  const point=await evaluate(cdp,`(()=>{const e=__editor,p=__prefabRay.projectPoint(e.cam,e.rt.cols,e.rt.rows,e.rt.pxCellW,e.rt.pxCellH,{x:${x},y:${y},z:e.world.floorAt(${x},${y})},'mesh'),r=document.querySelector('#screen').getBoundingClientRect();return {x:r.x+(p.col+.5)*r.width/e.rt.cols,y:r.y+(p.row+.5)*r.height/e.rt.rows};})()`);
  const undo=await evaluate(cdp,'__editor.undoStack.size');
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await pause(600);
  assert.equal(await evaluate(cdp,'__editor.undoStack.size'),undo+1);
 };
 await stamp(1472,1028);await stamp(1478,1028);
 const count=()=>evaluate(cdp,`__editor.doc.files.get('world/world_m1').def.entities.filter(it=>it.prefab==='browser_crate_pair').length`);
 assert.equal(await count(),4);
 await evaluate(cdp,'__editor.doUndo()');await pause(300);assert.equal(await count(),2);
 await evaluate(cdp,'__editor.doRedo()');await pause(500);assert.equal(await count(),4);
 const state=await evaluate(cdp,`(()=>{const e=__editor,items=e.doc.files.get('world/world_m1').def.entities.filter(it=>it.prefab==='browser_crate_pair');return {items,groups:[...new Set(items.map(it=>it.group))],live:items.every(it=>!!e.world.entity(it.id)),grid:[e.rt.cols,e.rt.rows]};})()`);
 assert.equal(state.groups.length,2);assert.equal(new Set(state.items.map(it=>it.id)).size,4);assert.equal(state.live,true);
 const shot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,'prefab-two-stamps.png'),Buffer.from(shot.data,'base64'));
 // Real content-loader reload from the files saved by the UI; instantiate the ordinary stamped world.
 await cdp.send('Runtime.evaluate',{expression:`(async()=>{const m=await import('../../engine/index.js'),e=__editor,io=await import('./io.js');
 const files=[...e.doc.files.values()].filter(f=>f.kind==='world'||f.kind==='prefab');
 const manifest={kind:'manifest',schema:1,id:'reloaded',contentVersion:0,files:files.map(f=>f.kind+'s/'+f.id+'.'+f.kind+'.json')};
 const texts={'manifest.json':JSON.stringify(manifest)};for(const f of files)texts[f.kind+'s/'+f.id+'.'+f.kind+'.json']=m.stringifyContent(io.toFileObject(f));
 const b=await m.loadContentPack('http://reload/manifest.json',{fetchText:url=>Promise.resolve(texts[new URL(url).pathname.slice(1)])});
 const a=m.AssetRegistry.fromJSON(b,window.ASSETS);for(const id of e.assets.keys('level'))a.add('level',id,e.assets.level(id));for(const id of e.assets.keys('mesh'))a.add('mesh',id,e.assets.mesh(id));
 const w=m.World.load(b.worlds.world_m1,a,{});window.__prefabReloaded=b.prefabs.browser_crate_pair.items.length===2&&${JSON.stringify(state.items.map(it=>it.id))}.every(id=>!!w.entity(id));
 })()`,awaitPromise:true});
 assert.equal(await evaluate(cdp,'__prefabReloaded'),true);
 await evaluate(cdp,`(()=>{const e=__editor,files={};for(const f of e.doc.files.values()){files[f.kind+'/'+f.id]=f.def;f.dirty=false;}localStorage.setItem('kestrel.playtest',JSON.stringify({savedAt:Date.now(),world:e.doc.worldId,files}));})()`);
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/game/index.html?playtest=1&world=world_m1&grid=400x150&gpu=1`});
 let gameReady=false;for(let i=0;i<120;i++){await pause(500);if(await evaluate(cdp,'!!window.__debug?.world')){gameReady=true;break;}}assert.ok(gameReady,JSON.stringify(errors));
 const gameCopies=await evaluate(cdp,`(${JSON.stringify(state.items.map(it=>it.id))}).every(id=>!!__debug.world.entity(id))`);
 assert.equal(gameCopies,true);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({gpu,...state}));console.log('Physical Save/manifest/asset arm/two stamps/undo/redo/content reload/game play-test boot PASS');
}finally{cdp?.close();if(browser?.pid)killTree(browser.pid);if(server.pid)killTree(server.pid);if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()))throw Error('Unexpected profile path');rmSync(profile,{recursive:true,force:true});}
