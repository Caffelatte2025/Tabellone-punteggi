import {decode} from './pred5.mjs'; import fs from 'fs';
const R=2135; const D=decode(131072); const c=+process.argv[3];
const out=[]; for(let r=0;r<R;r++) out.push(Math.round(D[c*R+r])); fs.writeFileSync('col'+c+'.json',JSON.stringify(out));
console.log('col',c, [0,50,100,200,400,800,1200,1600,2000,2100,2134].map(r=>r+':'+out[r]).join(' '));
