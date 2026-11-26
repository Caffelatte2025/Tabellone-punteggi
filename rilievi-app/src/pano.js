// Panorama 360° di una stazione FLS: dal pixel al punto 3D (coordinate locali, livellate)
// e trasformazione rigida da coppie di punti omologhi.

/** Punto locale (x,y,z) del pixel (px,py) del panorama; cerca la distanza valida più vicina entro `rad` pixel. */
export function panoPoint(pano, px, py, rad = 4) {
  const { w, h, range } = pano;
  let best = -1, bd = Infinity, bx = 0, by = 0;
  const cx = Math.round(px), cy = Math.round(py);
  for (let dy = -rad; dy <= rad; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -rad; dx <= rad; dx++) {
      const x = (((cx + dx) % w) + w) % w;
      const v = range[y * w + x];
      if (!v) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = v; bx = x; by = y; }
    }
  }
  if (best < 0) return null;
  // mediana 3x3 della distanza attorno al pixel scelto: riduce il rumore sui bordi
  const vals = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const y = by + dy, x = (((bx + dx) % w) + w) % w;
    if (y < 0 || y >= h) continue;
    const v = range[y * w + x];
    if (v && Math.abs(v - best) < 0.05 * best + 50) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  const d = vals[vals.length >> 1] / 1000;
  return { p: dirAt(pano, bx, by, d), px: bx, py: by, d };
}

export function dirAt(pano, px, py, d = 1) {
  const HP = pano.halfPx ?? pano.w / 2;
  const h1 = px >= HP;
  const el = h1 ? pano.el1[py] : pano.el0[py];
  // colonna della testa e lato dello specchio (la metà 1 guarda in direzione opposta)
  const col = (h1 ? px - HP : px) * pano.step;
  const az = (-col * 2 * Math.PI) / pano.cols + (h1 ? Math.PI : 0);
  let x = d * Math.cos(el) * Math.cos(az), y = d * Math.cos(el) * Math.sin(az), z = d * Math.sin(el);
  const r = pano.rot;
  if (r) { const X = r[0] * x + r[1] * y + r[2] * z, Y = r[3] * x + r[4] * y + r[5] * z, Z = r[6] * x + r[7] * y + r[8] * z; x = X; y = Y; z = Z; }
  return [x, y, z];
}

/** Pixel del panorama in cui si vede il punto locale p (inverso di dirAt). */
export function pixelFor(pano, p) {
  let [x, y, z] = p;
  const r = pano.rot;
  if (r) { const X = r[0] * x + r[3] * y + r[6] * z, Y = r[1] * x + r[4] * y + r[7] * z, Z = r[2] * x + r[5] * y + r[8] * z; x = X; y = Y; z = Z; }
  const d = Math.hypot(x, y, z);
  if (!d) return null;
  const az = Math.atan2(y, x), el = Math.asin(z / d);
  const HP = pano.halfPx ?? pano.w / 2;
  const col0 = ((((-az * pano.cols) / (2 * Math.PI)) % pano.cols) + pano.cols) % pano.cols;
  const h1 = col0 / pano.step >= HP;
  const px = h1 ? HP + Math.max(0, col0 - pano.cols / 2) / pano.step : col0 / pano.step;
  const tab = h1 ? pano.el1 : pano.el0;
  // righe ordinate per elevazione decrescente: ricerca binaria
  let lo = 0, hi = pano.h - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tab[mid] > el) lo = mid; else hi = mid; }
  const py = Math.abs(tab[lo] - el) < Math.abs(tab[hi] - el) ? lo : hi;
  return { px, py, d };
}

export function invertM(m) {
  // rototraslazione rigida: inversa = [R^T, -R^T t]
  const t = [m[12], m[13], m[14]];
  return [
    m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0,
    -(m[0] * t[0] + m[1] * t[1] + m[2] * t[2]), -(m[4] * t[0] + m[5] * t[1] + m[6] * t[2]), -(m[8] * t[0] + m[9] * t[1] + m[10] * t[2]), 1,
  ];
}

export const applyM = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

/**
 * Trasformazione (matrice column-major 4x4) che porta i punti locali `src` sui punti di progetto `dst`.
 * levelled: solo rotazione attorno a Z + traslazione (bastano 2 coppie); altrimenti 6 gradi di libertà (servono 3).
 */
export function solvePairs(src, dst, levelled = true) {
  const n = src.length;
  if (n < (levelled ? 2 : 3)) return null;
  const cs = [0, 0, 0], cd = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { cs[a] += src[i][a] / n; cd[a] += dst[i][a] / n; }
  let R;
  if (levelled) {
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const ax = src[i][0] - cs[0], ay = src[i][1] - cs[1], bx = dst[i][0] - cd[0], by = dst[i][1] - cd[1];
      sxx += ax * bx + ay * by; sxy += ax * by - ay * bx;
    }
    const th = Math.atan2(sxy, sxx), c = Math.cos(th), s = Math.sin(th);
    R = [c, -s, 0, s, c, 0, 0, 0, 1];
  } else {
    R = kabsch(src, dst, cs, cd);
  }
  const t = [0, 1, 2].map((a) => cd[a] - (R[a * 3] * cs[0] + R[a * 3 + 1] * cs[1] + R[a * 3 + 2] * cs[2]));
  const m = [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, t[0], t[1], t[2], 1];
  const res = src.map((p, i) => { const q = applyM(m, p); return Math.hypot(q[0] - dst[i][0], q[1] - dst[i][1], q[2] - dst[i][2]); });
  return { matrix: m, residuals: res, rms: Math.sqrt(res.reduce((a, r) => a + r * r, 0) / n) };
}

// Kabsch 3D con SVD della matrice 3x3 di covarianza (Jacobi su H^T H)
function kabsch(src, dst, cs, cd) {
  const H = new Array(9).fill(0);
  for (let i = 0; i < src.length; i++) {
    const a = [src[i][0] - cs[0], src[i][1] - cs[1], src[i][2] - cs[2]], b = [dst[i][0] - cd[0], dst[i][1] - cd[1], dst[i][2] - cd[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) H[r * 3 + c] += a[r] * b[c];
  }
  // rotazione ottimale via quaternione (metodo di Horn): autovettore massimo della matrice 4x4
  const [Sxx, Sxy, Sxz, Syx, Syy, Syz, Szx, Szy, Szz] = H;
  const N = [
    Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx,
    Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz,
    Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy,
    Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz,
  ];
  let q = [1, 0, 0, 0];
  // iterazione di potenza con shift (rende positivo l'autovalore massimo)
  const shift = Math.abs(N[0]) + Math.abs(N[5]) + Math.abs(N[10]) + Math.abs(N[15]) + 1;
  for (let it = 0; it < 200; it++) {
    const nq = [0, 1, 2, 3].map((r) => N[r * 4] * q[0] + N[r * 4 + 1] * q[1] + N[r * 4 + 2] * q[2] + N[r * 4 + 3] * q[3] + shift * q[r]);
    const l = Math.hypot(...nq);
    q = nq.map((v) => v / l);
  }
  const [w, x, y, z] = q;
  return [
    w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z,
  ];
}
