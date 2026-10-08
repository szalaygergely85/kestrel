// S8-C-14: real-GPU chart preview. Run: node tools/verify-map-chart.mjs 9890 webgpu (or webgl2)
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,killTree} from './capture-browser.mjs';
const port=Number(process.argv[2] || 9890), backend=process.argv[3] || 'webgpu';
const fog=process.argv.includes('--fog');
validatePort(port);
if(port<9800 || port>9998)throw new Error('Lane C port must be 9800..9998');
assert.ok(['webgpu','webgl2'].includes(backend));
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-chart-'));
const out=path.join(ROOT,'docs/test-reports/captures');mkdirSync(out,{recursive:true});
const server=spawn('python',['-c','import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()',String(port)],{cwd:ROOT,stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,cdp;
try {
 await waitForHttp(`http://127.0.0.1:${port}/`,10000);
 browser=spawn(findBrowserBinary(),['--headless=new',`--remote-debugging-port=${port+1}`,...buildLaunchFlags({}),'--no-sandbox',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 cdp=await connectCdp(port+1,15000);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const errors=[];cdp.onEvent((m,p)=>{if(m==='Runtime.exceptionThrown')errors.push(p.exceptionDetails);});
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/game/js/quest/mapCard.preview.html?backend=${backend}${fog?'&fog=1':''}`});
 let ready=false;for(let i=0;i<100;i++){await pause(300);if(await evaluate(cdp,'!!window.__mapChartPreview')){ready=true;break;}}assert.ok(ready,JSON.stringify(errors));
 async function key(code,key=code){await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',code,key});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',code,key});await pause(500);}
 const state=await evaluate(cdp,`(()=>{const p=__mapChartPreview;return {info:p.info,grid:[p.rt.cols,p.rt.rows],gpu:p.rt.gl ? p.rt.gl.getParameter(p.rt.gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) : p.info.label};})()`);
 assert.equal(state.info.backend,backend==='webgl2' ? 'gl2' : backend);assert.deepEqual(state.grid,[400,150]);assert.doesNotMatch(state.gpu,/swiftshader|software|llvmpipe/i);console.log(JSON.stringify(state));
 await key('KeyM','m');assert.equal(await evaluate(cdp,'__mapChartPreview.panel.state'),'open');
 assert.equal(await evaluate(cdp,'__mapChartPreview.view.position.code'),94);
 assert.equal(await evaluate(cdp,'(()=>{const p=__mapChartPreview;return p.panel.x0>=0 && p.panel.y0>=0 && p.panel.x0+p.panel.art.w<=p.ui.cols && p.panel.y0+p.panel.art.h<=p.ui.rows;})()'),true);
 const prefix=fog?'map-fog-':'map-chart-';
 const shot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,prefix+backend+'.png'),Buffer.from(shot.data,'base64'));
 for(const code of [62,118,60,94]){await evaluate(cdp,'document.querySelector("#rotate").click()');await pause(100);assert.equal(await evaluate(cdp,'__mapChartPreview.view.position.code'),code);}
 if(fog){
  const x=await evaluate(cdp,'__mapChartPreview.transform.x');
  await evaluate(cdp,'document.querySelector("#walk").click()');await pause(100);
  assert.equal(await evaluate(cdp,'__mapChartPreview.transform.x'),x-100);
  assert.equal(await evaluate(cdp,'__mapChartPreview.view.art.codes.includes(42)'),true);
  assert.equal(await evaluate(cdp,'__mapChartPreview.view.art.codes.includes(32)'),true);
  assert.equal(await evaluate(cdp,'(()=>{const p=__mapChartPreview;const bytes=p.fog.save();p.fog.restore(bytes);return String(bytes)===String(p.fog.save());})()'),true);
  await pause(100);const walkShot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(out,prefix+'walk-'+backend+'.png'),Buffer.from(walkShot.data,'base64'));
 }
 const x=await evaluate(cdp,'__mapChartPreview.view.position.x');await evaluate(cdp,'document.querySelector("#move").click()');await pause(100);assert.ok(await evaluate(cdp,'__mapChartPreview.view.position.x')>x);
 await key('Escape');assert.equal(await evaluate(cdp,'__mapChartPreview.panel.state'),'closed');
 await key('KeyM','m');assert.equal(await evaluate(cdp,'__mapChartPreview.panel.state'),'open');
 await key('Escape');await evaluate(cdp,"__mapChartPreview.world.state['quest.endT']=0");await key('KeyM','m');assert.equal(await evaluate(cdp,'__mapChartPreview.panel.state'),'closed');
 assert.deepEqual(errors,[]);console.log('Chart position/headings, physical M/Esc, ending gate and real-GPU preview PASS');
} finally {
 cdp?.close();if(browser?.pid)killTree(browser.pid);if(server.pid)killTree(server.pid);
 if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir()))throw Error('Unexpected profile path');
 rmSync(profile,{recursive:true,force:true});
}
