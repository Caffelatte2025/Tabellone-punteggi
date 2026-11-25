import fs from 'fs';
const d=fs.readFileSync(process.argv[2]); let p=0; const cnt=new Map(); const order=[];
while(p+13<=d.length){
  const t=d.readUInt32LE(p), a=d.readUInt16LE(p+4), tag=d.toString('latin1',p+6,p+11);
  if(tag[0]!='$'||tag[4]!='$'){console.log('desync',p,d.subarray(p,p+32).toString('hex'));break;}
  const n=d.readUInt16LE(p+11);
  const k=tag+' a='+a; const c=cnt.get(k)||{n:0,min:1e9,max:0,bytes:0}; c.n++;c.min=Math.min(c.min,n);c.max=Math.max(c.max,n);c.bytes+=n;cnt.set(k,c);
  if(order.length<+(process.argv[3]||40)) order.push([p,t,a,tag,n]);
  p+=13+n; p+=p&1;
}
console.log('end',p,d.length); console.log(cnt); for(const o of order) console.log(o.join(' '));
