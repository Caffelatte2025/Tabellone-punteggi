import {readVar} from './proc.mjs';
const v=readVar(process.argv[2]); const R=2135, C=2580;
const uz=x=>(x&1)?-(x+1)/2:x/2; const q=(a,f)=>a[Math.floor(a.length*f)];
const med=(u,l,ul)=>{ const mx=Math.max(u,l), mn=Math.min(u,l); return ul>=mx?mn:ul<=mn?mx:u+l-ul; };
export function decode(T, absMode='x'){ const D=new Float64Array(R*C);
 for(let c=0;c<C;c++) for(let r=0;r<R;r++){ const i=c*R+r, x=v[i];
  if(x>=T){D[i]= absMode==='x'?x:x-T; continue}
  const u=r>0?D[i-1]:0, l=c>0?D[i-R]:0, ul=(r>0&&c>0)?D[i-R-1]:0;
  const p = (r>0&&c>0)?med(u,l,ul): r>0?u: c>0?l:0; D[i]=p+uz(x); }
 return D; }
function score(D){ let neg=0; for(const d of D) if(d<0) neg++; const dv=[],dh=[]; for(let c=1;c<C;c+=3) for(let r=1;r<R;r+=3){const a=D[c*R+r], b=D[c*R+r-1], d=D[(c-1)*R+r]; dv.push(Math.abs(a-b)); dh.push(Math.abs(a-d))}
 dv.sort((a,b)=>a-b); dh.sort((a,b)=>a-b); return `neg ${neg} vert ${q(dv,.5)} ${q(dv,.9)} ${q(dv,.99)} horiz ${q(dh,.5)} ${q(dh,.9)} ${q(dh,.99)}`; }
if(process.argv[3]==='scan') for(const T of [65536,100000,131072,150000,200000,262144,300000]) for(const m of ['x','sub']) console.log(T,m,score(decode(T,m)));
