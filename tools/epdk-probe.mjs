// Diagnostic: summarise the live EPDK / MolaVolt API response shape (keys, socket fields, availability values).
import fs from 'fs';
const file=process.argv[2];
const raw=fs.readFileSync(file,'utf8');
console.log('bytes',raw.length,'head',JSON.stringify(raw.slice(0,300)));
let j;try{j=JSON.parse(raw)}catch(e){console.log('NOT JSON');process.exit(0)}
const parse=v=>{if(typeof v!=='string')return v;try{return JSON.parse(v)}catch{return v}};
j=parse(j);
console.log('top keys',Array.isArray(j)?'array':Object.keys(j));
const rows=Array.isArray(j)?j:(Array.isArray(parse(j.result))?parse(j.result):(j.result&&j.result.rows)||j.data||[]);
console.log('rows',rows.length,'columnNames',JSON.stringify(j.columnNames||null).slice(0,600));
const keyStats=new Map(),valStats=new Map();
function walk(o,path,depth){o=parse(o);if(depth>6||o==null)return;
  if(Array.isArray(o)){o.forEach(x=>walk(x,path+'[]',depth+1));return}
  if(typeof o!=='object')return;
  for(const [k,v] of Object.entries(o)){const p=path+'.'+k;keyStats.set(p,(keyStats.get(p)||0)+1);
    const pv=parse(v);
    if(pv&&typeof pv==='object')walk(pv,p,depth+1);
    else if(/durum|status|state|musait|müsait|available|dolu|occup|aktif|kullan|bos|boş|soket|socket|connector|evse/i.test(k)){
      const m=valStats.get(p)||new Map();const s=String(v).slice(0,60);m.set(s,(m.get(s)||0)+1);valStats.set(p,m)}
  }}
rows.forEach(r=>walk(r,'row',0));
console.log('--- field paths (count) ---');
[...keyStats].sort((a,b)=>b[1]-a[1]).slice(0,150).forEach(([k,c])=>console.log(c,k));
console.log('--- status-like field values ---');
for(const [k,m] of valStats){console.log(k,JSON.stringify([...m].sort((a,b)=>b[1]-a[1]).slice(0,25)))}
const withSock=rows.find(r=>{const x=parse(r);return x&&typeof x==='object'&&Object.keys(x).some(k=>/soket|socket/i.test(k))})||rows[0];
console.log('--- sample row ---');console.log(JSON.stringify(withSock,null,1).slice(0,4000));
