// ICP punto-piano. Matrici 4x4 column-major (come three.js Matrix4.elements).
// Con `levelled` (default) si stima solo rotazione attorno a Z + traslazione:
// il Focus è livellato dal compensatore, quindi è il caso tipico e converge meglio.

import { KDTree } from './kdtree.js';

export function buildTarget(positions) {
  const tree = new KDTree(positions);
  return { tree, positions, normals: new Float32Array(positions.length), hasN: new Uint8Array(positions.length / 3) };
}

function normalAt(target, i, radius2) {
  if (target.hasN[i]) return target.hasN[i] === 1;
  const { tree, positions: P, normals: N } = target;
  const K = 12;
  const idx = (target._k ||= new Int32Array(K));
  const dd = (target._d ||= new Float64Array(K));
  const n = tree.knn(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], K, radius2, idx, dd);
  if (n < 5) { target.hasN[i] = 2; return false; }
  let mx = 0, my = 0, mz = 0;
  for (let k = 0; k < n; k++) { const p = idx[k] * 3; mx += P[p]; my += P[p + 1]; mz += P[p + 2]; }
  mx /= n; my /= n; mz /= n;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let k = 0; k < n; k++) {
    const p = idx[k] * 3;
    const dx = P[p] - mx, dy = P[p + 1] - my, dz = P[p + 2] - mz;
    xx += dx * dx; xy += dx * dy; xz += dx * dz; yy += dy * dy; yz += dy * dz; zz += dz * dz;
  }
  const { vec, vals } = smallestEigen([xx, xy, xz, xy, yy, yz, xz, yz, zz]);
  // scarta zone non planari (spigoli, vegetazione)
  const sum = vals[0] + vals[1] + vals[2];
  if (sum <= 0 || vals[0] / sum > 0.08) { target.hasN[i] = 2; return false; }
  N[i * 3] = vec[0]; N[i * 3 + 1] = vec[1]; N[i * 3 + 2] = vec[2];
  target.hasN[i] = 1;
  return true;
}

// Jacobi per matrice simmetrica 3x3: autovettore dell'autovalore minimo
function smallestEigen(a) {
  const A = a.slice();
  const V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 12; sweep++) {
    const off = A[1] * A[1] + A[2] * A[2] + A[5] * A[5];
    if (off < 1e-20) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = A[p * 3 + q];
      if (Math.abs(apq) < 1e-30) continue;
      const app = A[p * 3 + p], aqq = A[q * 3 + q];
      const theta = (aqq - app) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = A[k * 3 + p], akq = A[k * 3 + q];
        A[k * 3 + p] = c * akp - s * akq;
        A[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p * 3 + k], aqk = A[q * 3 + k];
        A[p * 3 + k] = c * apk - s * aqk;
        A[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k * 3 + p], vkq = V[k * 3 + q];
        V[k * 3 + p] = c * vkp - s * vkq;
        V[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  const ev = [A[0], A[4], A[8]];
  let m = 0;
  if (ev[1] < ev[m]) m = 1;
  if (ev[2] < ev[m]) m = 2;
  const vals = ev.slice().sort((x, y) => x - y);
  return { vec: [V[m], V[3 + m], V[6 + m]], vals };
}

function solve(A, b, n) {
  // eliminazione di Gauss con pivot parziale; A n x n row-major
  const M = A.slice(), x = b.slice();
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[piv * n + c])) piv = r;
    if (Math.abs(M[piv * n + c]) < 1e-12) return null;
    if (piv !== c) {
      for (let k = 0; k < n; k++) { const t = M[c * n + k]; M[c * n + k] = M[piv * n + k]; M[piv * n + k] = t; }
      const t = x[c]; x[c] = x[piv]; x[piv] = t;
    }
    for (let r = c + 1; r < n; r++) {
      const f = M[r * n + c] / M[c * n + c];
      if (!f) continue;
      for (let k = c; k < n; k++) M[r * n + k] -= f * M[c * n + k];
      x[r] -= f * x[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let k = r + 1; k < n; k++) s -= M[r * n + k] * x[k];
    x[r] = s / M[r * n + r];
  }
  return x;
}

