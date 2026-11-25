// Test end-to-end su cartelle FARO .fls grezze: lettura -> registrazione automatica tra stazioni consecutive.
// Uso: node test/fls.mjs D:/Scans/add_000.fls D:/Scans/add_001.fls [...]   (opzione --level=-1 per invertire il livellamento)
import { openAsBlob, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readFls } from '../src/io/fls.js';
import { buildTarget, icp } from '../src/reg/icp.js';
import { coarseSearch } from '../src/reg/coarse.js';

const args = process.argv.slice(2);
const levelSign = +(args.find((a) => a.startsWith('--level='))?.split('=')[1] ?? -1);
const dirs = args.filter((a) => !a.startsWith('--'));

async function entriesOf(dir) {
  const out = [];
  const walk = async (d, rel) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n), r = rel ? `${rel}/${n}` : n;
      if (statSync(p).isDirectory()) { if (n !== 'Previews') await walk(p, r); }
      else if (/^(Main|ScanDataStream\d+|MirrorIndex[01]\.hls)$/.test(n)) out.push({ path: r, file: await openAsBlob(p) });
    }
  };
  const base = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  await walk(dir, base);
  return out;
}

const T = (m, p) => [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
const scans = [];
for (const d of dirs) {
  const t0 = Date.now();
  const [s] = await readFls(await entriesOf(d), { voxel: 0.05, maxRange: 40, minRange: 0.6, levelSign });
  const P = s.positions; let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], P[i + a]); mx[a] = Math.max(mx[a], P[i + a]); }
  console.log(`${s.name}: letti ${s.rawCount} punti, ${s.count} di lavoro, ${Date.now() - t0} ms | box x ${mn[0].toFixed(1)}..${mx[0].toFixed(1)} y ${mn[1].toFixed(1)}..${mx[1].toFixed(1)} z ${mn[2].toFixed(1)}..${mx[2].toFixed(1)} | GPS ${s.info.gps ? s.info.gps.lat.toFixed(6) + ',' + s.info.gps.lon.toFixed(6) : '-'} incl ${(s.info.tilt * 180 / Math.PI).toFixed(2)}°`);
  scans.push(s);
}
const mats = [[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]];
for (let k = 1; k < scans.length; k++) {
  let tot = 0; for (let j = 0; j < k; j++) tot += scans[j].count;
  const tp = new Float32Array(tot * 3); let o = 0;
  for (let j = 0; j < k; j++) { const P = scans[j].positions; for (let i = 0; i < P.length; i += 3) { const q = T(mats[j], [P[i], P[i+1], P[i+2]]); tp[o++] = q[0]; tp[o++] = q[1]; tp[o++] = q[2]; } }
  const t1 = Date.now();
  const target = buildTarget(tp);
  const c0 = coarseSearch(target, scans[k].positions, mats[k - 1].slice(), { sliceLow: -0.8, sliceHigh: 0.8 });
  const t2 = Date.now();
  const r = icp(target, scans[k].positions, c0, { voxel: 0.05, startDist: 1.0, maxIter: +(process.env.ITER||60) });
  mats.push(r.matrix);
  const m = r.matrix, yaw = Math.atan2(m[1], m[0]) * 180 / Math.PI;
  console.log(`${scans[k].name} -> precedenti: coarse ${t2 - t1} ms, icp ${Date.now() - t2} ms | rot ${yaw.toFixed(2)}° spost ${m[12].toFixed(2)}, ${m[13].toFixed(2)}, ${m[14].toFixed(2)} m | rms ${(r.rms * 1000).toFixed(1)} mm overlap ${(r.overlap * 100).toFixed(0)}% iter ${r.iterations} conv ${r.converged}`);
}

// pianta della nuvola unita (PNG), una tinta per stazione: node test/fls.mjs ... --png=pianta.png
const pngArg = args.find((a) => a.startsWith('--png='));
if (pngArg) {
  const { writePNG } = await import('../tools/fls-analisi/png.mjs');
  const S = 1000, pts = [];
  for (let k = 0; k < scans.length; k++) { const P = scans[k].positions; for (let i = 0; i < P.length; i += 3) { const q = T(mats[k], [P[i], P[i+1], P[i+2]]); if (q[2] > -0.6 && q[2] < 1.2) pts.push(q[0], q[1], k); } }
  let mn = [1e9, 1e9], mx = [-1e9, -1e9]; for (let i = 0; i < pts.length; i += 3) for (let a = 0; a < 2; a++) { mn[a] = Math.min(mn[a], pts[i+a]); mx[a] = Math.max(mx[a], pts[i+a]); }
  const sc = (S - 20) / Math.max(mx[0] - mn[0], mx[1] - mn[1]); const img = new Uint8Array(S * S * 3);
  const pal = [[255,80,80],[80,255,80],[80,140,255],[255,220,60],[255,80,255],[60,230,230],[255,150,40],[200,200,200]];
  for (let i = 0; i < pts.length; i += 3) { const u = Math.floor(10 + (pts[i] - mn[0]) * sc), v = Math.floor(S - 10 - (pts[i+1] - mn[1]) * sc); const o = (v * S + u) * 3, c = pal[pts[i+2] % pal.length]; img[o] = c[0]; img[o+1] = c[1]; img[o+2] = c[2]; }
  writePNG(pngArg.split('=')[1], S, S, img);
  console.log('pianta salvata', pngArg.split('=')[1], `(${(mx[0]-mn[0]).toFixed(1)} x ${(mx[1]-mn[1]).toFixed(1)} m)`);
}
