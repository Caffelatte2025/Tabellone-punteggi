// Esportazione: nuvola unita (PLY binario) e matrici delle stazioni (JSON + CSV).

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export function buildMergedPly(items) {
  // items: [{ station, cloud }]
  let total = 0;
  for (const { cloud } of items) total += cloud.positions.length / 3;
  const header =
    'ply\nformat binary_little_endian 1.0\ncomment Rilievi - nuvola unita (decimata)\n' +
    `element vertex ${total}\nproperty float x\nproperty float y\nproperty float z\n` +
    'property uchar red\nproperty uchar green\nproperty uchar blue\nproperty uchar intensity\nproperty ushort station\nend_header\n';
  const hb = new TextEncoder().encode(header);
  const stride = 12 + 4 + 2;
  const buf = new ArrayBuffer(hb.length + total * stride);
  new Uint8Array(buf).set(hb);
  const dv = new DataView(buf);
  let o = hb.length;
  items.forEach(({ station, cloud }, si) => {
    const m = station.matrix;
    const P = cloud.positions, I = cloud.intensity, C = cloud.colors;
    const n = P.length / 3;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      dv.setFloat32(o, m[0] * x + m[4] * y + m[8] * z + m[12], true);
      dv.setFloat32(o + 4, m[1] * x + m[5] * y + m[9] * z + m[13], true);
      dv.setFloat32(o + 8, m[2] * x + m[6] * y + m[10] * z + m[14], true);
      if (C) { dv.setUint8(o + 12, C[i * 3]); dv.setUint8(o + 13, C[i * 3 + 1]); dv.setUint8(o + 14, C[i * 3 + 2]); }
      else { dv.setUint8(o + 12, I[i]); dv.setUint8(o + 13, I[i]); dv.setUint8(o + 14, I[i]); }
      dv.setUint8(o + 15, I[i]);
      dv.setUint16(o + 16, si, true);
      o += stride;
    }
  });
  return new Blob([buf], { type: 'application/octet-stream' });
}

export function buildTransforms(project, stations) {
  const json = {
    progetto: project.name,
    esportato: new Date().toISOString(),
    nota: 'Matrici 4x4 riga per riga: punto_progetto = M * punto_locale_scansione (metri). Solo stazioni registrate.',
    stazioni: stations.map((s) => ({
      nome: s.name,
      file: s.fileName,
      stato: s.status,
      scarto_mm: s.rms != null ? +(s.rms * 1000).toFixed(1) : null,
      sovrapposizione_pct: s.overlap != null ? +(s.overlap * 100).toFixed(0) : null,
      matrice: rows(s.matrix),
      posizione: [s.matrix[12], s.matrix[13], s.matrix[14]].map((v) => +v.toFixed(4)),
      rotazione_z_gradi: +((Math.atan2(s.matrix[1], s.matrix[0]) * 180) / Math.PI).toFixed(4),
    })),
  };
  const csv = ['nome;file;stato;scarto_mm;sovrapposizione_pct;x;y;z;rot_z_gradi;m11;m12;m13;m14;m21;m22;m23;m24;m31;m32;m33;m34']
    .concat(
      json.stazioni.map((s) =>
        [s.nome, s.file, s.stato, s.scarto_mm ?? '', s.sovrapposizione_pct ?? '', ...s.posizione, s.rotazione_z_gradi, ...s.matrice.slice(0, 3).flat()].join(';'),
      ),
    )
    .join('\n');
  return {
    json: new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
    csv: new Blob([csv], { type: 'text/csv' }),
  };
}

function rows(m) {
  return [0, 1, 2, 3].map((r) => [m[r], m[4 + r], m[8 + r], m[12 + r]].map((v) => +v.toFixed(8)));
}

// Salva i file: sul tablet in Documenti/Rilievi e poi apre la condivisione; nel browser li scarica.
export async function saveFiles(files) {
  if (!Capacitor.isNativePlatform()) {
    for (const { name, blob } of files) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    return 'Download avviato';
  }
  const uris = [];
  for (const { name, blob } of files) {
    const path = `Rilievi/${name}`;
    const CH = 3 * 1024 * 1024; // multiplo di 3 per base64 a pezzi
    for (let a = 0; a < blob.size || a === 0; a += CH) {
      const data = await blobToBase64(blob.slice(a, a + CH));
      if (a === 0) await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true });
      else await Filesystem.appendFile({ path, data, directory: Directory.Documents });
      if (blob.size === 0) break;
    }
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Documents });
    uris.push(uri);
  }
  try {
    await Share.share({ title: 'Esportazione rilievo', files: uris });
  } catch {
    /* condivisione annullata */
  }
  return 'Salvato in Documenti/Rilievi';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