function rodrigues(wx, wy, wz) {
  const th = Math.hypot(wx, wy, wz);
  if (th < 1e-15) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const kx = wx / th, ky = wy / th, kz = wz / th;
  const c = Math.cos(th), s = Math.sin(th), v = 1 - c;
  return [
    c + kx * kx * v, kx * ky * v - kz * s, kx * kz * v + ky * s,
    ky * kx * v + kz * s, c + ky * ky * v, ky * kz * v - kx * s,
    kz * kx * v - ky * s, kz * ky * v + kx * s, c + kz * kz * v,
  ];
}

/**
 * @param target  risultato di buildTarget (coordinate di progetto)
 * @param src     Float32Array posizioni locali della stazione
 * @param init    matrice iniziale (column-major 16)
 */
export function icp(target, src, init, opts = {}, onIter) {
  const voxel = opts.voxel ?? 0.05;
  const levelled = opts.levelled ?? true;
  const startDist = opts.startDist ?? 1.0;
  const finalDist = Math.max(opts.finalDist ?? 0, voxel * 2, 0.05);
  const maxIter = opts.maxIter ?? 60;
  const nSamples = Math.min(opts.samples ?? 40000, src.length / 3);
  const normR2 = (voxel * 5) ** 2;

  // campionamento uniforme della stazione da registrare
  const total = src.length / 3;
  const step = total / nSamples;
  const S = new Float32Array(nSamples * 3);
  for (let i = 0; i < nSamples; i++) {
    const j = Math.floor(i * step) * 3;
    S[i * 3] = src[j]; S[i * 3 + 1] = src[j + 1]; S[i * 3 + 2] = src[j + 2];
  }

  // R (row-major 3x3) e t da matrice column-major
  let R = [init[0], init[4], init[8], init[1], init[5], init[9], init[2], init[6], init[10]];
  let t = [init[12], init[13], init[14]];
  if (levelled) {
    // forza la matrice ad essere una pura rotazione attorno a Z
    const yaw = Math.atan2(R[3], R[0]);
    R = [Math.cos(yaw), -Math.sin(yaw), 0, Math.sin(yaw), Math.cos(yaw), 0, 0, 0, 1];
  }

  const nU = levelled ? 4 : 6;
  let dist = startDist;
  let rms = Infinity, inliers = 0;
  const P = target.positions, N = target.normals;
  let iter = 0;
  let converged = false;

  for (; iter < maxIter; iter++) {
    const A = new Float64Array(nU * nU), b = new Float64Array(nU);
    const J = new Float64Array(nU);
    let sr2 = 0, cnt = 0;
    const d2 = dist * dist;
    for (let i = 0; i < nSamples; i++) {
      const lx = S[i * 3], ly = S[i * 3 + 1], lz = S[i * 3 + 2];
      const x = R[0] * lx + R[1] * ly + R[2] * lz + t[0];
      const y = R[3] * lx + R[4] * ly + R[5] * lz + t[1];
      const z = R[6] * lx + R[7] * ly + R[8] * lz + t[2];
      const q = target.tree.nearest(x, y, z, d2);
      if (q < 0) continue;
      if (!normalAt(target, q, normR2)) continue;
      const nx = N[q * 3], ny = N[q * 3 + 1], nz = N[q * 3 + 2];
      const r = (x - P[q * 3]) * nx + (y - P[q * 3 + 1]) * ny + (z - P[q * 3 + 2]) * nz;
      // peso robusto (Tukey) sulla distanza punto-piano
      const c = dist * 0.5;
      const u = r / c;
      if (Math.abs(u) >= 1) continue;
      const w = (1 - u * u) ** 2;
      if (levelled) {
        J[0] = x * ny - y * nx; J[1] = nx; J[2] = ny; J[3] = nz;
      } else {
        J[0] = y * nz - z * ny; J[1] = z * nx - x * nz; J[2] = x * ny - y * nx;
        J[3] = nx; J[4] = ny; J[5] = nz;
      }
      for (let a = 0; a < nU; a++) {
        b[a] += w * J[a] * r;
        for (let c2 = a; c2 < nU; c2++) A[a * nU + c2] += w * J[a] * J[c2];
      }
      sr2 += r * r; cnt++;
    }
    for (let a = 0; a < nU; a++) for (let c2 = 0; c2 < a; c2++) A[a * nU + c2] = A[c2 * nU + a];
    if (cnt < 50) break;
    rms = Math.sqrt(sr2 / cnt);
    inliers = cnt;
    const xs = solve(Array.from(A), Array.from(b).map((v) => -v), nU);
    if (!xs) break;
    const Ri = levelled ? rodrigues(0, 0, xs[0]) : rodrigues(xs[0], xs[1], xs[2]);
    const ti = levelled ? [xs[1], xs[2], xs[3]] : [xs[3], xs[4], xs[5]];
    R = mul3(Ri, R);
    t = [
      Ri[0] * t[0] + Ri[1] * t[1] + Ri[2] * t[2] + ti[0],
      Ri[3] * t[0] + Ri[4] * t[1] + Ri[5] * t[2] + ti[1],
      Ri[6] * t[0] + Ri[7] * t[1] + Ri[8] * t[2] + ti[2],
    ];
    const dAng = levelled ? Math.abs(xs[0]) : Math.hypot(xs[0], xs[1], xs[2]);
    const dT = Math.hypot(ti[0], ti[1], ti[2]);
    onIter?.({ iter, rms, dist, inliers, matrix: toMatrix(R, t) });
    const small = dAng < 2e-5 && dT < 2e-4;
    if (small && dist <= finalDist + 1e-9) { converged = true; iter++; break; }
    // restringe la distanza di accoppiamento man mano che l'allineamento migliora
    if (small || dT < dist * 0.05) dist = Math.max(finalDist, Math.min(dist * 0.7, Math.max(rms * 4, finalDist)));
  }

  // valutazione finale: sovrapposizione e scarto alla distanza finale
  const evalD2 = (finalDist * 1.5) ** 2;
  let ok = 0;
  const res2 = [];
  for (let i = 0; i < nSamples; i++) {
    const lx = S[i * 3], ly = S[i * 3 + 1], lz = S[i * 3 + 2];
    const x = R[0] * lx + R[1] * ly + R[2] * lz + t[0];
    const y = R[3] * lx + R[4] * ly + R[5] * lz + t[1];
    const z = R[6] * lx + R[7] * ly + R[8] * lz + t[2];
    const q = target.tree.nearest(x, y, z, evalD2);
    if (q < 0) continue;
    ok++;
    if (normalAt(target, q, normR2)) {
      const r = (x - P[q * 3]) * N[q * 3] + (y - P[q * 3 + 1]) * N[q * 3 + 1] + (z - P[q * 3 + 2]) * N[q * 3 + 2];
      res2.push(r * r);
    }
  }
  return {
    matrix: toMatrix(R, t),
    // scarto robusto: esclude il 10% peggiore (spigoli, bordi, oggetti mossi)
    rms: res2.length ? trimmedRms(res2, 0.9) : rms,
    overlap: ok / nSamples,
    iterations: iter,
    converged,
    inliers,
  };
}

function trimmedRms(arr, keep) {
  const a = Float64Array.from(arr).sort();
  const n = Math.max(1, Math.floor(a.length * keep));
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i];
  return Math.sqrt(s / n);
}

function mul3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}

function toMatrix(R, t) {
  return [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, t[0], t[1], t[2], 1];
}
