import fs from 'fs';
const [,,fn,want,maxn='10',len='64']=process.argv;
const d=fs.readFileSync(fn); let p=0,k=0; const hist=new Map();
while(p+13<=d.length){
  const t=d.readUInt32LE(p), a=d.readUInt16LE(p+4), tag=d.toString('latin1',p+6,p+11), n=d.readUInt16LE(p+11);
  if(tag===want){ hist.set(n,(hist.get(n)||0)+1); if(k<+maxn) console.log(p,t,a,n,d.subarray(p+13,p+13+Math.min(n,+len)).toString('hex')); k++; }
  p+=13+n; p+=p&1;
}
console.log('sizes',[...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15));
