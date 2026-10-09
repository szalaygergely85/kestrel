// Approval preview only: use existing assets and the editor's in-memory commands.
// No content registration, loot grants, save requests or new design assets.
export {};
const host=document.querySelector('#editor'),status=document.querySelector('#status');
const chest={id:'hillsideChest',model:'chestSmall',x:1471.25,y:1050.25,yawDeg:90,cover:'roadL207',loot:[{item:'shield',n:1},{item:'heart.piece',n:1}]};
const source=await (await fetch('../../content/worlds/world_m1.world.json')).json();
const rows=[{...chest,why:'Side-route chest behind existing rock roadL207; 1 shield + 1 heart.piece (heart ID needs confirmation)'}];
for(const id of ['boar1','boar2']) {
 const e=source.entities.find(e=>e.id===id);
 rows.push({id,x:e.x,y:e.y,why:'Keep existing home and quest ID on the waystone path'});
}
const tbody=document.querySelector('#anchors');
function row(item) {
 const tr=document.createElement('tr');
 for(const key of ['id','x','y','why']){const td=document.createElement('td');td.textContent=String(item[key]);tr.append(td);}
 tbody.append(tr);
}
for(const item of rows)row(item);
async function ready() {
 for(let i=0;i<600&&!host.contentWindow.__editor;i++)await new Promise(resolve=>setTimeout(resolve,100));
 if(!host.contentWindow.__editor)throw Error('Editor boot timed out');
 const e=host.contentWindow.__editor,w=host.contentWindow;
 const spawn={...e.world.get('player').data.transform};
 row({id:'initialSpawn',x:spawn.x,y:spawn.y,why:`Keep tower.start; feet z ${spawn.z}, yaw ${spawn.yawDeg}`});
 await new Promise((resolve,reject)=>{const s=w.document.createElement('script');s.src='../../design/models/chest.js';s.onload=resolve;s.onerror=reject;w.document.head.append(s);});
 if(!e.assets.has('model',chest.model))throw Error('Chest model not registered in editor assets');
 // This fixture loads an existing model after editor boot: refresh its public pool.
 e.frame.voxelPool.bind(e.assets,e.frame.fb.matTable);
 if(e.frame.gpuPipeline)e.frame.gpuPipeline.bindVoxels(e.frame.voxelPool);
 const originalEntityIds=e.doc.files.get('world/world_m1').def.entities.map(e=>e.id);
 e.placeAt('prop',{x:chest.x,y:chest.y},chest.model);
 if(!e.selection)throw Error('Chest placement refused');
 e.renameSelected(chest.id,()=>{});
 e.commitFieldEdit({yawDeg:chest.yawDeg,components:{voxel:{model:chest.model,anim:'closed',loop:true}}});
 e.rebuildNow();
 const placed=e.world.get(chest.id);if(!placed)throw Error('Preview chest missing after rebuild');
 const floor=e.world.floorAt(chest.x,chest.y);
 const cover=e.world.structures.find(s=>s.id===chest.cover);
 function pose(name) {
   let p;
   if(name==='chest')p={x:chest.x+1.5,y:chest.y,z:floor+1.6,yawDeg:270,pitchDeg:-40};
   else if(name==='road')p={x:1471.25,y:1032,z:e.world.floorAt(1471.25,1032)+1.6,yawDeg:180,pitchDeg:0};
   else if(name==='boars')p={x:1467,y:1032,z:e.world.floorAt(1467,1032)+1.6,yawDeg:260,pitchDeg:-5};
   else p={...spawn,z:spawn.z+1.6,pitchDeg:0};
   Object.assign(e.cam,p);e.frame.markDirty();status.textContent=name+' view - proposal only';
 }
 for(const button of document.querySelectorAll('[data-pose]'))button.addEventListener('click',()=>pose(button.dataset.pose));
 window.__anchorPreview={editor:e,chest,spawn,rows,floor,coverBBox:cover.bbox,originalEntityIds,pose};
 pose('chest');
}
ready().catch(error=>{status.textContent=error.message;throw error;});
