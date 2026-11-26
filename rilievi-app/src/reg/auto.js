// Registrazione automatica robusta: candidati dalla ricerca in pianta (strutture verticali + fascia
// orizzontale), ognuno verificato con un ICP veloce; vince quello con più punti in accordo, poi ICP fine.

import { coarseCandidates } from './coarse.js';
import { icp } from './icp.js';

export function autoRegister(target, src, init, opts = {}, onProgress) {
  const prog = (p, l) => onProgress?.(p, l);
  const base = { ...opts, maxCandidates: opts.maxCandidates ?? 6 };
  const cands = [
    ...coarseCandidates(target, src, init, { ...base, coarseMode: 'vertical' }, (p) => prog(p * 0.3, 'Ricerca della posizione (strutture verticali)…')),
    ...coarseCandidates(target, src, init, { ...base, coarseMode: 'slice' }, (p) => prog(0.3 + p * 0.2, 'Ricerca della posizione (sezione)…')),
  ];
  // verifica veloce di ogni candidato
  let best = null;
  cands.forEach((c, i) => {
    prog(0.5 + (i / cands.length) * 0.3, `Verifico le ipotesi (${i + 1}/${cands.length})…`);
    const r = icp(target, src, c.matrix, { voxel: opts.voxel, levelled: opts.levelled, startDist: 1.0, maxIter: 25, samples: 8000 });
    const score = r.overlap * (1 - 0.5 * Math.min(1, r.rms / 0.1));
    if (!best || score > best.score) best = { score, matrix: r.matrix, cand: i };
  });
  prog(0.82, 'Affino la posizione migliore…');
  const fin = icp(target, src, best.matrix, { voxel: opts.voxel, levelled: opts.levelled, startDist: 0.5, maxIter: opts.maxIter ?? 80 }, opts.onIter);
  return { ...fin, candidates: cands.length, chosen: best.cand };
}
