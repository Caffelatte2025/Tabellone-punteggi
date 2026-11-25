import fs from 'fs';
export function openCFB(fn){
  const fd=fs.openSync(fn,'r'); const size=fs.fstatSync(fd).size;
  const rd=(pos,len)=>{const b=Buffer.alloc(len); fs.readSync(fd,b,0,len,pos); return b;};
  const h=rd(0,512); const ss=1<<h.readUInt16LE(30), mss=1<<h.readUInt16LE(32);
  const nFat=h.readUInt32LE(44), dirStart=h.readUInt32LE(48), miniCut=h.readUInt32LE(56), miniFatStart=h.readUInt32LE(60), difStart=h.readUInt32LE(68);
  const sec=s=>rd((s+1)*ss,ss);
  let fatSecs=[]; for(let i=0;i<109;i++){const v=h.readUInt32LE(76+i*4); if(v<0xfffffffa) fatSecs.push(v)}
  let d=difStart; while(d<0xfffffffa){const b=sec(d); for(let i=0;i<ss/4-1;i++){const v=b.readUInt32LE(i*4); if(v<0xfffffffa) fatSecs.push(v)} d=b.readUInt32LE(ss-4)}
  const fat=new Uint32Array(fatSecs.length*ss/4); fatSecs.forEach((s,i)=>{const b=sec(s); for(let j=0;j<ss/4;j++) fat[i*ss/4+j]=b.readUInt32LE(j*4)});
  const chain=s=>{const r=[]; while(s<0xfffffffa){r.push(s); s=fat[s]} return r};
  const readChain=(s,len)=>{const c=chain(s); const b=Buffer.alloc(c.length*ss); c.forEach((x,i)=>sec(x).copy(b,i*ss)); return len!=null?b.subarray(0,len):b};
  const dirb=readChain(dirStart); const ents=[];
  for(let i=0;i<dirb.length/128;i++){const e=dirb.subarray(i*128,i*128+128); const nl=e.readUInt16LE(64); ents.push({name:e.toString('utf16le',0,Math.max(0,nl-2)),type:e[66],left:e.readUInt32LE(68),right:e.readUInt32LE(72),child:e.readUInt32LE(76),start:e.readUInt32LE(116),size:Number(e.readBigUInt64LE(120))})}
  const root=ents[0]; const miniStream=root.start<0xfffffffa?{start:root.start}:null;
  const miniFat=miniFatStart<0xfffffffa?new Uint32Array(readChain(miniFatStart).buffer.slice(0)):null;
  let ministr=null;
  const read=(e)=>{ if(e.size<miniCut){ ministr=ministr||readChain(root.start,root.size); const r=Buffer.alloc(e.size); let s=e.start,o=0; while(s<0xfffffffa&&o<e.size){ ministr.copy(r,o,s*mss,s*mss+mss); o+=mss; s=miniFat[s]} return r} return readChain(e.start,e.size)};
  // paths
  const paths=[]; const walk=(i,pre)=>{ if(i>=0xfffffffa||i>=ents.length) return; const e=ents[i]; walk(e.left,pre); const p=pre+'/'+e.name; e.path=p; paths.push(e); if(e.type===1) walk(e.child,p); walk(e.right,pre)};
  walk(root.child,'');
  return {entries:paths, read, chain, ss, fat, sec, rd, size};
}
if(process.argv[2]){ const c=openCFB(process.argv[2]); for(const e of c.entries) console.log(e.type, e.size, e.path) }
