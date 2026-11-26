// Ricerca automatica della posizione approssimata (scansioni livellate).
// Proietta in pianta le strutture verticali (muri, tronchi, pali: celle con punti distribuiti in altezza,
// indipendenti dalla pendenza del terreno) oppure una fascia orizzontale, e cerca rotazione + traslazione
// con la correlazione via FFT. Restituisce più candidati: il chiamante li verifica con ICP.

const G = 256; // celle per lato

// celle "verticali": nella cella i punti coprono almeno vMin metri di quota
function verticalCells(P, cx, cy, cz, cell, zLo, zHi, vMin) {
  const half = G / 2;
  const zmin = new Float32Array(G * G).fill(Infinity), zmax = new Float32Array(G * G).fill(-Infinity);
  for (let i = 0; i < P.length; i += 3) {
    const z = P[i + 2] - cz;
    if (z < zLo || z > zHi) continue;
    const gx = Math.floor((P[i] - cx) / cell) + half, gy = Math.floor((P[i + 1] - cy) / cell) + half;
    if (gx < 0 || gy < 0 || gx >= G || gy >= G) continue;
    const k = gy * G + gx;
    if (z < zmin[k]) zmin[k] = z;
    if (z > zmax[k]) zmax[k] = z;
  }
  const occ = new Uint8Array(G * G);
  for (let k = 0; k < G * G; k++) if (zmax[k] - zmin[k] >= vMin) occ[k] = 1;
  return occ;
}

function sliceCells(P, cx, cy, cz, cell, zLo, zHi) {
  const half = G / 2;
  const occ = new Uint8Array(G * G);
  for (let i = 0; i < P.length; i += 3) {
    const z = P[i + 2] - cz;
    if (z < zLo || z > zHi) continue;
    const gx = Math.floor((P[i] - cx) / cell) + half, gy = Math.floor((P[i + 1] - cy) / cell) + half;
    if (gx < 0 || gy < 0 || gx >= G || gy >= G) continue;
    occ[gy * G + gx] = 1;
  }
  return occ;
}

