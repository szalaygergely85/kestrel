// ASCII Quest desktop shell. Dev: loads the repo (root = ../..). Packed: root = this folder (resources/app).
const { app, BrowserWindow, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const packed = fs.existsSync(path.join(__dirname, 'game/index.html'));
const root = packed ? __dirname : path.resolve(__dirname, '../..');
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const probe = option('probe');
// Packed: Electron's default userData = %APPDATA%/<productName> ("ASCII Quest"). Dev spike: isolated profile.
const profile = option('profile') || (packed ? null : path.join(root, '.codex/desktop-profile'));
if (profile) { fs.mkdirSync(path.resolve(profile), { recursive:true }); app.setPath('userData', path.resolve(profile)); }
// Architecture 38.7: native WebGPU on Windows; Linux is the only unsafe-WebGPU opt-in.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-unsafe-webgpu');

const messages = [];
let window;
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({ width:1600, height:900, useContentSize:true, show:!probe, title:'ASCII Quest',
    autoHideMenuBar:true, backgroundColor:'#000000',
    webPreferences:{ preload:path.join(__dirname, 'preload.cjs'), nodeIntegration:false, contextIsolation:true,
      sandbox:true, devTools:!packed, backgroundThrottling:false, offscreen:!!probe } });
  window.setMenuBarVisibility(false);
  window.on('page-title-updated', event => event.preventDefault()); // keep the window title
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { window.setFullScreen(!window.isFullScreen()); event.preventDefault(); }
  });
  window.webContents.on('console-message', details => {
    messages.push({ level:details.level, message:details.message, source:details.sourceId, line:details.lineNumber });
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => messages.push({ code, description, url }));
  window.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  if (probe) window.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (details, callback) => {
    messages.push({blockedNetwork:details.url}); callback({cancel:true});
  });
  // No ?grid= unless asked: the game's quality preset picks the startup grid.
  const query = { backend:'webgpu', ...(option('grid') ? { grid:option('grid') } : {}), ...(probe ? {pose:'roadSouth'} : {}) };
  await window.loadFile(path.join(root, 'game/index.html'), { query });
  if (probe) {
    try { await require('./probe.cjs').runProbe(window, path.resolve(probe), messages); }
    catch (error) { console.error(error); app.exit(1); return; }
    window.webContents.session.flushStorageData();
    app.quit();
  }
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
