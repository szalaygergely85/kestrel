#!/usr/bin/env node
// US-112a: tracked dependency closure, licence gate, deterministic store-only ZIP.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
// Optional devDependency: importing the tool must also work in a plain game checkout.
let ts = null;
try { ts = (await import('typescript')).default; }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
export const parserAvailable = ts !== null;

const VERIFIED = new Set(['project-content','project-design','project-marketing','quaternius','kenney']);
const ROOTS = ['game/','engine/','design/','content/'];
const excluded = file => /(?:^|\/)(?:local|source|reference|preview|test|tests)\//.test(file) || /\.test\.(?:m?js)$/.test(file)
  || file.endsWith('.html') && file !== 'game/index.html';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function resolveRef(from, ref, documentBase = false) {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(ref)) return null;
  ref = ref.split(/[?#]/)[0];
  if (!ref) return null;
  const target = path.posix.normalize(ref.startsWith('/') ? ref.slice(1) : path.posix.join(path.posix.dirname(documentBase ? 'game/index.html' : from),ref));
  if (target === '..' || target.startsWith('../')) throw new Error(`demo: reference outside repo: ${from} -> ${ref}`);
  return target;
}

function references(file, text, errors) {
  const out=[];
  const scan=(regex,documentBase=false)=>{for(const m of text.matchAll(regex)){const ref=resolveRef(file,m[1],documentBase);if(ref)out.push(ref);}};
  if (file.endsWith('.html')) { text=text.replace(/<!--[\s\S]*?-->/g,'');scan(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g); }
  if (/\.m?js$/.test(file)) {
    const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const isLiteral=node=>node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
    const add=(literal,documentBase=false)=>{if(isLiteral(literal)){const ref=resolveRef(file,literal.text,documentBase);if(ref)out.push(ref);}};
    function visit(node) {
      if(ts.isImportDeclaration(node) || ts.isExportDeclaration(node))add(node.moduleSpecifier);
      if(ts.isCallExpression(node)) {
        if(node.expression.kind===ts.SyntaxKind.ImportKeyword) {
          if(!isLiteral(node.arguments[0]))errors.push(`computed import needs a release dependency list: ${file}`);
          else add(node.arguments[0]);
        }
        if(['fetch','loadContentPack'].includes(node.expression.getText(source)))add(node.arguments[0],true);
      }
      if(ts.isNewExpression(node) && node.expression.getText(source)==='URL' && node.arguments?.[1]?.getText(source)==='import.meta.url')add(node.arguments[0]);
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  if (file.endsWith('.css')) scan(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g);
  if (file.endsWith('.json')) {
    const data=JSON.parse(text);
    if (Array.isArray(data.files)) for(const ref of data.files)out.push(resolveRef(file,ref));
  }
  return [...new Set(out)];
}

/** No filesystem mutation. Unknown/unverified asset inputs refuse the whole plan. */
export function planDemo({root,inventory,trackedFiles,entries=['game/index.html','THIRD_PARTY_NOTICES.md','docs/licences.md']}) {
  if (!parserAvailable) throw new Error('demo: TypeScript parser unavailable; run npm i first at the repository root');
  root=fs.realpathSync(root);
  const tracked=new Set(trackedFiles),groups=new Map(inventory.files.map(row=>[row.path,row.group]));
  const pending=[...entries],seen=new Set(),files=[],errors=[];
  while(pending.length) {
    const file=pending.shift();if(seen.has(file))continue;seen.add(file);
    // Local overlay is optional by contract and deliberately absent from a release.
    if (file.startsWith('content/local/')) continue;
    if (!ROOTS.some(prefix=>file.startsWith(prefix)) && !entries.includes(file)) {errors.push(`outside runtime roots: ${file}`);continue;}
    if (excluded(file)) {errors.push(`excluded dependency: ${file}`);continue;}
    if (!tracked.has(file)) {errors.push(`missing or untracked dependency: ${file}`);continue;}
    const absolute=path.resolve(root,file),relative=path.relative(root,absolute);
    if(relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(absolute) || fs.lstatSync(absolute).isSymbolicLink()) {errors.push(`unsafe or missing file: ${file}`);continue;}
    const actual=fs.realpathSync(absolute),realRelative=path.relative(root,actual);
    if(realRelative.startsWith('..') || path.isAbsolute(realRelative)) {errors.push(`source escapes repo: ${file}`);continue;}
    const group=groups.get(file);
    const isAsset=file.startsWith('design/models/') || file.startsWith('design/meshes/') || file.startsWith('design/vox') || file.startsWith('content/meshes/') || file.startsWith('content/vox/');
    if(group && !VERIFIED.has(group) || !group && isAsset) {errors.push(`unverified licence: ${file} (${group || 'not inventoried'})`);continue;}
    const bytes=fs.readFileSync(actual);
    files.push({path:file,bytes,sha256:sha(bytes),group:group || 'project-runtime'});
    if (/\.(?:m?js|html|css|json)$/.test(file)) pending.push(...references(file,bytes.toString('utf8'),errors));
  }
  files.sort((a,b)=>a.path<b.path ? -1 : a.path>b.path ? 1 : 0);
  if(errors.length)throw new Error(`demo plan refused:\n${errors.sort().join('\n')}`);
  return files;
}

function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes) {crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}

/** ZIP method 0, UTF-8 names, fixed DOS date 1980-01-01: identical bytes on every build. */
export function zipFiles(files) {
  const local=[],central=[];let offset=0;
  if(files.length>65535)throw new Error('demo: ZIP64 not supported');
  for(const file of files) {
    const name=Buffer.from(file.path,'utf8'),bytes=Buffer.from(file.bytes),crc=crc32(bytes);
    if(name.length>65535 || bytes.length>0xffffffff || offset+bytes.length+name.length+30>0xffffffff)throw new Error('demo: ZIP64 not supported');
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);
    header.writeUInt32LE(crc,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26);
    local.push(header,name,bytes);
    const cd=Buffer.alloc(46);cd.writeUInt32LE(0x02014b50);cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);cd.writeUInt16LE(0x800,8);cd.writeUInt16LE(33,14);
    cd.writeUInt32LE(crc,16);cd.writeUInt32LE(bytes.length,20);cd.writeUInt32LE(bytes.length,24);cd.writeUInt16LE(name.length,28);cd.writeUInt32LE(offset,42);
    central.push(cd,name);offset+=header.length+name.length+bytes.length;
  }
  const cdb=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);
  end.writeUInt32LE(cdb.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,cdb,end]);
}

