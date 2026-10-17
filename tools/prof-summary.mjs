import fs from 'node:fs';
const f=process.argv[2];const p=JSON.parse(fs.readFileSync(f));const self=new Map();
const dt=p.timeDeltas;const idx=new Map(p.nodes.map(n=>[n.id,n]));
for(let i=0;i<p.samples.length;i++){const n=idx.get(p.samples[i]);const cf=n.callFrame;const k=cf.functionName+' '+cf.url.split('/').slice(-3).join('/')+':'+cf.lineNumber;self.set(k,(self.get(k)||0)+dt[i]);}
const tot=[...self.values()].reduce((a,b)=>a+b,0);
[...self.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([k,v])=>console.log((v/1000).toFixed(0).padStart(6)+'ms '+(100*v/tot).toFixed(1)+'% '+k));
