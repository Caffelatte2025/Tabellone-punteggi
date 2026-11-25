// Lettore FARO FLS grezzo (cartella .fls scritta dal Focus sulla SD), senza SDK FARO.
// Formato ricostruito per analisi dei file: vedi tools/fls-analisi/FLS-formato.md.
//
// Struttura: <nome>.fls/Main (metadati testuali) e Scans/<n>/ScanDataStream0..k (stream di pacchetti).
// Pacchetto: u32 tempo, u16 flag, tag "$XXX$", u16 lunghezza, dati, padding a lunghezza pari.
// $MIF$ apre ogni giro dello specchio; $CSE$ porta i campioni compressi, in blocchi da 16 byte
// da leggere al contrario. Ogni campione ha due campi a codici di prefisso:
//   A (fase -> distanza, accumulatore a 24 bit; distanza = (A & 0x7fffff) * ScanDistFactor mm)
//   B (ampiezza/intensita, delta o valore assoluto)
// 5120 campioni per giro: encoder = 16*k, riga r della meta' 0 a 40880-16r, meta' 1 a 40896+16r
// (dalla tabella MirrorIndex). Colonna c: azimut -c*2pi/NumCols (rotazione oraria vista dall'alto).

import { VoxelGrid } from './voxel.js';

const CHUNK = 8 << 20;

/**
 * @param {Array<{path:string, file:Blob}>} entries  file della cartella (o delle cartelle) .fls
 * @returns {Promise<Array>} come readE57: [{ name, positions, intensity, colors, count, rawCount, info }]
 */
export async function readFls(entries, opts = {}, onProgress) {
  const groups = groupScans(entries);
  if (!groups.length) throw new Error('Nella selezione non trovo una scansione FLS: servono almeno Main, ScanDataStream0 e MirrorIndex0/1.hls');
  const out = [];
  for (let g = 0; g < groups.length; g++) {
    const sc = await readOne(groups[g], opts, (f, label) => onProgress?.((g + f) / groups.length, label));
    out.push(sc);
  }
  return out;
}

// ---------- raggruppamento dei file per scansione ----------

function groupScans(entries) {
  const norm = entries.map((e) => ({ ...e, path: (e.path || e.file.name || '').replace(/\\/g, '/') }));
  const mains = norm.filter((e) => /(^|\/)Main$/.test(e.path));
  const groups = [];
  for (const m of mains) {
    const root = m.path.slice(0, m.path.length - 4); // con lo slash finale o vuoto
    const inRoot = norm.filter((e) => e.path.startsWith(root));
    const streams = inRoot
      .map((e) => ({ e, m: /(?:^|\/)Scans\/([^/]+)\/ScanDataStream(\d+)$|(?:^|\/)ScanDataStream(\d+)$/.exec(e.path.slice(root.length)) }))
      .filter((x) => x.m)
      .map((x) => ({ file: x.e.file, idx: +(x.m[2] ?? x.m[3]) }))
      .sort((a, b) => a.idx - b.idx);
    const pick = (n) => inRoot.find((e) => e.path.endsWith('/' + n) || e.path === n)?.file;
    const mi0 = pick('MirrorIndex0.hls'), mi1 = pick('MirrorIndex1.hls');
    if (!streams.length || !mi0 || !mi1) continue;
    let name = (root.replace(/\/$/, '').split('/').pop() || '').replace(/\.fls$/i, '');
    groups.push({ name, main: m.file, streams: streams.map((s) => s.file), mi0, mi1 });
  }
  return groups;
}

// ---------- metadati ----------

export function parseMain(text) {
  // Attr<tipo> { Name "X" Value ... } annidati: prende il primo valore per nome (quello di ScannerParam)
  const attrs = {};
  const re = /Attr<[^>]*>\s*\{\s*\nName "([^"]*)"\n(?:Value ((?:"(?:[^"\\]|\\.)*")|[^\n]*)\n)?\}/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] in attrs) continue;
    let v = m[2];
    if (v === undefined) v = null;
    else if (v.startsWith('"')) v = v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    attrs[m[1]] = v;
  }
  const num = (k, d = 0) => (attrs[k] == null || attrs[k] === '' ? d : Number(attrs[k]));
  const vec = (k) => (attrs[k] ? String(attrs[k]).trim().split(/\s+/).map(Number) : null);
  return {
    attrs,
    rows: num('NumRows'),
    cols: num('NumCols'),
    distFactor: num('ScanDistFactor', 0.073171531), // mm per unita'
    distOffset: num('ScanDistOffset', 0),
    scanAxis: vec('ScanAxis'),
    scanAngle: num('ScanAngle', 0),
    gps: parseNmea(attrs.GPSNMEA),
    scanner: attrs.ScannerType || attrs.ScannerModel || '',
    serial: attrs.ScannerSerNo || '',
    time: attrs.Time || '',
  };
}

