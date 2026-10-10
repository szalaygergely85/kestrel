// S8-B1-20: real-GPU check of the boot loading card's per-stage ms lines + the F3 boot summary's 10 s window.
// Run: node tools/verify-boot-card.mjs <port> [webgpu]   (owner machine only - not run by this change)
import {spawn} from 'node:child_process';
import { withTimeFreeze } from './tool-url.mjs'; // DN-04a
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';
import {ROOT,validatePort,findBrowserBinary,buildLaunchFlags,waitForHttp,connectCdp,evaluate,killTree} from './capture-browser.mjs';
const port=Number(process.argv[2] || 9887);
validatePort(port);
const backend=process.argv[3] || 'webgpu';
assert.ok(['webgpu'].includes(backend),'backend must be webgpu');
const profile=mkdtempSync(path.join(os.tmpdir(),'kestrel-boot-card-'));
const server=spawn('python',['-c','import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()',String(port)],{cwd:ROOT,stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let browser,cdp;
try{
 await waitForHttp(`http://127.0.0.1:${port}/`,10000);
 browser=spawn(findBrowserBinary(),['--headless=new',`--remote-debugging-port=${port+1}`,...buildLaunchFlags({}),'--no-sandbox',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
 cdp=await connectCdp(port+1,15000);await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 const errors=[];cdp.onEvent((m,p)=>{if(m==='Runtime.exceptionThrown')errors.push(p.exceptionDetails);});
 await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}/game/index.html?${withTimeFreeze(`backend=${backend}&f3=1`)}`});

 // Catch the card mid-boot: poll for #bootcard text that already has at least one "<stage> <n> ms" line
 // (content closes first, so this should show up well before first frame on any real GPU).
 let sawStageLine=false, cardText='';
 for (let i=0;i<200;i++){
   cardText = await evaluate(cdp, "(()=>{const el=document.getElementById('bootcard');return el ? el.textContent : '';})()");
   if (/\n[a-z]+ \d+ ms/.test(cardText)) { sawStageLine = true; break; }
   if (await evaluate(cdp,'!!window.__bootReport')) break; // boot already finished (card removed) - too fast to catch, not a failure
   await pause(25);
 }
 if (cardText) console.log('[boot-card mid-boot]', JSON.stringify(cardText));

 // Wait for first frame (window.__bootReport set by main.js's bootFirst branch), then read the F3 overlay text.
 let booted=false;
 for (let i=0;i<400;i++){ if (await evaluate(cdp,'!!window.__bootReport')) { booted=true; break; } await pause(50); }
 assert.ok(booted, JSON.stringify({errors,msg:'boot did not finish (no window.__bootReport)'}));

 const f3Text = await evaluate(cdp, "(()=>{const el=document.querySelector('.debug-overlay,#overlay,[data-debug-overlay]');return el ? el.textContent : document.body.textContent;})()");
 assert.match(f3Text, /stages \(total \d+ ms\):/, JSON.stringify({f3Text,msg:'F3 should show the stage total right after boot'}));
 console.log('[F3 right after boot]', JSON.stringify(f3Text.slice(0,400)));

 // Wait past the 10 s window and confirm the stage line is gone from F3 (but the rest of the overlay still renders).
 await pause(10500);
 const f3Later = await evaluate(cdp, "(()=>{const el=document.querySelector('.debug-overlay,#overlay,[data-debug-overlay]');return el ? el.textContent : document.body.textContent;})()");
 assert.doesNotMatch(f3Later, /stages \(total \d+ ms\):/, JSON.stringify({f3Later,msg:'F3 stage line should drop after 10 s'}));

 assert.deepEqual(errors,[]);
 console.log('Boot card: stage ms lines shown mid-boot ('+sawStageLine+'), F3 total shown then dropped after 10 s PASS');
} finally {
 if (cdp) try{await cdp.close();}catch{}
 if (browser) killTree(browser.pid);
 if (server) killTree(server.pid);
}
