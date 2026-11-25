// Ricerca automatica della posizione approssimata (scansioni livellate).
// Taglia una fascia orizzontale (i muri), la proietta in pianta su una griglia e cerca
// rotazione + traslazione con la correlazione via FFT. Il risultato viene poi affinato con ICP.

const G = 256; // celle per lato

export function coarseSearch(target, src, init, opts, onProgress) {
  const cell = opts.coarseCell ?? 0.25;
  const half = G / 2;
  const maxShift = Math.min(half - 8, Math.round((opts.searchRadius ?? 25) / cell));
  const zLo = opts.sliceLow ?? -0.6, zHi = opts.sliceHigh ?? 1.2;
  const cx = init[12], cy = init[13], cz = init[14];

  // griglia del riferimento attorno alla posizione iniziale
  const P = target.positions;
  const occ = new Float64Array(G * G);
  for (let i = 0; i < P.length; i += 3) {
    const z = P[i + 2] - cz;
    if (z < zLo || z > zHi) continue;
    const gx = Math.floor((P[i] - cx) / cell) + half;
    const gy = Math.floor((P[i + 1] - cy) / cell) + half;
    if (gx < 0 || gy < 0 || gx >= G || gy >= G) continue;
    occ[gy * G + gx] = 1;
  }
  const tre = new Float64Array(G * G), tim = new Float64Array(G * G);
  for (let y = 1; y < G - 1; y++)
    for (let x = 1; x < G - 1; x++) {
      let v = occ[y * G + x] * 2;
      if (!v) {
        // bordo sfumato: tollera l'errore di rotazione
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (occ[(y + dy) * G + x + dx]) v = 1;
      }
      tre[y * G + x] = v;
    }
  fft2(tre, tim, false);

  // fascia della stazione da registrare (coordinate locali, scanner all'origine)
  const pts = [];
  const r2 = ((half - maxShift / 2) * cell) ** 2;
  for (let i = 0; i < src.length; i += 3) {
    const z = src[i + 2];
    if (z < zLo || z > zHi) continue;
    if (src[i] * src[i] + src[i + 1] * src[i + 1] > r2) continue;
    pts.push(src[i], src[i + 1]);
  }
  if (pts.length < 200) return init;

  const sre = new Float64Array(G * G), sim = new Float64Array(G * G);
  const evalYaw = (yaw) => {
    sre.fill(0); sim.fill(0);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = 0; i < pts.length; i += 2) {
      const x = c * pts[i] - s * pts[i + 1], y = s * pts[i] + c * pts[i + 1];
      const gx = Math.floor(x / cell) + half, gy = Math.floor(y / cell) + half;
      if (gx >= 0 && gy >= 0 && gx < G && gy < G) sre[gy * G + gx] = 1;
    }
    // sposta l'origine della sorgente in (0,0) della griglia: la correlazione da direttamente lo shift
    fft2(sre, sim, false);
    for (let i = 0; i < G * G; i++) {
      const ar = sre[i], ai = -sim[i]; // coniugato
      const br = tre[i], bi = tim[i];
      sre[i] = ar * br - ai * bi;
      sim[i] = ar * bi + ai * br;
    }
    fft2(sre, sim, true);
    let best = -Infinity, bx = 0, by = 0;
    for (let y = 0; y < G; y++) {
      const sy = y >= half ? y - G : y;
      if (Math.abs(sy) > maxShift) continue;
      for (let x = 0; x < G; x++) {
        const sx = x >= half ? x - G : x;
        if (Math.abs(sx) > maxShift) continue;
        const v = sre[y * G + x];
        if (v > best) { best = v; bx = sx; by = sy; }
      }
    }
    return { score: best, sx: bx, sy: by, yaw };
  };

  const results = [];
  const STEP = 3;
  for (let d = 0; d < 360; d += STEP) {
    results.push(evalYaw((d * Math.PI) / 180));
    onProgress?.((d / 360) * 0.8);
  }
  results.sort((a, b) => b.score - a.score);
  let best = results[0];
  // raffinamento a 0.5° attorno ai 3 migliori
  for (const r of results.slice(0, 3)) {
    for (let d = -2.5; d <= 2.5; d += 0.5) {
      const t = evalYaw(r.yaw + (d * Math.PI) / 180);
      if (t.score > best.score) best = t;
    }
  }
  onProgress?.(1);

  const c = Math.cos(best.yaw), s = Math.sin(best.yaw);
  // shift in celle: cella sorgente (i) -> cella riferimento (i + shift); centri allineati
  const tx = cx + best.sx * cell, ty = cy + best.sy * cell;
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, tx, ty, cz, 1];
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
