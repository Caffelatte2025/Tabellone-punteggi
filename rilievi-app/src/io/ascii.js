// Lettori PLY (ascii / binario little e big endian) e PTS/XYZ/TXT, in streaming.

import { VoxelGrid } from './voxel.js';

const CHUNK = 8 << 20;

export async function readPly(blob, opts, onProgress) {
  const headBuf = new Uint8Array(await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer());
  const headText = new TextDecoder('latin1').decode(headBuf);
  const endIdx = headText.indexOf('end_header');
  if (!headText.startsWith('ply') || endIdx < 0) throw new Error('Header PLY non valido');
  let dataStart = endIdx + 'end_header'.length;
  if (headText[dataStart] === '\r') dataStart++;
  dataStart++;
  const lines = headText.slice(0, endIdx).split(/\r?\n/);
  let format = 'ascii';
  const elements = [];
  for (const l of lines) {
    const t = l.trim().split(/\s+/);
    if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') elements.push({ name: t[1], count: parseInt(t[2], 10), props: [] });
    else if (t[0] === 'property') {
      const el = elements[elements.length - 1];
      if (t[1] === 'list') el.props.push({ name: t[4], list: true, countType: t[2], type: t[3] });
      else el.props.push({ name: t[2], type: t[1] });
    }
  }
  const vi = elements.findIndex((e) => e.name === 'vertex');
  if (vi < 0) throw new Error('Il PLY non contiene vertici');
  if (elements.slice(0, vi).some((e) => e.count > 0)) throw new Error('Struttura PLY non supportata');
  const vert = elements[vi];
  const P = vert.props;
  const pi = (...ns) => P.findIndex((p) => ns.includes(p.name));
  const ix = pi('x'), iy = pi('y'), iz = pi('z');
  const ii = pi('intensity', 'scalar_intensity', 'scalar_Intensity', 'Intensity', 'reflectance');
  const ir = pi('red', 'r', 'diffuse_red'), ig = pi('green', 'g', 'diffuse_green'), ib = pi('blue', 'b', 'diffuse_blue');
  if (ix < 0 || iy < 0 || iz < 0) throw new Error('Il PLY non ha coordinate x y z');
  if (P.some((p) => p.list)) throw new Error('Proprietà a lista nei vertici non supportate');

  const grid = new VoxelGrid(opts.voxel, opts.maxRange, opts.minRange);
  const origin = { x: 0, y: 0, z: 0, set: false };
  const add = (v) => {
    if (!origin.set) setOrigin(origin, v[ix], v[iy], v[iz], opts);
    let inten;
    if (ii >= 0) inten = normIntensity(v[ii], P[ii].type);
    if (ir >= 0) grid.add(v[ix] - origin.x, v[iy] - origin.y, v[iz] - origin.z, inten, v[ir], v[ig], v[ib]);
    else grid.add(v[ix] - origin.x, v[iy] - origin.y, v[iz] - origin.z, inten);
  };

  if (format === 'ascii') {
    let n = 0;
    await streamLines(blob, dataStart, onProgress, (line) => {
      if (n >= vert.count) return false;
      const t = line.trim();
      if (!t) return true;
      const v = t.split(/\s+/).map(Number);
      add(v);
      n++;
      return true;
    });
  } else {
    const le = format === 'binary_little_endian';
    const sizes = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
    const offs = [];
    let stride = 0;
    for (const p of P) { offs.push(stride); stride += sizes[p.type]; }
    const readers = P.map((p) => getter(p.type, le));
    const per = Math.max(1, Math.floor(CHUNK / stride));
    const v = new Array(P.length);
    for (let start = 0; start < vert.count; start += per) {
      const cnt = Math.min(per, vert.count - start);
      const a = dataStart + start * stride;
      const dv = new DataView(await blob.slice(a, a + cnt * stride).arrayBuffer());
      for (let k = 0; k < cnt; k++) {
        const base = k * stride;
        for (let j = 0; j < P.length; j++) v[j] = readers[j](dv, base + offs[j]);
        add(v);
      }
      onProgress?.((start + cnt) / vert.count);
    }
  }
  return [{ name: baseName(opts.fileName), origin, ...grid.result() }];
}

