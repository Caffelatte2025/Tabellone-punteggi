// Lettore E57 (ASTM E2807) in streaming da Blob/File.
// Legge solo i campi che servono (coordinate, intensita, colore, stato) e decima al volo.

import { parseXml, child, childNum } from './xml.js';
import { VoxelGrid } from './voxel.js';

const CHUNK = 4 << 20; // 4 MB logici per lettura

export async function readE57(blob, opts, onProgress) {
  const head = new DataView(await blob.slice(0, 48).arrayBuffer());
  const sig = new TextDecoder().decode(new Uint8Array(head.buffer, 0, 8));
  if (sig !== 'ASTM-E57') throw new Error('Non è un file E57 valido');
  const pageSize = Number(head.getBigUint64(40, true));
  const xmlPhys = Number(head.getBigUint64(24, true));
  const xmlLen = Number(head.getBigUint64(32, true));
  const io = new PagedReader(blob, pageSize);

  const xmlBytes = await io.readLogical(xmlPhys, xmlLen);
  const root = parseXml(new TextDecoder().decode(xmlBytes));
  const e57Root = child(root, 'e57Root');
  const data3D = child(e57Root, 'data3D');
  if (!data3D || data3D.children.length === 0) throw new Error('Il file E57 non contiene scansioni');

  const scans = [];
  const total = data3D.children.length;
  for (let s = 0; s < total; s++) {
    const scan = data3D.children[s];
    const name = (child(scan, 'name')?.text || `Scansione ${s + 1}`).trim();
    const rot = poseRotation(child(scan, 'pose'));
    const points = child(scan, 'points');
    const grid = new VoxelGrid(opts.voxel, opts.maxRange, opts.minRange);
    await readPoints(io, scan, points, rot, grid, (f) => onProgress?.((s + f) / total, name));
    scans.push({ name, ...grid.result() });
  }
  return scans;
}

class PagedReader {
  constructor(blob, pageSize) {
    this.blob = blob;
    this.P = pageSize;
    this.L = pageSize - 4; // ultimi 4 byte di ogni pagina sono CRC
  }
  physToLogical(p) {
    return Math.floor(p / this.P) * this.L + (p % this.P);
  }
  async readLogical(physStart, len) {
    const { P, L } = this;
    const lStart = this.physToLogical(physStart);
    const lEnd = lStart + len;
    const pg0 = Math.floor(lStart / L);
    const pg1 = Math.floor((lEnd - 1) / L);
    const raw = new Uint8Array(
      await this.blob.slice(pg0 * P, Math.min(this.blob.size, (pg1 + 1) * P)).arrayBuffer(),
    );
    const out = new Uint8Array(len);
    let o = 0;
    for (let pg = pg0; pg <= pg1; pg++) {
      const a = pg === pg0 ? lStart - pg * L : 0;
      const b = pg === pg1 ? lEnd - pg * L : L;
      const base = (pg - pg0) * P;
      out.set(raw.subarray(base + a, base + b), o);
      o += b - a;
    }
    return out;
  }
}

function poseRotation(pose) {
  const r = child(pose, 'rotation');
  if (!r) return null;
  const w = childNum(r, 'w', 1), x = childNum(r, 'x', 0), y = childNum(r, 'y', 0), z = childNum(r, 'z', 0);
  const n = Math.hypot(w, x, y, z) || 1;
  const [qw, qx, qy, qz] = [w / n, x / n, y / n, z / n];
  return [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy),
  ];
}

function bitsFor(range) {
  let b = 0;
  while (2 ** b <= range) b++;
  return b;
}

class FieldDecoder {
  constructor(el) {
    const t = el.attrs.type;
    const num = (k, d) => (el.attrs[k] !== undefined ? parseFloat(el.attrs[k]) : d);
    this.scale = 1;
    this.offset = 0;
    if (t === 'Float') {
      this.kind = el.attrs.precision === 'single' ? 'f32' : 'f64';
      this.bits = this.kind === 'f32' ? 32 : 64;
      this.min = num('minimum', undefined);
      this.max = num('maximum', undefined);
    } else if (t === 'Integer' || t === 'ScaledInteger') {
      this.kind = 'int';
      this.min = num('minimum', 0);
      this.max = num('maximum', 0);
      this.bits = bitsFor(this.max - this.min);
      if (t === 'ScaledInteger') {
        this.scale = num('scale', 1);
        this.offset = num('offset', 0);
      }
    } else {
      throw new Error(`Tipo di campo E57 non supportato: ${t}`);
    }
    this.data = new Uint8Array(0);
    this.bitPos = 0;
    this.vals = [];
  }

