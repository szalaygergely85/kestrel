// CREDITS-ROW-01: title-menu keyboard and pointer action on real WebGPU.
import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,killTree} from '../capture-browser.mjs';
const port=Number(process.argv[2] || 9880);validatePort(port);if(port<9800 || port>9998)throw Error('Lane C port required');
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-credits-row-')),out=path.join(ROOT,'docs/test-reports/captures');mkdirSync(out,{recursive:true});
const server=spawn('python',['-c','import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()',String(port)],{cwd:ROOT,stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,cdp;
try {
 await waitForHttp(`http://127.0.0.1:${port}/`,10000);
 browser=spawn(findBrowserBinary(),['--headless=new',`--remote-debugging-port=${port+1}`,...buildLaunchFlags({}),'--no-sandbox',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 cdp=await connectCdp(port+1,15000);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const errors=[];cdp.onEvent((m,p)=>{if(m==='Runtime.exceptionThrown')errors.push(p.exceptionDetails);});
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/game/js/ui/titleMenu.preview.html?backend=webgpu`});
 let ready=false;for(let i=0;i<120;i++){await pause(500);if(await evaluate(cdp,'!!window.__titleMenuPreview')){ready=true;break;}}assert.ok(ready,JSON.stringify(errors));
 const device=await cdp.send('Runtime.evaluate',{expression:`navigator.gpu.requestAdapter().then(a=>({architecture:a.info.architecture,vendor:a.info.vendor,device:a.info.device}))`,awaitPromise:true,returnByValue:true});
 const gpu=device.result.value;assert.ok(gpu);assert.doesNotMatch(JSON.stringify(gpu),/swiftshader|software|llvmpipe/i);
 assert.deepEqual(await evaluate(cdp,'__titleMenuPreview.menu.snapshot().rows.map(r=>r.text)'),['New game','Continue','Load game','Settings','Credits']);
 const key=async(code,key)=>{await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',code,key});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',code,key});await pause(150);};
 await key('ArrowDown','ArrowDown');await key('ArrowDown','ArrowDown');await key('Enter','Enter');
 assert.equal(await evaluate(cdp,'__titleMenuPreview.menu.snapshot().mode'),'load');
 assert.deepEqual(await evaluate(cdp,'__titleMenuPreview.menu.snapshot().rows.map(r=>r.enabled)'),[true,false,true,true]);
 await key('ArrowDown','ArrowDown');await key('Enter','Enter');assert.equal(await evaluate(cdp,"document.querySelector('#status').textContent"),'load: slot 3');
 await key('ArrowDown','ArrowDown');await key('ArrowDown','ArrowDown');await key('Enter','Enter');await key('Escape','Escape');
 assert.equal(await evaluate(cdp,'__titleMenuPreview.menu.snapshot().mode'),'main');
 await key('ArrowUp','ArrowUp');assert.equal(await evaluate(cdp,'__titleMenuPreview.menu.snapshot().rows[__titleMenuPreview.menu.snapshot().selected].id'),'credits');
 const shot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,'credits-title-row.png'),Buffer.from(shot.data,'base64'));
 await key('Enter','Enter');assert.equal(await evaluate(cdp,"document.querySelector('#status').textContent"),'credits');
 const point=await evaluate(cdp,`(()=>{const e=__titleMenuPreview,b=e.menu.draw(e.ui),r=document.querySelector('#screen').getBoundingClientRect();return {x:r.x+(b.x+5.5)*r.width/e.ui.cols,y:r.y+(b.y+18.5)*r.height/e.ui.rows};})()`);
 await evaluate(cdp,"document.querySelector('#status').textContent='mouse pending'");
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await pause(300);
 assert.equal(await evaluate(cdp,"document.querySelector('#status').textContent"),'credits');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({gpu,grid:[400,150]}));console.log('Credits title row real-GPU keyboard/click PASS');
}finally{cdp?.close();if(browser?.pid)killTree(browser.pid);if(server.pid)killTree(server.pid);if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()))throw Error('Unexpected profile path');rmSync(profile,{recursive:true,force:true});}
