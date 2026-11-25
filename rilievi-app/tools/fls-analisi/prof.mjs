import fs from 'fs';
const d=fs.readFileSync(process.argv[2]); let p=0; const B=+(process.argv[3]||2e6); let bins=[];
while(p+13<=d.length){
  const tag=d.toString('latin1',p+7,p+10), n=d.readUInt16LE(p+11); const b=Math.floor(p/B);
  bins[b]=bins[b]||{}; const o=bins[b]; o[tag]=(o[tag]||0)+1; if(tag=='CSE'){o.cseB=(o.cseB||0)+n}
  p+=13+n; p+=p&1;
}
bins.forEach((o,i)=>{ if(!o) return; const s=Object.entries(o).filter(([k,v])=>['CSE','GRV','MIF','IND','ENP','COO','cseB','NES'].includes(k)).map(([k,v])=>k+'='+v).join(' '); console.log((i*B/1e6).toFixed(0)+'MB',s)});