  // valore costante (0 bit): nessun dato nel flusso
  get constant() {
    return this.kind === 'int' && this.bits === 0;
  }
  get constValue() {
    return this.min * this.scale + this.offset;
  }

  push(bytes) {
    const keepFrom = this.bitPos >>> 3;
    const rest = this.data.subarray(keepFrom);
    const d = new Uint8Array(rest.length + bytes.length);
    d.set(rest);
    d.set(bytes, rest.length);
    this.data = d;
    this.bitPos &= 7;
    this.#decode();
  }

  #decode() {
    const { data, bits } = this;
    const avail = Math.floor((data.length * 8 - this.bitPos) / bits);
    if (avail <= 0) return;
    const out = this.vals;
    if (this.kind === 'f32' || this.kind === 'f64') {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      let p = this.bitPos >>> 3;
      const step = bits >>> 3;
      for (let i = 0; i < avail; i++, p += step) out.push(step === 4 ? dv.getFloat32(p, true) : dv.getFloat64(p, true));
      this.bitPos += avail * bits;
      return;
    }
    const { min, scale, offset } = this;
    let pos = this.bitPos;
    const mod = 2 ** bits;
    for (let i = 0; i < avail; i++, pos += bits) {
      const byte = pos >>> 3;
      const sh = pos & 7;
      let raw;
      if (bits + sh <= 32) {
        raw = ((data[byte] | (data[byte + 1] << 8) | (data[byte + 2] << 16) | (data[byte + 3] << 24)) >>> sh) % mod;
      } else {
        raw = 0;
        let mult = 1, rem = bits, p = pos;
        while (rem > 0) {
          const s = p & 7;
          const take = Math.min(8 - s, rem);
          raw += ((data[p >>> 3] >>> s) & ((1 << take) - 1)) * mult;
          mult *= 2 ** take;
          p += take;
          rem -= take;
        }
      }
      out.push((raw + min) * scale + offset);
    }
    this.bitPos = pos;
  }
}

