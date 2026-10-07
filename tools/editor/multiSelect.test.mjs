import assert from 'node:assert/strict';
import { makeFrame } from '../../engine/index.js';
import { projectPoint } from './ray.js';
import { sameSelectionItem, selectionContains, replaceSelection, toggleSelection, renameSelection, canMultiSelect, selectionCandidates, boxSelection } from './multiSelect.js';

const a = { fileId:'level/tower', collection:'props', id:'crate', structId:'tower' };
const b = { ...a, id:'barrel' }, copy = { ...a, structId:'copy' };
const empty = replaceSelection();
assert.deepEqual(empty, { items:[], primary:-1 });
const single = replaceSelection(a), pair = toggleSelection(single,b);
assert.deepEqual(single, { items:[a], primary:0 });
assert.deepEqual(pair, { items:[a,b], primary:1 });
assert.equal(selectionContains(pair,{...a}), true);
assert.equal(sameSelectionItem(a,copy), false);
assert.deepEqual(toggleSelection(pair,b),single);
assert.deepEqual(toggleSelection(pair,a), { items:[b], primary:0 });
assert.deepEqual(toggleSelection(single,a),empty);
assert.deepEqual(toggleSelection(pair,copy), { items:[a,b,copy], primary:2 });
assert.deepEqual(replaceSelection(b), { items:[b], primary:0 });
const rename={fileId:a.fileId,collection:a.collection,renameFrom:'crate',renameTo:'cargo'};
const selectedCopies=toggleSelection(pair,copy), renamed=renameSelection(selectedCopies,rename);
assert.deepEqual(renamed.items.map(it=>it.id),['cargo','barrel','cargo']);
assert.equal(renamed.primary,selectedCopies.primary);
assert.deepEqual(renameSelection(renamed,{...rename,renameFrom:'cargo',renameTo:'crate'}),selectedCopies);
assert.deepEqual(renameSelection(pair,rename).items.map(it=>it.id),['cargo','barrel'],'secondary member follows rename too');
assert.equal(renameSelection(pair,{}),pair);
assert.equal(pair.items[0].id,'crate','previous selection state not mutated');
assert.equal(canMultiSelect(a,{}),true);
assert.equal(canMultiSelect({...a,collection:'lights'},{}),true);
assert.equal(canMultiSelect({...a,collection:'entities'},{type:'prop'}),true);
for (const collection of ['structures','triggers','interactables','entities']) {
  assert.equal(canMultiSelect({...a,collection},{}),false);
}

const view = { cam:{x:0,y:0,z:1,yawDeg:0,pitchDeg:0},cols:400,rows:150,pxCellW:1,pxCellH:2,renderer:'mesh' };
const middle = {x:0,y:-5,z:1}, outside = {x:4,y:-5,z:1}, behind = {x:0,y:5,z:1};
const candidates = [{item:a,point:middle},{item:b,point:outside},{item:copy,point:behind}];
const p=projectPoint(view.cam,view.cols,view.rows,view.pxCellW,view.pxCellH,middle,'mesh');
const rect={startCol:p.col-2,startRow:p.row-2,col:p.col+2,row:p.row+2};
assert.deepEqual(boxSelection(candidates,rect,view),single);
assert.deepEqual(boxSelection(candidates,{startCol:rect.col,startRow:rect.row,col:rect.startCol,row:rect.startRow},view),single);
assert.deepEqual(boxSelection(candidates,rect,view,replaceSelection(b)),{items:[b,a],primary:1});
assert.deepEqual(boxSelection(candidates,rect,view,single),single);
assert.deepEqual(boxSelection(candidates,{startCol:0,startRow:0,col:0,row:0},view),empty);

// Exact edge is included; behind-camera and off-viewport pivots are excluded.
assert.deepEqual(boxSelection(candidates,{startCol:p.col,startRow:p.row,col:p.col,row:p.row},view),single);
assert.deepEqual(boxSelection([{item:a,point:{x:50,y:-1,z:1}}],{startCol:-100000,startRow:-100000,col:100000,row:100000},view),empty);

const level = { props:[{id:'crate',x:1,y:2,z:3}], lights:[{id:'lamp',x:2,y:1,z:4}], triggers:[{id:'skip'}] };
const worldDef = { entities:[{id:'rock',type:'prop',x:2,y:-5,z:0},{id:'player',type:'player',x:0,y:0,z:0}], structures:[{id:'mesh',mesh:'rock'}] };
const doc = { worldId:'m1', files:new Map([['level/tower',{def:level}],['level/unplaced',{def:level}],['world/m1',{def:worldDef}]]) };
const frames = { tower:makeFrame(10,20,1),copy:makeFrame(30,40,2,1) };
const world = {structures:[{id:'tower',level:{name:'tower'}},{id:'copy',level:{name:'tower'}},{id:'mesh',kind:'mesh'}],frameOf:id=>frames[id]};
const before = JSON.stringify([level,worldDef]);
const list = selectionCandidates(doc,world);
assert.equal(list.length,5);
assert.deepEqual(list[0],{item:a,point:{x:11,y:22,z:4}});
assert.equal(list[2].item.structId,'copy');
assert.deepEqual(list[2].point,{x:28,y:41,z:5});
assert.equal(list[4].item.id,'rock');
assert.equal(JSON.stringify([level,worldDef]),before);
const groundDoc={worldId:'m1',files:new Map([['level/tower',{def:{props:[{id:'ground',x:1,y:2,z:'ground'}]}}]])};
const groundWorld={...world,entity:id=>id==='tower.ground'?{transform:{x:11,y:22,z:7.5}}:null};
assert.deepEqual(selectionCandidates(groundDoc,groundWorld)[0].point,{x:11,y:22,z:7.5},'ground pivot uses resolved runtime height');
console.log('multiSelect: state, toggle/primary, pivot box, placement frames and exclusions PASS');
