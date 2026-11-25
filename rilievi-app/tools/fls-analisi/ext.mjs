import {openCFB} from './cfb.mjs'; import fs from 'fs';
const c=openCFB(process.argv[2]); fs.mkdirSync(process.argv[3],{recursive:true});
for(const e of c.entries) if(e.type===2 && !e.path.startsWith('/Pictures')) fs.writeFileSync(process.argv[3]+'/'+e.path.replace(/\//g,'_'), c.read(e));
