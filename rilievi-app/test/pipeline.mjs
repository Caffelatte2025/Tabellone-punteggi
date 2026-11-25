// Test end-to-end senza browser: lettura E57 -> registrazione automatica -> confronto col vero.
import { readFileSync } from 'node:fs';
import { readE57 } from '../src/io/e57.js';
import { buildTarget, icp } from '../src/reg/icp.js';
import { coarseSearch } from '../src/reg/coarse.js';

const dir = process.argv[2];
const truth = JSON.parse(readFileSync(`${dir}/truth.json`));
const load = async (n) => (await readE57(new Blob([readFileSync(`${dir}/${n}.e57`)]), { voxel: 0.05, maxRange: 40, minRange: 0.6 }))[0];
const T = (m, p) => [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];

const t0 = Date.now();
const scans = [];
for (const t of truth) { scans.push(await load(t.name)); console.log(t.name, 'letti', scans.at(-1).rawCount, 'lavoro', scans.at(-1).count, `${Date.now()-t0}ms`); }

// riferimento = stazione 1 (identita). Verita relativa: world = Rz(yaw)*local + pos
const rel = (k) => {
  const a = truth[0], b = truth[k];
  const ya = a.yaw*Math.PI/180, yb = b.yaw*Math.PI/180;
  const dyaw = yb - ya;
  const d = [b.x-a.x, b.y-a.y, b.z-a.z];
  const c = Math.cos(-ya), s = Math.sin(-ya);
  return { yaw: dyaw*180/Math.PI, t: [c*d[0]-s*d[1], s*d[0]+c*d[1], d[2]] };
};
const mats = [[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]];
for (let k = 1; k < scans.length; k++) {
  // riferimento = tutte le stazioni gia registrate
  let tot = 0; for (let j = 0; j < k; j++) tot += scans[j].count;
  const tp = new Float32Array(tot*3); let o = 0;
  for (let j = 0; j < k; j++) { const P = scans[j].positions; for (let i = 0; i < P.length; i += 3) { const q = T(mats[j], [P[i],P[i+1],P[i+2]]); tp[o++]=q[0]; tp[o++]=q[1]; tp[o++]=q[2]; } }
  const t1 = Date.now();
  const target = buildTarget(tp);
  const init = mats[k-1].slice();
  const c0 = coarseSearch(target, scans[k].positions, init, { sliceLow: -0.8, sliceHigh: 0.8 });
  const t2 = Date.now();
  const r = icp(target, scans[k].positions, c0, { voxel: 0.05, startDist: 1.0 });
  const m = r.matrix; mats.push(m);
  const tr = rel(k);
  const yaw = Math.atan2(m[1], m[0])*180/Math.PI;
  let dy = ((yaw - tr.yaw + 540) % 360) - 180;
  const dt = Math.hypot(m[12]-tr.t[0], m[13]-tr.t[1], m[14]-tr.t[2]);
  console.log(`st${k+1}: coarse ${t2-t1}ms icp ${Date.now()-t2}ms | errore rot ${dy.toFixed(3)}° pos ${(dt*1000).toFixed(1)}mm | rms ${(r.rms*1000).toFixed(1)}mm overlap ${(r.overlap*100).toFixed(0)}% iter ${r.iterations} conv ${r.converged}`);
  const cy = Math.atan2(c0[1], c0[0])*180/Math.PI;
  console.log(`   coarse: rot ${(((cy-tr.yaw+540)%360)-180).toFixed(2)}° pos ${(Math.hypot(c0[12]-tr.t[0], c0[13]-tr.t[1])*1000).toFixed(0)}mm`);
}