async function readPoints(io, scan, points, rot, grid, onProgress) {
  const proto = child(points, 'prototype');
  const recordCount = parseInt(points.attrs.recordCount, 10);
  const fileOffset = parseInt(points.attrs.fileOffset, 10);
  const names = proto.children.map((c) => c.name);
  const has = (n) => names.includes(n);
  const cart = has('cartesianX');
  const sph = !cart && has('sphericalRange');
  if (!cart && !sph) throw new Error('Scansione senza coordinate cartesiane né sferiche');

  const wanted = cart
    ? ['cartesianX', 'cartesianY', 'cartesianZ', 'cartesianInvalidState']
    : ['sphericalRange', 'sphericalAzimuth', 'sphericalElevation', 'sphericalInvalidState'];
  wanted.push('intensity', 'colorRed', 'colorGreen', 'colorBlue');

  const decoders = proto.children.map((c) => (wanted.includes(c.name) ? new FieldDecoder(c) : null));
  const idx = (n) => names.indexOf(n);
  const f = wanted.map((n) => (idx(n) >= 0 ? decoders[idx(n)] : null));
  const [fa, fb, fc, fInv, fI, fR, fG, fB] = f;

  // limiti di intensita/colore per normalizzare
  const il = child(scan, 'intensityLimits');
  const iMin = childNum(il, 'intensityMinimum', fI?.min ?? 0);
  let iMax = childNum(il, 'intensityMaximum', fI?.max ?? 1);
  if (!(iMax > iMin)) iMax = iMin + 1;
  const cl = child(scan, 'colorLimits');
  const cMax = childNum(cl, 'colorRedMaximum', fR?.max ?? 255) || 255;
  const cMin = childNum(cl, 'colorRedMinimum', fR?.min ?? 0);
  const cScale = 255 / Math.max(1, cMax - cMin);

  const active = f.filter((d) => d && !d.constant);

  // header della sezione binaria
  const sh = new DataView((await io.readLogical(fileOffset, 32)).buffer);
  if (sh.getUint8(0) !== 1) throw new Error('Sezione CompressedVector non valida');
  const sectionLen = Number(sh.getBigUint64(8, true));
  const dataPhys = Number(sh.getBigUint64(16, true));
  const sectionEndLogical = io.physToLogical(fileOffset) + sectionLen;
  let logicalPos = io.physToLogical(dataPhys);
  const totalBytes = sectionEndLogical - logicalPos;
  let readBytes = 0;

  let buf = new Uint8Array(0);
  let off = 0;
  let emitted = 0;
  const r = rot;

  const emit = () => {
    let n = Infinity;
    for (const d of active) n = Math.min(n, d.vals.length);
    if (!Number.isFinite(n)) n = 0;
    n = Math.min(n, recordCount - emitted);
    const va = fa.constant ? null : fa.vals, vb = fb.constant ? null : fb.vals, vc = fc.constant ? null : fc.vals;
    for (let i = 0; i < n; i++) {
      if (fInv && (fInv.constant ? fInv.constValue : fInv.vals[i]) !== 0) continue;
      const a = va ? va[i] : fa.constValue, b = vb ? vb[i] : fb.constValue, c = vc ? vc[i] : fc.constValue;
      let x, y, z;
      if (cart) { x = a; y = b; z = c; }
      else {
        const ce = Math.cos(c);
        x = a * ce * Math.cos(b); y = a * ce * Math.sin(b); z = a * Math.sin(c);
      }
      if (r) {
        const X = r[0] * x + r[1] * y + r[2] * z;
        const Y = r[3] * x + r[4] * y + r[5] * z;
        z = r[6] * x + r[7] * y + r[8] * z;
        x = X; y = Y;
      }
      const inten = fI ? ((fI.constant ? fI.constValue : fI.vals[i]) - iMin) / (iMax - iMin) : undefined;
      if (fR) {
        const rr = ((fR.constant ? fR.constValue : fR.vals[i]) - cMin) * cScale;
        const gg = ((fG.constant ? fG.constValue : fG.vals[i]) - cMin) * cScale;
        const bb = ((fB.constant ? fB.constValue : fB.vals[i]) - cMin) * cScale;
        grid.add(x, y, z, inten, rr, gg, bb);
      } else grid.add(x, y, z, inten);
    }
    for (const d of active) d.vals = n === d.vals.length ? [] : d.vals.slice(n);
    emitted += n;
  };

  while (emitted < recordCount) {
    if (buf.length - off < 4 || buf.length - off < 4 + peekLen(buf, off)) {
      if (logicalPos >= sectionEndLogical) break;
      const want = Math.min(CHUNK, sectionEndLogical - logicalPos);
      const phys = logicalToPhys(io, logicalPos);
      const fresh = await io.readLogical(phys, want);
      logicalPos += want;
      readBytes += want;
      const nb = new Uint8Array(buf.length - off + fresh.length);
      nb.set(buf.subarray(off));
      nb.set(fresh, buf.length - off);
      buf = nb;
      off = 0;
      onProgress?.(readBytes / totalBytes);
      continue;
    }
    const type = buf[off];
    const plen = (buf[off + 2] | (buf[off + 3] << 8)) + 1;
    if (type === 1) {
      const count = buf[off + 4] | (buf[off + 5] << 8);
      let p = off + 6 + count * 2;
      for (let k = 0; k < count; k++) {
        const len = buf[off + 6 + k * 2] | (buf[off + 7 + k * 2] << 8);
        const d = decoders[k];
        if (d && len) d.push(buf.subarray(p, p + len));
        p += len;
      }
      emit();
    } else if (type !== 0 && type !== 2) {
      throw new Error(`Pacchetto E57 sconosciuto (tipo ${type})`);
    }
    off += plen;
  }
  onProgress?.(1);
}

function peekLen(buf, off) {
  return (buf[off + 2] | (buf[off + 3] << 8)) + 1 - 4;
}

function logicalToPhys(io, l) {
  return Math.floor(l / io.L) * io.P + (l % io.L);
}
