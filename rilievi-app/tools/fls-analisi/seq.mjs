import fs from 'fs';
const [,,fn,from='0',count='80']=process.argv;
const d=fs.readFileSync(fn); let p=0,k=0;
while(p+13<=d.length){
  const t=d.readUInt32LE(p), a=d.readUInt16LE(p+4), tag=d.toString('latin1',p+6,p+11), n=d.readUInt16LE(p+11);
  if(p>=+from && k<+count){ console.log(p,t,a,tag,n, d.subarray(p+13,p+13+Math.min(n,24)).toString('hex')); k++; }
  p+=13+n; p+=p&1;
}
