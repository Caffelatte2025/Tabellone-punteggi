import fs from 'fs';
export function readVar(f){ const b=fs.readFileSync(f); const s=b.indexOf('{ ')+2; const vals=new Uint32Array(5508300); let n=0,v=0,sh=0;
for(let i=s;i<b.length&&n<vals.length;i++){ const x=b[i]; v+= (x&0x7f)*2**sh; sh+=7; if(!(x&0x80)){ vals[n++]=v; v=0; sh=0;} } return vals; }
