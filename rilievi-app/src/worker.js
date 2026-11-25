// Worker: lettura/decimazione dei file e registrazione ICP, fuori dal thread dell'interfaccia.

import { readE57 } from './io/e57.js';
import { readPly, readXyz } from './io/ascii.js';
import { readFls } from './io/fls.js';
import { buildTarget, icp } from './reg/icp.js';
import { coarseSearch } from './reg/coarse.js';

let cachedTarget = null; // { key, target }

self.onmessage = async (e) => {
  const { id, type } = e.data;
  const progress = (p, label) => self.postMessage({ id, type: 'progress', progress: p, label });
  try {
    if (type === 'importFls') {
      const scans = await readFls(e.data.entries, e.data.opts, progress);
      const transfer = [];
      for (const s of scans) transfer.push(s.positions.buffer, s.intensity.buffer);
      self.postMessage({ id, type: 'done', result: scans }, transfer);
    } else if (type === 'import') {
      const { file, opts } = e.data;
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      let scans;
      if (ext === 'e57') scans = await readE57(file, opts, progress);
      else if (ext === 'ply') scans = await readPly(file, { ...opts, fileName: file.name }, progress);
      else if (['xyz', 'pts', 'txt', 'asc', 'csv'].includes(ext)) scans = await readXyz(file, { ...opts, fileName: file.name }, progress);
      else if (ext === 'fls' || file.name === 'Main' || /^ScanDataStream\d+$/.test(file.name)) throw new Error('Le scansioni FARO FLS si importano come cartella: usa il pulsante «Cartella FLS» e scegli la cartella .fls (o seleziona insieme Main, ScanDataStream* e MirrorIndex0/1.hls).');
      else if (ext === 'lgs') throw new Error('Il formato LGS non è ancora supportato: serve un file di esempio per decodificarlo. Per ora esporta in E57 da SCENE.');
      else throw new Error(`Formato .${ext} non supportato`);
      const transfer = [];
      for (const s of scans) {
        transfer.push(s.positions.buffer, s.intensity.buffer);
        if (s.colors) transfer.push(s.colors.buffer);
      }
      self.postMessage({ id, type: 'done', result: scans }, transfer);
    } else if (type === 'register') {
      const { targetKey, targetPositions, source, init, opts } = e.data;
      if (!cachedTarget || cachedTarget.key !== targetKey) {
        progress(0, 'Preparo i dati di riferimento…');
        cachedTarget = { key: targetKey, target: buildTarget(targetPositions) };
      }
      let start = init;
      if (opts.coarse) {
        progress(0.05, 'Ricerca automatica della posizione…');
        start = coarseSearch(cachedTarget.target, source, init, opts, (p) => progress(0.05 + p * 0.6, 'Ricerca automatica della posizione…'));
      }
      const res = icp(cachedTarget.target, source, start, opts, (it) =>
        self.postMessage({ id, type: 'progress', progress: Math.min(0.99, 0.65 + it.iter / (opts.maxIter ?? 60) * 0.35), label: `Affino… scarto ${(it.rms * 1000).toFixed(0)} mm`, matrix: it.matrix }),
      );
      self.postMessage({ id, type: 'done', result: res });
    } else if (type === 'needTarget') {
      self.postMessage({ id, type: 'done', result: !!cachedTarget && cachedTarget.key === e.data.targetKey });
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: err?.message || String(err) });
  }
};
