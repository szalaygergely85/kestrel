// ED-GROUP-1b: edit-time snapshots and existing command batches, no DOM.
import { rotateVec2, wrapDeg, worldToLocal, localYawToWorld, worldYawToLocal } from '../../engine/index.js';
import { frameFor, itemToWorld, selectionItemData, selectionItemIndex, mintId } from './doc.js';
import { canMultiSelect } from './multiSelect.js';
import { makeRecord, makeDeleteRecord, makeInsertRecord, findReferrers } from './commands.js';

export function groupSnapshot(doc, world, items) {
  if (!items.length) throw new Error('nothing selected');
  const seen = new Set();
  const members = items.map(item => {
    const before = selectionItemData(doc,item);
    if (!canMultiSelect(item,before) || !before) throw new Error('props and lights only');
    const key = JSON.stringify([item.fileId,item.collection,item.id]);
    if (seen.has(key)) throw new Error('two placements share the same content item; select one placement');
    seen.add(key);
    const frame = frameFor(world,item);
    const point = itemToWorld(frame,before.x,before.y,typeof before.z === 'number' ? before.z : 0);
    const entId = item.structId ? `${item.structId}.${item.id}` : item.id;
    const live = item.collection !== 'lights' && world.entity?.(entId)?.transform;
    if (live) point.z = live.z;
    if (![point.x,point.y,point.z].every(Number.isFinite)) throw new Error('invalid member position');
    return {item, before:structuredClone(before), frame, point, index:selectionItemIndex(doc,item), after:structuredClone(before)};
  });
  const pivot = {x:0,y:0,z:Infinity};
  for (const m of members) {pivot.x += m.point.x; pivot.y += m.point.y; pivot.z = Math.min(pivot.z,m.point.z);}
  pivot.x /= members.length; pivot.y /= members.length;
  return {members,pivot,vector:[0,0],local:{x:0,y:0,z:0}};
}

/** Reuses snapshot storage during a gesture; no accumulating drift or allocations. */
export function updateGroupTransform(snapshot, dx, dy, dz = 0, angle = 0) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz) || !Number.isFinite(angle)) throw new Error('invalid group transform');
  for (const m of snapshot.members) {
    if (dz && typeof m.before.z !== 'number') throw new Error('vertical move requires numeric z for every member');
  }
  const {pivot,vector,local} = snapshot;
  for (const m of snapshot.members) {
    rotateVec2(angle,m.point.x-pivot.x,m.point.y-pivot.y,vector);
    const x=pivot.x+vector[0]+dx, y=pivot.y+vector[1]+dy, z=m.point.z+dz;
    if (m.frame) worldToLocal(m.frame,x,y,z,local); else {local.x=x;local.y=y;local.z=z;}
    m.after.x=local.x; m.after.y=local.y;
    if (typeof m.before.z === 'number') m.after.z=local.z;
    if (m.item.collection !== 'lights') {
      const field = typeof m.before.facing === 'number' ? 'facing' : 'yawDeg';
      const yaw = typeof m.before[field] === 'number' ? m.before[field] : 0;
      // Leave an absent/default yaw absent for a translation-only gesture.
      if (angle || field in m.before) {
        const worldYaw=m.frame ? localYawToWorld(m.frame,yaw) : yaw;
        m.after[field]=m.frame ? worldYawToLocal(m.frame,worldYaw+angle) : wrapDeg(worldYaw+angle);
      } else delete m.after[field];
    }
  }
  return snapshot;
}

export function groupTransformRecord(snapshot, label='group move') {
  const batch = snapshot.members.filter(m=>JSON.stringify(m.before)!==JSON.stringify(m.after)).map(m=>
    makeRecord(label,m.item.fileId,m.item.collection,m.item.id,m.index,m.before,m.after));
  return batch.length ? {label,batch} : null;
}

function uniqueId(file, type) {
  const used = new Set(Object.values(file.def).filter(Array.isArray).flatMap(arr=>arr.flatMap(it=>[it?.id,it?.group])));
  let id; do {id=mintId(file,type);} while (used.has(id));
  return id;
}

export function groupFieldRecord(doc, snapshot, clear=false) {
  const fileIds=new Set(snapshot.members.map(m=>m.item.fileId));
  if (fileIds.size !== 1) throw new Error('groups must stay inside one file');
  const group=clear ? null : uniqueId(doc.files.get(snapshot.members[0].item.fileId),'group');
  const batch=[];
  for (const m of snapshot.members) {
    const after={...m.before};
    if (clear) delete after.group; else after.group=group;
    if (JSON.stringify(after)!==JSON.stringify(m.before)) batch.push(makeRecord(clear?'ungroup':'group',m.item.fileId,m.item.collection,m.item.id,m.index,m.before,after));
  }
  return batch.length ? {label:clear?'ungroup':'group',batch} : null;
}

export function groupedItems(doc, item) {
  const data=selectionItemData(doc,item);
  if (!data?.group) return [item];
  const file=doc.files.get(item.fileId), out=[];
  for (const collection of ['props','lights','entities']) for (const it of file.def[collection] || []) {
    const member={...item,collection,id:it.id};
    if (it.group===data.group && canMultiSelect(member,it)) out.push(member);
  }
  return out;
}

export function groupDeleteRecord(doc, snapshot) {
  for (const m of snapshot.members) {
    const file=doc.files.get(m.item.fileId);
    const refs=findReferrers(file.def,file.kind,m.item.collection,m.item.id);
    if (refs.length) throw new Error(`${m.item.id} referenced by ${refs.join(', ')}`);
  }
  // invert(batch) preserves order; ascending original indices restore array order exactly.
  const members=[...snapshot.members].sort((a,b)=>a.item.fileId.localeCompare(b.item.fileId)
    || a.item.collection.localeCompare(b.item.collection) || a.index-b.index);
  return {label:'group delete',batch:members.map(m=>makeDeleteRecord(m.item.fileId,m.item.collection,m.before,m.index))};
}

export function groupDuplicateRecord(doc, snapshot) {
  updateGroupTransform(snapshot,1,0);
  const groups=new Map(), items=[], batch=[];
  for (const m of snapshot.members) {
    const file=doc.files.get(m.item.fileId), after=structuredClone(m.after);
    after.id=uniqueId(file,m.item.collection==='lights' ? 'light' : 'prop');
    if (after.group) {
      const key=JSON.stringify([m.item.fileId,after.group]);
      if (!groups.has(key)) groups.set(key,uniqueId(file,'group'));
      after.group=groups.get(key);
    }
    items.push({...m.item,id:after.id});
    batch.push(makeInsertRecord(m.item.fileId,m.item.collection,after));
  }
  return {record:{label:'group duplicate',batch},selection:{items,primary:items.length-1}};
}
