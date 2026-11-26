// Aggiornamento dell'app dal tablet: confronta il numero di build con l'ultima release GitHub,
// scarica l'APK nuovo e apre l'installazione di Android (si installa sopra, i dati restano).
import { Capacitor } from '@capacitor/core';
import { AppUpdater } from 'rilievi-fls-folder';

const RELEASE_API = 'https://api.github.com/repos/Caffelatte2025/Tabellone-punteggi/releases/tags/rilievi-apk';
// eslint-disable-next-line no-undef
export const BUILD = typeof __BUILD__ === 'number' ? __BUILD__ : 0;

export async function checkUpdate() {
  const r = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!r.ok) throw new Error(`GitHub non risponde (${r.status})`);
  const rel = await r.json();
  const m = /\[build:(\d+)\]/.exec(rel.body || '');
  const latest = m ? +m[1] : 0;
  const asset = (rel.assets || []).find((a) => /\.apk$/i.test(a.name));
  return { current: BUILD, latest, url: asset?.browser_download_url, newer: latest > BUILD && !!asset, date: asset?.updated_at || rel.published_at };
}

export const canSelfUpdate = () => Capacitor.isNativePlatform();

export async function downloadAndInstall(url, onProgress) {
  const sub = await AppUpdater.addListener('progress', (p) => onProgress?.(p.total > 0 ? p.done / p.total : 0, p));
  try {
    await AppUpdater.download({ url });
  } finally {
    sub.remove();
  }
  await AppUpdater.install();
}
