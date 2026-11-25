import fs from 'fs';
// extract CSE payloads concatenated per revolution (split at MIF)
const d=fs.readFileSync(process.argv[2]); let p=0; const revs=[]; let cur=[];
while(p+13<=d.length){
  const tag=d.toString('latin1',p+7,p+10), n=d.readUInt16LE(p+11);
  if(tag==='MIF'){ revs.push(Buffer.concat(cur)); cur=[]; }
  if(tag==='CSE') cur.push(d.subarray(p+13,p+13+n));
  p+=13+n; p+=p&1;
}
revs.push(Buffer.concat(cur));
fs.mkdirSync('revs',{recursive:true});
revs.forEach((b,i)=>{ if(i<40||i%500==0) fs.writeFileSync(`revs/r${i}.bin`,b)});
console.log(revs.length, revs.slice(0,8).map(b=>b.length), revs.slice(1000,1005).map(b=>b.length));
const h=new Array(256).fill(0); for(const b of revs.slice(100,200)) for(const x of b) h[x]++;
console.log(h.map((v,i)=>i.toString(16)+':'+v).join(' '));
