// Opt-in diagnostic run; captures the unmodified file:// boot and platform capabilities.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.runProbe = async function (window, output, messages) {
  const evaluate = source => window.webContents.executeJavaScript(source);
  for (let i = 0; i < 80; i++) {
    if (await evaluate('!!window.__debug?.world')) break;
    await pause(250);
  }
  const page = await evaluate(`(async () => {
    const d = window.__debug;
    const result = { url:location.href, secureContext:isSecureContext, nodeExposed:typeof require !== 'undefined',
      notice:document.getElementById('file-protocol-notice')?.textContent || null,
      backend:d?.rt?.backend || null, gpuActive:d?.rt?.gpuActive || false,
      grid:d?.rt ? [d.rt.cols,d.rt.rows] : null, worldLoaded:!!d?.world,
      playerPose:d?.playerHandle ? {...d.playerHandle.data.transform} : null };
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      result.webgpu = adapter ? { vendor:adapter.info.vendor, architecture:adapter.info.architecture,
        device:adapter.info.device, description:adapter.info.description,
        maxColorAttachmentBytesPerSample:adapter.limits.maxColorAttachmentBytesPerSample } : null;
      const device = await adapter?.requestDevice();
      result.deviceCreated = !!device; device?.destroy();
    } catch (error) { result.webgpuError = error.message; }
    result.fetches = [];
    for (const url of ['../content/manifest.json','../content/worlds/world_m1.world.json']) {
      try { const response = await fetch(url); const text = await response.text();
        result.fetches.push({url,status:response.status,ok:response.ok,bytes:text.length}); }
      catch (error) { result.fetches.push({url,error:error.message}); }
    }
    return result;
  })()`);
  // Use the shipped save adapter, in this spike's isolated profile only.
  const storage = await evaluate(`(async () => {
    try {
      const {createStorageAdapter} = await import('./js/quest/save/saveState.js');
      const adapter = createStorageAdapter(localStorage);
      const previous = localStorage.getItem('kestrel.save.slot.2');
      const save = {saveVersion:1,world:{version:2,entities:[],structures:[]},
        game:{quest:null,openedChests:[],deadBeasts:[]},meta:{playerName:'spike',place:'disk',playTimeSec:1}};
      const write = adapter.writeSlot(2,save), read = adapter.readSlot(2);
      const remove = adapter.deleteSlot(2);
      if(previous !== null) localStorage.setItem('kestrel.save.slot.2',previous);
      const previousMarker = localStorage.getItem('kestrel.desktop.spike');
      if(previousMarker === 'persisted') localStorage.removeItem('kestrel.desktop.spike');
      else localStorage.setItem('kestrel.desktop.spike','persisted');
      return {available:true,write,roundTrip:read.save?.meta.playerName === 'spike',remove,
        persistedAcrossLaunch:previousMarker === 'persisted'};
    } catch (error) { return {error:error.message}; }
  })()`);
  fs.mkdirSync(path.dirname(output), { recursive:true });
  const image = await window.webContents.capturePage();
  fs.writeFileSync(output.replace(/\.json$/, '') + '.png', image.toPNG());
  // Diagnostic only: inspect the scene behind the notice using the public grid API.
  // The normal launcher deliberately keeps the game's notice and startup grid untouched.
  const gridRequest = await evaluate(`window.__debug?.engine.setGrid(400,150)`);
  await pause(500);
  const scene = await evaluate(`(() => {
    const d = window.__debug;
    document.getElementById('file-protocol-notice')?.remove();
    return {gridRequest:${JSON.stringify(gridRequest)},grid:d?.rt ? [d.rt.cols,d.rt.rows] : null};
  })()`);
  await pause(1500);
  scene.gpuActive = await evaluate('window.__debug?.rt.gpuActive || false');
  fs.writeFileSync(output.replace(/\.json$/, '') + '-scene.png', (await window.webContents.capturePage()).toPNG());
  fs.writeFileSync(output, JSON.stringify({ versions:process.versions, platform:process.platform,
    profile:app.getPath('userData'), gpu:await app.getGPUInfo('complete'), page, storage, scene, messages }, null, 2) + '\n');
  console.log(`desktop probe: ${output}`);
};
