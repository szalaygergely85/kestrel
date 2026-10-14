// ED-LOGIC-02b: headless check of the editor Logic tab. Run: node tools/verify-edl-02.mjs <port>   (own port, kills its own server)
// Opens tools/editor/index.html, clicks the Logic tab, edits through the DOM (add block, edit, undo), checks live lint + Go to.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ROOT, validatePort, findBrowserBinary, buildLaunchFlags, waitForHttp, connectCdp, evaluateAsync, killTree } from './capture-browser.mjs';

const port = Number(process.argv[2] || 9577);
validatePort(port);
const profile = mkdtempSync(path.join(os.tmpdir(), 'kestrel-edl02-'));
const server = spawn('python', ['-c', 'import http.server,sys; http.server.ThreadingHTTPServer.request_queue_size=128; sys.argv=["tools/serve.py",sys.argv[1]]; import tools.serve; tools.serve.main()', String(port)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, cdp, code = 0;
try {
  await waitForHttp(`http://127.0.0.1:${port}/`, 10000);
  browser = spawn(findBrowserBinary(), ['--headless=new', `--remote-debugging-port=${port + 1}`, ...buildLaunchFlags({}), '--no-sandbox', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCdp(port + 1, 15000);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/tools/editor/index.html` });
  const ev = (js) => evaluateAsync(cdp, `(async()=>{${js}})()`);
  await pause(3000);
  const r = await ev(`
    const wait = async (f) => { for (let i = 0; i < 100; i++) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timeout'); };
    document.querySelector('[data-dock-tab="logic"]').click();
    await wait(() => window.__logicPanel);
    const q = (s) => document.querySelector('#logic-panel ' + s);
    const blocks0 = document.querySelectorAll('#logic-panel .lg-block').length;
    const whenLabel = q('[data-block] select[data-kind="when"]').selectedOptions[0].textContent;
    q('#logic-new').click();
    const blocks1 = document.querySelectorAll('#logic-panel .lg-block').length;
    const lintRows = document.querySelectorAll('#logic-lint .q-lint-row').length;   // new block: empty area ref -> a problem
    q('#logic-undo').click();
    const blocks2 = document.querySelectorAll('#logic-panel .lg-block').length;
    const pick = !!q('[data-pick="area"]');
    return { blocks0, blocks1, blocks2, whenLabel, lintRows, pick, dirty: window.__logicPanel.model.files.size };`);
  assert.equal(r.blocks1, r.blocks0 + 1, 'New block adds a block');
  assert.equal(r.blocks2, r.blocks0, 'Undo removes it');
  assert.ok(r.lintRows >= 1, 'live lint lists the empty ref');
  assert.ok(!/area\.enter/.test(r.whenLabel), 'plain label, not the raw id: ' + r.whenLabel);
  assert.ok(r.pick, 'area has a Pick button');
  console.log('verify-edl-02 ok', JSON.stringify(r));
} catch (e) { console.error('verify-edl-02 FAILED', e && e.message); code = 1; }
finally { if (cdp) cdp.close(); if (browser) killTree(browser.pid); killTree(server.pid); }
process.exit(code);