function parseNmea(s) {
  if (!s) return null;
  const gga = s.split(/\r?\n/).find((l) => /^\$..GGA,/.test(l));
  if (!gga) return null;
  const f = gga.split(',');
  if (!f[2] || !f[4]) return null;
  const dm = (v, h, deg) => { const d = parseFloat(v.slice(0, deg)), mnt = parseFloat(v.slice(deg)); const x = d + mnt / 60; return h === 'S' || h === 'W' ? -x : x; };
  return { lat: dm(f[2], f[3], 2), lon: dm(f[4], f[5], 3), alt: parseFloat(f[9]), fix: +f[6], sats: +f[7], hdop: parseFloat(f[8]) };
}

async function readMirror(blob, rows) {
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = 0;
  while (s < b.length && b[s] !== 0x7b) s++; // '{'
  s += 2;
  const dv = new DataView(b.buffer, b.byteOffset);
  const enc = new Int32Array(rows), el = new Float64Array(rows);
  for (let r = 0; r < rows; r++) {
    enc[r] = Math.round(dv.getFloat64(s + r * 16, true));
    el[r] = dv.getFloat64(s + r * 16 + 8, true);
  }
  return { enc, el };
}

// ---------- lettura di una scansione ----------

async function readOne(g, opts, onProgress) {
  const info = parseMain(await g.main.text());
  const R = info.rows, NC = info.cols;
  if (!R || !NC) throw new Error(`${g.name}: metadati incompleti (NumRows/NumCols)`);
  const half = NC / 2;
  const m0 = await readMirror(g.mi0, R), m1 = await readMirror(g.mi1, R);

  // encoder -> (meta', riga); campione k = encoder/16
  const SPR = 5120; // campioni per giro (81920 passi / 16)
  const rowOf = new Int32Array(SPR).fill(-1), halfOf = new Int8Array(SPR);
  for (let r = 0; r < R; r++) {
    const k0 = m0.enc[r] / 16, k1 = m1.enc[r] / 16;
    if (Number.isInteger(k0) && k0 >= 0 && k0 < SPR) { rowOf[k0] = r; halfOf[k0] = 0; }
    if (Number.isInteger(k1) && k1 >= 0 && k1 < SPR) { rowOf[k1] = r; halfOf[k1] = 1; }
  }
  const cosE = [new Float64Array(R), new Float64Array(R)], sinE = [new Float64Array(R), new Float64Array(R)];
  for (let r = 0; r < R; r++) {
    cosE[0][r] = Math.cos(m0.el[r]); sinE[0][r] = Math.sin(m0.el[r]);
    cosE[1][r] = Math.cos(m1.el[r]); sinE[1][r] = Math.sin(m1.el[r]);
  }
  // segno verificato registrando add_000/add_001: con -1 lo scarto ICP scende da 61 a 48 mm
  const rot = tiltRotation(info.scanAxis, info.scanAngle, opts.levelSign ?? -1);
  const grid = new VoxelGrid(opts.voxel ?? 0.05, opts.maxRange ?? 60, opts.minRange ?? 0.6);
  const F = info.distFactor / 1000, OFF = info.distOffset || 0;
  const minR = opts.minRange ?? 0.6;

  const dist = new Float64Array(SPR), amp = new Int32Array(SPR), flag = new Uint8Array(SPR);
  const st = { A: 0, B: 0 };
  let col = 0;
  const decodeRev = (bytes) => {
    const n = decodeSamples(bytes, st, dist, amp, flag, F, OFF);
    if (col < half) {
      const az = -col * 2 * Math.PI / NC;
      const ca = [Math.cos(az), Math.cos(az + Math.PI)], sa = [Math.sin(az), Math.sin(az + Math.PI)];
      for (let k = 1; k < n - 1; k++) {
        const r = rowOf[k];
        if (r < 0) continue;
        const d = dist[k];
        if (!(d > minR) || flag[k]) continue;
        const tol = 0.02 + 0.02 * d; // coerenza con i campioni vicini: scarta il rumore del cielo
        if (Math.abs(dist[k - 1] - d) > tol || Math.abs(dist[k + 1] - d) > tol) continue;
        const h = halfOf[k];
        const xy = d * cosE[h][r];
        let x = xy * ca[h], y = xy * sa[h], z = d * sinE[h][r];
        if (rot) { const X = rot[0] * x + rot[1] * y + rot[2] * z, Y = rot[3] * x + rot[4] * y + rot[5] * z, Z = rot[6] * x + rot[7] * y + rot[8] * z; x = X; y = Y; z = Z; }
        grid.add(x, y, z, ampToIntensity(amp[k]));
      }
    }
    col++;
  };

  // lettura a blocchi degli stream concatenati
  const total = g.streams.reduce((a, f) => a + f.size, 0);
  let done = 0, carry = new Uint8Array(0), revParts = null, revLen = 0;
  const flushRev = () => {
    if (!revParts) return;
    const b = new Uint8Array(revLen);
    let o = 0;
    for (const p of revParts) { b.set(p, o); o += p.length; }
    decodeRev(b);
  };
  for (const file of g.streams) {
    for (let pos = 0; pos < file.size; pos += CHUNK) {
      const chunk = new Uint8Array(await file.slice(pos, Math.min(file.size, pos + CHUNK)).arrayBuffer());
      let buf = chunk;
      if (carry.length) { buf = new Uint8Array(carry.length + chunk.length); buf.set(carry); buf.set(chunk, carry.length); }
      let p = 0;
      while (p + 13 <= buf.length) {
        if (buf[p + 6] !== 0x24 || buf[p + 10] !== 0x24) throw new Error(`${g.name}: stream FLS non riconosciuto (pacchetto non valido)`);
        const n = buf[p + 11] | (buf[p + 12] << 8);
        const end = p + 13 + n + ((13 + n) & 1);
        if (end > buf.length) break;
        const t0 = buf[p + 7], t1 = buf[p + 8], t2 = buf[p + 9];
        if (t0 === 0x4d && t1 === 0x49 && t2 === 0x46) { // MIF
          flushRev();
          revParts = []; revLen = 0;
        } else if (t0 === 0x43 && t1 === 0x53 && t2 === 0x45 && n && revParts) { // CSE
          const pl = buf.slice(p + 13, p + 13 + n);
          for (let o = 0; o + 16 <= n; o += 16) pl.subarray(o, o + 16).reverse();
          revParts.push(pl); revLen += n;
        }
        p = end;
      }
      carry = buf.slice(p);
      done += chunk.length;
      onProgress?.(done / total * 0.98, g.name);
    }
  }
  flushRev();
  if (col < half) throw new Error(`${g.name}: scansione incompleta (${col} giri su ${half})`);
  onProgress?.(1, g.name);
  const res = grid.result();
  return { name: g.name, ...res, info: { scanner: info.scanner, serial: info.serial, time: info.time, gps: info.gps, rows: R, cols: NC, tilt: info.scanAngle } };
}

