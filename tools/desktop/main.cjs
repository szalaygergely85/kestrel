// EP-DESKTOP-SPIKE: direct disk loading, deliberately leaving game boot untouched.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const probe = option('probe');
const profile = path.resolve(option('profile') || path.join(root, '.codex/desktop-profile'));
fs.mkdirSync(profile, { recursive:true });
app.setPath('userData', profile);
// Architecture 38.7: native WebGPU on Windows; Linux is the only unsafe-WebGPU opt-in.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-unsafe-webgpu');

const messages = [];
let window;
app.whenReady().then(async () => {
  window = new BrowserWindow({ width:1600, height:1000, useContentSize:true, show:!probe,
    webPreferences:{ nodeIntegration:false, contextIsolation:true, sandbox:true, backgroundThrottling:false, offscreen:!!probe } });
  window.webContents.on('console-message', details => {
    messages.push({ level:details.level, message:details.message, source:details.sourceId, line:details.lineNumber });
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => messages.push({ code, description, url }));
  window.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  if (probe) window.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (details, callback) => {
    messages.push({blockedNetwork:details.url}); callback({cancel:true});
  });
  await window.loadFile(path.join(root, 'game/index.html'), {
    query:{ backend:'webgpu', grid:'400x150', ...(probe ? {pose:'roadSouth'} : {}) } });
  if (probe) {
    try { await require('./probe.cjs').runProbe(window, path.resolve(probe), messages); }
    catch (error) { console.error(error); app.exit(1); return; }
    window.webContents.session.flushStorageData();
    app.quit();
  }
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
