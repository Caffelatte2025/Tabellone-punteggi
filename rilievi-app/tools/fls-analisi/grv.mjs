import fs from 'fs';
const d=fs.readFileSync(process.argv[2]); const R=+process.argv[3]; let p=0, rev=-1; const g=[];
while(p+13<=d.length){
  const tag=d.toString('latin1',p+7,p+10), n=d.readUInt16LE(p+11);
  if(tag==='MIF') rev++;
  if(rev===R && tag==='GRV') g.push(...d.subarray(p+13,p+13+n));
  if(rev>R) break;
  p+=13+n; p+=p&1;
}
console.log(g.length); let s=''; for(let i=0;i<g.length;i+=8) s+=g[i].toString(16).padStart(2,'0')+' '; console.log(s);
