import assert from 'node:assert/strict';
import { renderMeshPanel } from './meshPanel.js';

// DOM boundary fixture: dispatch the actual rendered inputs' blur/change callbacks.
class Element {
  children = []; dataset = {}; listeners = {}; value = ''; checked = false; textContent = '';
  appendChild(child) { this.children.push(child); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  dispatch(type) { this.listeners[type](); }
}
const previous = globalThis.document;
globalThis.document = { createElement: () => new Element() };
try {
  const root = new Element(), calls = [];
  const item = { id:'mesh_7', mesh:'quaternius/Rock_Medium_1', origin:{x:1.25,y:2.5,z:0.15}, yawDeg:45 };
  renderMeshPanel(root,item,{
    assets:{mesh:()=>({castShadow:false})},
    onFieldCommit: patch => { calls.push(patch); return Number.isNaN(patch.origin?.x) ? ['origin.x: must be finite'] : []; },
    onRename: (id,setError) => { calls.push({id}); if (/_\d+$/.test(id)) setError('id: reserved suffix'); },
  });
  const inputs = root.children.flatMap(row=>row.children).filter(e=>e.dataset.meshField);
  const input = key => inputs.find(e=>e.dataset.meshField===key);
  const error = root.children.find(e=>e.className==='insp-error');
  // Browser inputs stringify assigned numeric values.
  for(const e of inputs) if(e.type!=='checkbox') e.value=String(e.value);
  for(const key of ['id','x','y','z','yawDeg']) input(key).dispatch('blur');
  for(const key of ['castShadow','collide']) input(key).dispatch('change');
  assert.deepEqual(calls,[], 'unchanged fields never commit or rename');
  assert.equal(error.textContent,'', 'existing minted id has no rename error');
  assert.equal(input('castShadow').checked,false,'absent placement override reflects mesh default');
  input('id').value='hand_12';input('id').dispatch('blur');
  assert.equal(error.textContent,'id: reserved suffix','changed reserved id still reports error');
  input('id').value='mesh_7';input('id').dispatch('blur');assert.equal(error.textContent,'');
  input('x').value='';input('x').dispatch('blur');assert.equal(error.textContent,'origin.x: must be finite');
  input('x').value='1.50';input('x').dispatch('blur');assert.deepEqual(calls.at(-1),{origin:{x:1.5,y:2.5,z:0.15}});
  input('yawDeg').value='90';input('yawDeg').dispatch('blur');assert.deepEqual(calls.at(-1),{yawDeg:90});
  input('castShadow').checked=true;input('castShadow').dispatch('change');assert.deepEqual(calls.at(-1),{castShadow:true});
  const disabledRoot=new Element();
  renderMeshPanel(disabledRoot,{...item,collide:true},{assets:{mesh:()=>({collide:false})},onFieldCommit:()=>{},onRename:()=>{}});
  const collision=disabledRoot.children.flatMap(row=>row.children).find(e=>e.dataset.meshField==='collide');
  assert.equal(collision.checked,false,'asset collision gate takes precedence over placement true');
  assert.equal(collision.disabled,true,'unsupported collision enable is unavailable');
  assert.deepEqual(item.origin,{x:1.25,y:2.5,z:0.15},'panel never mutates source placement');
  console.log('meshPanel: unchanged input no-ops, inherited defaults and changed-field validation PASS');
} finally { globalThis.document = previous; }
