import {decode} from './pred5.mjs'; import {xyz} from './geo.mjs'; import {writePNG} from './png.mjs';
const R=2135,C=2580; const D=decode(131072); const P=xyz(D,1e-5);
// depth image downsample 3
const w=Math.floor(C/3), h=Math.floor(R/3); const img=new Uint8Array(w*h*3);
for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const d=D[(x*3)*R+y*3]*1e-5; const t=Math.min(1,Math.log1p(d)/Math.log1p(60)); const i=(y*w+x)*3; img[i]=255*t; img[i+1]=255*(1-Math.abs(t-.5)*2); img[i+2]=255*(1-t);} 
writePNG('depth.png',w,h,img);
// plan view z in [-1.0,1.0]?, extent +-30 units
const S=800, ext=+process.argv[4]||30; const pl=new Uint8Array(S*S*3); const zs=[];
for(let i=0;i<R*C;i++){ const x=P[i*3],y=P[i*3+1],z=P[i*3+2]; if(i%50===0) zs.push(z); const u=Math.floor((x/ext+1)/2*S), v=Math.floor((1-(y/ext+1)/2)*S); if(u<0||v<0||u>=S||v>=S) continue; const k=(v*S+u)*3; pl[k]=Math.min(255,pl[k]+40); pl[k+1]=Math.min(255,pl[k+1]+20); pl[k+2]=Math.min(255,pl[k+2]+10);} 
writePNG('plan.png',S,S,pl); zs.sort((a,b)=>a-b); console.log('z quantiles',[.01,.1,.25,.5,.75,.9,.99].map(f=>zs[Math.floor(zs.length*f)].toFixed(2)).join(' '));
const ds=[]; for(let i=0;i<D.length;i+=97) ds.push(D[i]*1e-5); ds.sort((a,b)=>a-b); console.log('dist quantiles (1e-5 units)',[.01,.1,.5,.9,.99].map(f=>ds[Math.floor(ds.length*f)].toFixed(2)).join(' '));