export async function readXyz(blob, opts, onProgress) {
  const grid = new VoxelGrid(opts.voxel, opts.maxRange, opts.minRange);
  const origin = { x: 0, y: 0, z: 0, set: false };
  let first = true;
  let maxI = 1;
  await streamLines(blob, 0, onProgress, (line) => {
    const t = line.trim();
    if (!t || t[0] === '#' || t[0] === '/') return true;
    const v = t.split(/[\s,;]+/).map(Number);
    if (v.length < 3 || !Number.isFinite(v[0])) return true;
    // il formato PTS ha il numero di punti sulla prima riga
    if (first && v.length === 1) { first = false; return true; }
    first = false;
    if (!origin.set) setOrigin(origin, v[0], v[1], v[2], opts);
    let inten;
    if (v.length === 4 || v.length >= 7) {
      // PTS: intensita in -2048..2047; altri: 0..1 o 0..255
      const raw = v[3];
      if (raw < 0 || raw > 255) maxI = 4095;
      else if (raw > 1 && maxI < 255) maxI = 255;
      inten = maxI === 4095 ? (raw + 2048) / 4095 : raw / maxI;
    }
    const x = v[0] - origin.x, y = v[1] - origin.y, z = v[2] - origin.z;
    if (v.length >= 7) grid.add(x, y, z, inten, v[4], v[5], v[6]);
    else if (v.length === 6) grid.add(x, y, z, undefined, v[3], v[4], v[5]);
    else grid.add(x, y, z, inten);
    return true;
  });
  return [{ name: baseName(opts.fileName), origin, ...grid.result() }];
}

// Le coordinate grandi (georiferite) perdono precisione in float32: le spostiamo vicino all'origine.
function setOrigin(o, x, y, z, opts) {
  o.set = true;
  if (Math.abs(x) > 5000 || Math.abs(y) > 5000 || Math.abs(z) > 5000) {
    o.x = Math.round(x); o.y = Math.round(y); o.z = Math.round(z);
  }
  // nei file non E57 la posizione dello scanner non è nota: niente filtro di distanza
  opts.maxRange = Infinity;
}

function normIntensity(v, type) {
  if (type === 'uchar' || type === 'uint8') return v / 255;
  if (type === 'ushort' || type === 'uint16') return v / 65535;
  if (v > 1) return v > 255 ? Math.min(1, v / 65535) : v / 255;
  return v;
}

function getter(type, le) {
  switch (type) {
    case 'char': case 'int8': return (d, o) => d.getInt8(o);
    case 'uchar': case 'uint8': return (d, o) => d.getUint8(o);
    case 'short': case 'int16': return (d, o) => d.getInt16(o, le);
    case 'ushort': case 'uint16': return (d, o) => d.getUint16(o, le);
    case 'int': case 'int32': return (d, o) => d.getInt32(o, le);
    case 'uint': case 'uint32': return (d, o) => d.getUint32(o, le);
    case 'float': case 'float32': return (d, o) => d.getFloat32(o, le);
    default: return (d, o) => d.getFloat64(o, le);
  }
}

async function streamLines(blob, start, onProgress, onLine) {
  const dec = new TextDecoder('latin1');
  let rest = '';
  for (let a = start; a < blob.size; a += CHUNK) {
    const text = rest + dec.decode(await blob.slice(a, Math.min(blob.size, a + CHUNK)).arrayBuffer());
    const lines = text.split('\n');
    rest = lines.pop();
    for (const l of lines) if (onLine(l) === false) return;
    onProgress?.(Math.min(1, (a + CHUNK - start) / (blob.size - start)));
  }
  if (rest) onLine(rest);
}

function baseName(n = '') {
  return n.replace(/\.[^.]+$/, '') || 'Scansione';
}
