import fs from 'fs'; import {decode} from './pred5.mjs';
const R=2135, C=2580;
const mi=fs.readFileSync('D:/Scans/add_000.fls/Scans/1/MirrorIndex0.hls'); const s0=mi.indexOf('{')+2; const el=new Float64Array(R); for(let r=0;r<R;r++) el[r]=mi.readDoubleLE(s0+r*16+8);
export function xyz(D,scale){ const P=new Float32Array(R*C*3); for(let c=0;c<C;c++){ const az=c*2*Math.PI/5160; const ca=Math.cos(az), sa=Math.sin(az); for(let r=0;r<R;r++){ const d=D[c*R+r]*scale, ce=Math.cos(el[r]); const i=(c*R+r)*3; P[i]=d*ce*ca; P[i+1]=d*ce*sa; P[i+2]=d*Math.sin(el[r]); }} return P; }
export {el};
function sec(P){ const a=[]; const g=(c,r)=>(c*R+r)*3; for(let c=2;c<C-2;c+=5) for(let r=2;r<R-2;r+=5){ for(const [dc,dr] of [[0,1],[1,0]]){ const i=g(c-dc,r-dr), j=g(c,r), k=g(c+dc,r+dr); const e=Math.hypot(P[i]-2*P[j]+P[k],P[i+1]-2*P[j+1]+P[k+1],P[i+2]-2*P[j+2]+P[k+2]); const n=Math.hypot(P[j],P[j+1],P[j+2]); if(n>0) a.push(e/n);} } a.sort((x,y)=>x-y); return [a[a.length>>1],a[Math.floor(a.length*.75)]].map(x=>x.toExponential(3)).join(' '); }
if(process.argv[3]==='scan') for(const T of [65536,100000,131072,200000,262144]) console.log(T, sec(xyz(decode(T),1e-5)));