// Intensita' 0..1 dall'ampiezza (taratura sull'anteprima $GRV$ dello scanner: grv ~ 0.069*B - 18)
function ampToIntensity(b) {
  const g = 0.069 * b - 18;
  return g <= 0 ? 0 : g >= 255 ? 1 : g / 255;
}

// Rotazione che mette a livello la scansione (inclinometro: asse e angolo in Main)
function tiltRotation(axis, angle, sign) {
  if (!axis || !angle) return null;
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (!n) return null;
  const [x, y, z] = [axis[0] / n, axis[1] / n, axis[2] / n];
  const a = angle * sign, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

// ---------- decompressione di un giro ----------
// Ritorna il numero di campioni; aggiorna lo stato (accumulatori) che prosegue da un giro all'altro.
export function decodeSamples(b, st, dist, amp, flag, F, OFF) {
  let i = 0, k = 0, A = st.A, B = st.B;
  const L = b.length, M = dist.length;
  while (i < L && k < M) {
    // campo A: 01+6 | 10+14 | 11+22 | 00x1+28 (con segno), accumulato modulo 2^24
    const x = b[i];
    let d;
    if ((x & 0xc0) === 0x40) { d = (x & 0x3f) - ((x & 0x20) << 1); i += 1; }
    else if ((x & 0xc0) === 0x80) { if (i + 2 > L) break; const v = ((x & 0x3f) << 8) | b[i + 1]; d = v - ((v & 0x2000) << 1); i += 2; }
    else if ((x & 0xc0) === 0xc0) { if (i + 3 > L) break; const v = ((x & 0x3f) << 16) | (b[i + 1] << 8) | b[i + 2]; d = v - ((v & 0x200000) << 1); i += 3; }
    else if (x & 0x10) { if (i + 4 > L) break; const v = (x & 0x3f) * 16777216 + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]); d = v >= 0x20000000 ? v - 0x40000000 : v; i += 4; }
    else break; // fine dati (padding a zero)
    A = (A + d) % 16777216; if (A < 0) A += 16777216;
    if (i >= L) { dist[k] = (A & 0x7fffff) * F + OFF; amp[k] = B; flag[k] = 0; k++; break; }
    // campo B: 00f+5 (delta) | 10f+13 (delta) | 11x+13 (valore assoluto)
    const y = b[i];
    let f = 0;
    if ((y & 0xc0) === 0x00) { const v = y & 0x1f; B += v - ((v & 0x10) << 1); f = (y >> 5) & 1; i += 1; }
    else { if (i + 2 > L) break; const v = ((y & 0x1f) << 8) | b[i + 1]; if ((y & 0xc0) === 0xc0) B = v; else { B += v - ((v & 0x1000) << 1); f = (y >> 5) & 1; } i += 2; }
    dist[k] = (A & 0x7fffff) * F + OFF; amp[k] = B; flag[k] = f; k++;
  }
  st.A = A; st.B = B;
  return k;
}