export function coarseCandidates(target, src, init, opts = {}, onProgress) {
  const cell = opts.coarseCell ?? 0.25;
  const half = G / 2;
  const maxShift = Math.min(half - 8, Math.round((opts.searchRadius ?? 25) / cell));
  const mode = opts.coarseMode ?? 'vertical';
  const zLo = opts.sliceLow ?? -0.6, zHi = opts.sliceHigh ?? 1.2;
  const vLo = -3, vHi = 6, vMin = opts.verticalMin ?? 0.6;
  const cx = init[12], cy = init[13], cz = init[14];
  // ricerca ristretta (es. posizione da GPS): raggio in metri attorno a init, e rotazione attorno a una prevista
  const near = opts.nearRadius ? Math.min(maxShift, Math.round(opts.nearRadius / cell)) : maxShift;
  const yaw0 = opts.yawPrior, yawTol = opts.yawTol ?? Math.PI;
  // vincolo a corona (distanza da GPS rispetto a una stazione nota): { x, y, r, tol }
  const ring = opts.ring || null;

  const occ = mode === 'vertical' ? verticalCells(target.positions, cx, cy, cz, cell, vLo, vHi, vMin) : sliceCells(target.positions, cx, cy, cz, cell, zLo, zHi);
  const tre = new Float64Array(G * G), tim = new Float64Array(G * G);
  for (let y = 1; y < G - 1; y++)
    for (let x = 1; x < G - 1; x++) {
      let v = occ[y * G + x] * 2;
      if (!v) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (occ[(y + dy) * G + x + dx]) v = 1; // bordo sfumato
      tre[y * G + x] = v;
    }
  fft2(tre, tim, false);

  // punti caratteristici della stazione da registrare (coordinate locali, scanner all'origine)
  const pts = [];
  const r2 = ((half - maxShift / 2) * cell) ** 2;
  const S = src;
  if (mode === 'vertical') {
    const lz = new Map();
    for (let i = 0; i < S.length; i += 3) {
      const z = S[i + 2];
      if (z < vLo || z > vHi) continue;
      const k = Math.floor(S[i] / cell) * 100003 + Math.floor(S[i + 1] / cell);
      const e = lz.get(k);
      if (e) { if (z < e[0]) e[0] = z; if (z > e[1]) e[1] = z; } else lz.set(k, [z, z]);
    }
    for (let i = 0; i < S.length; i += 3) {
      const z = S[i + 2];
      if (z < vLo || z > vHi) continue;
      if (S[i] * S[i] + S[i + 1] * S[i + 1] > r2) continue;
      const e = lz.get(Math.floor(S[i] / cell) * 100003 + Math.floor(S[i + 1] / cell));
      if (e[1] - e[0] >= vMin) pts.push(S[i], S[i + 1]);
    }
  } else {
    for (let i = 0; i < S.length; i += 3) {
      const z = S[i + 2];
      if (z < zLo || z > zHi) continue;
      if (S[i] * S[i] + S[i + 1] * S[i + 1] > r2) continue;
      pts.push(S[i], S[i + 1]);
    }
  }
  if (pts.length < 200) return [{ matrix: init, score: 0 }];

  const sre = new Float64Array(G * G), sim = new Float64Array(G * G);
  const evalYaw = (yaw) => {
    sre.fill(0); sim.fill(0);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = 0; i < pts.length; i += 2) {
      const x = c * pts[i] - s * pts[i + 1], y = s * pts[i] + c * pts[i + 1];
      const gx = Math.floor(x / cell) + half, gy = Math.floor(y / cell) + half;
      if (gx >= 0 && gy >= 0 && gx < G && gy < G) sre[gy * G + gx] = 1;
    }
    fft2(sre, sim, false);
    for (let i = 0; i < G * G; i++) {
      const ar = sre[i], ai = -sim[i];
      const br = tre[i], bi = tim[i];
      sre[i] = ar * br - ai * bi;
      sim[i] = ar * bi + ai * br;
    }
    fft2(sre, sim, true);
    // i 3 picchi migliori, separati di almeno 1.5 m
    const peaks = [];
    const sep = 1.5 / cell;
    for (let y = 0; y < G; y++) {
      const sy = y >= half ? y - G : y;
      if (Math.abs(sy) > near) continue;
      for (let x = 0; x < G; x++) {
        const sx = x >= half ? x - G : x;
        if (Math.abs(sx) > near || sx * sx + sy * sy > near * near) continue;
        if (ring) { const rr = Math.hypot(cx + sx * cell - ring.x, cy + sy * cell - ring.y); if (Math.abs(rr - ring.r) > ring.tol) continue; }
        const v = sre[y * G + x];
        if (peaks.length < 3 || v > peaks[peaks.length - 1].score) {
          const j = peaks.findIndex((p) => Math.abs(p.sx - sx) <= sep && Math.abs(p.sy - sy) <= sep);
          if (j >= 0) { if (v > peaks[j].score) peaks[j] = { score: v, sx, sy, yaw }; }
          else peaks.push({ score: v, sx, sy, yaw });
          peaks.sort((a, b) => b.score - a.score);
          if (peaks.length > 3) peaks.length = 3;
        }
      }
    }
    return peaks;
  };

  const all = [];
  const STEP = 3;
  const yaws = [];
  for (let d = 0; d < 360; d += STEP) {
    const yaw = (d * Math.PI) / 180;
    if (yaw0 != null && Math.abs(Math.atan2(Math.sin(yaw - yaw0), Math.cos(yaw - yaw0))) > yawTol) continue;
    yaws.push(yaw);
  }
  yaws.forEach((yaw, i) => { all.push(...evalYaw(yaw)); onProgress?.((i / yaws.length) * 0.8); });
  all.sort((a, b) => b.score - a.score);
  // candidati distinti (rotazione diversa di 8° o posizione diversa di 2 m)
  const cands = [];
  for (const p of all) {
    if (cands.length >= (opts.maxCandidates ?? 8)) break;
    const dup = cands.some((q) => Math.abs(Math.atan2(Math.sin(p.yaw - q.yaw), Math.cos(p.yaw - q.yaw))) < (8 * Math.PI) / 180 && Math.hypot(p.sx - q.sx, p.sy - q.sy) * cell < 2);
    if (!dup) cands.push(p);
  }
  // raffinamento a 0.5° di ogni candidato
  const out = cands.map((r) => {
    let best = r;
    for (let d = -2.5; d <= 2.5; d += 0.5) {
      if (!d) continue;
      const t = evalYaw(r.yaw + (d * Math.PI) / 180)[0];
      if (t && t.score > best.score && Math.hypot(t.sx - r.sx, t.sy - r.sy) * cell < 2) best = t;
    }
    const c = Math.cos(best.yaw), s = Math.sin(best.yaw);
    return { score: best.score, matrix: [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, cx + best.sx * cell, cy + best.sy * cell, cz, 1] };
  });
  onProgress?.(1);
  return out;
}

// compatibilità: il candidato migliore
export function coarseSearch(target, src, init, opts, onProgress) {
  return coarseCandidates(target, src, init, opts, onProgress)[0].matrix;
}


function fft1(re, im, off, stride, n, inv) {
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = off + i * stride, b = off + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = off + (i + k) * stride, b = off + (i + k + len / 2) * stride;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

function fft2(re, im, inv) {
  for (let y = 0; y < G; y++) fft1(re, im, y * G, 1, G, inv);
  for (let x = 0; x < G; x++) fft1(re, im, x, G, G, inv);
  if (inv) {
    const s = 1 / (G * G);
    for (let i = 0; i < G * G; i++) { re[i] *= s; im[i] *= s; }
  }
}