export function buildDemo(root,{check=false}={}) {
  const inventory=JSON.parse(fs.readFileSync(path.join(root,'docs/licence-inventory.json'),'utf8'));
  const trackedFiles=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  const files=planDemo({root,inventory,trackedFiles});
  const launch=Buffer.from('<!doctype html><meta charset="utf-8"><title>Kestrel</title><script>const p=new URLSearchParams(location.search);p.set("backend","webgpu");location.replace("game/index.html?"+p+location.hash);</script>\n');
  const runtime=[{path:'index.html',bytes:launch,sha256:sha(launch),group:'project-runtime'},...files];
  const manifest={version:1,files:runtime.map(({path,sha256,group})=>({path,sha256,group}))};
  const packaged=[...runtime,{path:'demo-manifest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n')}];
  if(check)return manifest;
  // Plan finishes before any output mutation. Refuse to overwrite a different existing bundle.
  const out=path.resolve(root,'dist/demo');
  if(fs.existsSync(out))throw new Error('demo: dist/demo exists; choose a clean build checkout');
  fs.mkdirSync(out,{recursive:true});
  for(const file of packaged){const target=path.join(out,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file.bytes);}
  fs.writeFileSync(path.resolve(root,'dist/demo.zip'),zipFiles(packaged));
  return manifest;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
  try {const result=buildDemo(root,{check:process.argv.includes('--check')});console.log(`demo ${process.argv.includes('--check')?'check':'build'} OK: ${result.files.length} files`);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
