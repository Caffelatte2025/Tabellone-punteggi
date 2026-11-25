import { Viewer } from './viewer.js';
import * as store from './store.js';
import { buildMergedPly, buildTransforms, saveFiles } from './export.js';

const $ = (s) => document.querySelector(s);
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// ---------- impostazioni ----------
const DEFAULTS = { voxel: 0.05, maxRange: 40, sliceLo: -0.8, sliceHi: 0.8, pointSize: 2, levelled: true, autoRegister: true };
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('rilievi.settings') || '{}')); } catch { /* */ }
const saveSettings = () => { try { localStorage.setItem('rilievi.settings', JSON.stringify(settings)); } catch { /* */ } };

// ---------- worker ----------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map();
worker.onmessage = (e) => {
  const { id, type } = e.data;
  const p = pending.get(id);
  if (!p) return;
  if (type === 'progress') p.onProgress?.(e.data);
  else {
    pending.delete(id);
    type === 'done' ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
  }
};
function call(type, payload, onProgress, transfer = []) {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, type, ...payload }, transfer);
  });
}

// ---------- stato ----------
const viewer = new Viewer($('#view'));
viewer.setPointSize(settings.pointSize);
let project = null;
let stations = [];
const clouds = new Map();
let activeId = null;
let aligning = null; // { id, original }

// ---------- UI helpers ----------
let toastT;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), ms);
}
function busy(label, p) {
  if (label === false) { $('#busy').hidden = true; return; }
  $('#busy').hidden = false;
  if (label) $('#busyLabel').textContent = label;
  $('#busyBar').style.width = `${Math.round((p || 0) * 100)}%`;
}
const isReg = (s) => s.status === 'registered' || s.status === 'reference';

function quality(s) {
  if (s.status === 'reference') return { cls: 'q-good', text: 'Riferimento' };
  if (s.rms == null) return { cls: 'q-bad', text: 'Da registrare' };
  const mm = (s.rms * 1000).toFixed(0), ov = Math.round(s.overlap * 100);
  // soglie proporzionate al voxel di lavoro: con vegetazione reale (FLS, 5 cm) lo scarto tipico è 4-6 cm
  const v = s.voxel || 0.05;
  const good = s.rms <= Math.max(0.015, 0.6 * v) && s.overlap >= 0.3;
  const ok = s.rms <= Math.max(0.03, 1.4 * v) && s.overlap >= 0.15;
  const pre = s.status === 'registered' ? '' : 'Proposta: ';
  return { cls: good ? 'q-good' : ok ? 'q-warn' : 'q-bad', text: `${pre}scarto ${mm} mm · sovrapp. ${ov}%` };
}

function renderList() {
  const ul = $('#stationList');
  ul.innerHTML = '';
  $('#stationCount').textContent = stations.length ? `${stations.filter(isReg).length}/${stations.length} registrate` : '';
  $('#emptyHint').hidden = stations.length > 0;
  stations.forEach((s) => {
    const q = quality(s);
    const li = document.createElement('li');
    li.className = s.id === activeId ? 'active' : '';
    const dot = isReg(s) ? 'var(--ok)' : 'var(--bad)';
    li.innerHTML = `<span class="dot" style="background:${dot}"></span>
      <span class="name"><div></div><div class="meta ${q.cls}"></div></span>
      <button class="more" title="Dettagli">⋯</button>`;
    li.querySelector('.name div').textContent = s.name;
    li.querySelector('.meta').textContent = q.text;
    li.onclick = (e) => {
      if (e.target.closest('.more')) return openStationDialog(s);
      selectStation(s.id, true);
      if (!isReg(s)) startAlign(s.id);
    };
    ul.appendChild(li);
  });
}

function selectStation(id, focus) {
  activeId = id;
  viewer.setActive(id);
  if (focus) viewer.focusStation(id);
  renderList();
}

// ---------- progetti ----------
async function loadProjects(selectId) {
  let list = await store.listProjects();
  if (!list.length) {
    const p = { id: store.uid(), name: `Rilievo ${new Date().toLocaleDateString('it-IT')}`, created: Date.now() };
    await store.saveProject(p);
    list = [p];
  }
  list.sort((a, b) => b.created - a.created);
  const sel = $('#selProject');
  sel.innerHTML = '';
  for (const p of list) sel.add(new Option(p.name, p.id));
  sel.add(new Option('— Elimina progetto corrente —', '__delete'));
  const id = selectId || localStorage.getItem('rilievi.project') || list[0].id;
  await openProject(list.find((p) => p.id === id) || list[0]);
}

async function openProject(p) {
  endAlign(false);
  project = p;
  $('#selProject').value = p.id;
  try { localStorage.setItem('rilievi.project', p.id); } catch { /* */ }
  viewer.clear();
  clouds.clear();
  stations = await store.listStations(p.id);
  busy('Apro il progetto…', 0);
  for (let i = 0; i < stations.length; i++) {
    const c = await store.loadCloud(stations[i].id);
    if (c) clouds.set(stations[i].id, c);
    viewer.setStation(stations[i], c, i);
    busy(null, (i + 1) / stations.length);
  }
  busy(false);
  updateSliceRef();
  viewer.frameAll();
  activeId = null;
  renderList();
  const pend = stations.find((s) => !isReg(s));
  if (pend) toast(`${stations.filter((s) => !isReg(s)).length} stazioni da registrare: toccale nella lista`);
}

$('#selProject').onchange = async (e) => {
  if (e.target.value === '__delete') {
    if (confirm(`Eliminare il progetto "${project.name}" e tutte le sue stazioni dal tablet?`)) {
      await store.deleteProject(project.id);
      localStorage.removeItem('rilievi.project');
      return loadProjects();
    }
    e.target.value = project.id;
    return;
  }
  const list = await store.listProjects();
  openProject(list.find((p) => p.id === e.target.value));
};

$('#btnNewProject').onclick = async () => {
  const name = prompt('Nome del nuovo progetto', `Rilievo ${new Date().toLocaleDateString('it-IT')}`);
  if (!name) return;
  const p = { id: store.uid(), name, created: Date.now() };
  await store.saveProject(p);
  loadProjects(p.id);
};

// ---------- import ----------
$('#btnAdd').onclick = () => $('#fileInput').click();
$('#btnAddFls').onclick = () => $('#dirInput').click();
$('#fileInput').onchange = $('#dirInput').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  // i file di una cartella FARO .fls (Main, ScanDataStream*, MirrorIndex*.hls) si leggono insieme
  const isFls = (f) => /\.fls[\\/]/i.test(f.webkitRelativePath || '') || /^(Main|ScanDataStream\d+|MirrorIndex[01]\.hls)$/.test(f.name);
  const fls = files.filter(isFls);
  for (const f of files) if (!isFls(f) && !/\.(jpg|jpeg|png|sha|sig)$/i.test(f.name) && f.name !== 'SHA256SUM') await importFile(f);
  const inFolder = fls.filter((f) => /\.fls[\\/]/i.test(f.webkitRelativePath || ''));
  if (inFolder.length) {
    // cartella intera (PC / browser che supportano la scelta della cartella)
    const entries = inFolder.map((f) => ({ path: f.webkitRelativePath, file: f }));
    const roots = [...new Set(entries.map((x) => (/(.*?[^/\\]+\.fls)[\\/]/i.exec(x.path) || [])[1]).filter(Boolean))];
    const label = roots.length === 1 ? roots[0].split(/[\\/]/).pop() : `${roots.length} scansioni FLS`;
    await importFile({ name: label }, entries);
  }
  const loose = fls.filter((f) => !inFolder.includes(f));
  if (loose.length) await addFlsParts(loose);
};

// Sul tablet il selettore di Android sceglie un file alla volta e non la cartella: i pezzi della
// scansione FLS si raccolgono qui finché ci sono tutti, poi l'importazione parte da sola.
const flsBag = new Map();
const FLS_NEEDED = ['Main', 'MirrorIndex0.hls', 'MirrorIndex1.hls', 'ScanDataStream0'];
async function addFlsParts(files) {
  for (const f of files) {
    if (f.name === 'Main' && flsBag.has('Main')) flsBag.clear(); // un nuovo Main = una nuova scansione
    flsBag.set(f.name, f);
  }
  const missing = FLS_NEEDED.filter((n) => !flsBag.has(n));
  if (missing.length) {
    toast(`Scansione FLS: ho ${[...flsBag.keys()].join(', ')}. Mancano ${missing.join(', ')} (premi di nuovo «Cartella FLS»). Main è nella cartella .fls, gli altri in Scans/1.`);
    return;
  }
  const entries = [...flsBag.values()].map((f) => ({ path: f.name, file: f }));
  const ok = await importFile({ name: 'scansione FLS' }, entries, true);
  if (ok) flsBag.clear();
}

async function importFile(file, flsEntries, flsPartial = false) {
  if (aligning) endAlign(false);
  busy(`Leggo ${file.name}…`, 0);
  let scans;
  try {
    const opts = { voxel: settings.voxel, maxRange: settings.maxRange, minRange: 0.6 };
    scans = await call(flsEntries ? 'importFls' : 'import', flsEntries ? { entries: flsEntries, opts } : { file, opts }, (m) =>
      busy(`Leggo ${m.label && m.label !== file.name ? m.label : file.name}… ${Math.round(m.progress * 100)}%`, m.progress),
    );
  } catch (err) {
    busy(false);
    // scansione grande divisa su più ScanDataStream: si aggiunge il file mancante e riparte da sola
    if (flsPartial && /incompleta/.test(err.message)) toast(err.message);
    else alert(err.message);
    return false;
  }
  busy(false);
  for (const sc of scans) {
    if (sc.count < 100) { toast(`${sc.name}: troppo pochi punti, saltata`); continue; }
    const first = stations.length === 0;
    const lastReg = [...stations].reverse().find(isReg);
    const s = {
      id: store.uid(),
      projectId: project.id,
      order: stations.length ? stations[stations.length - 1].order + 1 : 0,
      name: uniqueName(sc.name),
      fileName: flsEntries ? `${sc.name}.fls` : file.name,
      created: Date.now(),
      points: sc.count,
      rawPoints: sc.rawCount,
      voxel: settings.voxel,
      origin: sc.origin || null,
      status: first ? 'reference' : 'pending',
      matrix: first ? IDENT.slice() : (lastReg ? lastReg.matrix.slice() : IDENT.slice()),
      rms: null,
      overlap: null,
    };
    const cloud = { positions: sc.positions, intensity: sc.intensity, colors: sc.colors };
    try {
      await store.saveCloud(s.id, cloud);
      await store.saveStation(s);
    } catch (err) {
      alert(`Impossibile salvare sul tablet: ${err.message}`);
      return;
    }
    stations.push(s);
    clouds.set(s.id, cloud);
    viewer.setStation(s, cloud, stations.length - 1);
    renderList();
    if (first) {
      updateSliceRef();
      viewer.frameAll();
      toast(`${s.name}: ${s.points.toLocaleString('it-IT')} punti di lavoro. È la stazione di riferimento.`);
    } else {
      selectStation(s.id, true);
      startAlign(s.id);
      if (settings.autoRegister) await register(true);
    }
  }
  return true;
}

function uniqueName(n) {
  let name = n, k = 2;
  while (stations.some((s) => s.name === name)) name = `${n} (${k++})`;
  return name;
}

function updateSliceRef() {
  const ref = stations.find((s) => s.status === 'reference');
  viewer.setSlice({ ref: ref ? ref.matrix[14] : 0, lo: settings.sliceLo, hi: settings.sliceHi });
}

// ---------- allineamento / registrazione ----------
function startAlign(id) {
  const s = stations.find((x) => x.id === id);
  if (!s) return;
  if (s.status === 'reference') { toast('La stazione di riferimento non si sposta'); return; }
  if (!stations.some((x) => x.id !== id && isReg(x))) { toast('Serve almeno una stazione registrata come riferimento'); return; }
  aligning = { id, original: s.matrix.slice() };
  selectStation(id, true);
  setView('plan');
  viewer.setAlign(id, (m) => {
    s.matrix = m;
    s.rms = null; s.overlap = null;
    updateAlignInfo();
  });
  $('#alignBar').hidden = false;
  updateAlignInfo();
}

function updateAlignInfo() {
  const s = stations.find((x) => x.id === aligning?.id);
  if (!s) return;
  $('#alignTitle').textContent = s.name;
  const st = $('#alignStatus');
  if (s.rms == null) {
    st.className = 'muted';
    st.textContent = 'Trascina la scansione arancione sopra le altre. Due dita per ruotarla. Poi "Affina", oppure "Automatico".';
  } else {
    const q = quality(s);
    st.className = q.cls;
    st.textContent = q.text + (q.cls === 'q-good' ? ' — buona, puoi accettare' : q.cls === 'q-warn' ? ' — controlla in pianta prima di accettare' : ' — probabilmente sbagliata: correggi a mano e "Affina"');
  }
}

function endAlign(keep) {
  if (!aligning) return;
  const s = stations.find((x) => x.id === aligning.id);
  if (s && !keep && s.status !== 'registered') {
    // "più tardi": la stazione resta da registrare, con la posizione attuale
    store.saveStation(s);
  }
  viewer.setAlign(null);
  aligning = null;
  $('#alignBar').hidden = true;
  renderList();
}

function targetData(excludeId) {
  const regs = stations.filter((s) => s.id !== excludeId && isReg(s) && clouds.has(s.id));
  let total = 0;
  for (const s of regs) total += clouds.get(s.id).positions.length / 3;
  const MAX = 2500000;
  const step = Math.max(1, total / MAX);
  const out = new Float32Array(Math.floor(total / step + regs.length) * 3);
  let o = 0;
  for (const s of regs) {
    const P = clouds.get(s.id).positions, m = s.matrix;
    const n = P.length / 3;
    for (let f = 0; f < n; f += step) {
      const i = Math.floor(f) * 3;
      const x = P[i], y = P[i + 1], z = P[i + 2];
      out[o++] = m[0] * x + m[4] * y + m[8] * z + m[12];
      out[o++] = m[1] * x + m[5] * y + m[9] * z + m[13];
      out[o++] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
  }
  const key = regs.map((s) => s.id + ':' + s.matrix.map((v) => v.toFixed(5)).join(',')).join('|');
  return { positions: out.subarray(0, o), key };
}

async function register(coarse) {
  const s = stations.find((x) => x.id === aligning?.id);
  if (!s) return;
  const { positions, key } = targetData(s.id);
  const cached = await call('needTarget', { targetKey: key });
  busy(coarse ? 'Ricerca automatica della posizione…' : 'Affino…', 0);
  try {
    const res = await call(
      'register',
      {
        targetKey: key,
        targetPositions: cached ? null : positions,
        source: clouds.get(s.id).positions,
        init: s.matrix,
        opts: { voxel: Math.max(s.voxel, settings.voxel), levelled: settings.levelled, coarse, startDist: coarse ? 1.0 : 0.6, sliceLow: settings.sliceLo, sliceHigh: settings.sliceHi },
      },
      (m) => {
        busy(m.label, m.progress);
        if (m.matrix) viewer.setMatrix(s.id, m.matrix);
      },
    );
    s.matrix = res.matrix;
    s.rms = res.rms;
    s.overlap = res.overlap;
    viewer.setMatrix(s.id, s.matrix);
    await store.saveStation(s);
  } catch (err) {
    alert(`Registrazione non riuscita: ${err.message}`);
  }
  busy(false);
  updateAlignInfo();
  renderList();
}

document.querySelectorAll('[data-rot]').forEach((b) => (b.onclick = () => viewer.rotateAligned(+b.dataset.rot)));
$('#btnAuto').onclick = () => register(true);
$('#btnRefine').onclick = () => register(false);
$('#btnAccept').onclick = async () => {
  const s = stations.find((x) => x.id === aligning?.id);
  if (!s) return;
  if (s.rms == null) {
    if (!confirm('La stazione non è stata affinata: accettare la posizione messa a mano?')) return;
  } else if (quality(s).cls === 'q-bad' && !confirm('La qualità è bassa. Accettare comunque?')) return;
  s.status = 'registered';
  await store.saveStation(s);
  viewer.setStation(s, clouds.get(s.id), stations.indexOf(s));
  endAlign(true);
  selectStation(null);
  toast(`${s.name} registrata`);
};
$('#btnCancelAlign').onclick = () => endAlign(false);

// ---------- dettagli stazione ----------
function openStationDialog(s) {
  const d = $('#dlgStation');
  const f = d.querySelector('form');
  $('#dsTitle').textContent = s.name;
  f.name.value = s.name;
  const q = quality(s);
  $('#dsInfo').innerHTML = '';
  $('#dsInfo').append(
    `File: ${s.fileName} · ${s.points.toLocaleString('it-IT')} punti di lavoro (${(s.voxel * 100).toFixed(0)} cm) su ${s.rawPoints.toLocaleString('it-IT')} letti. ${q.text}.`,
  );
  f.querySelector('[value=realign]').disabled = s.status === 'reference';
  d.onclose = async () => {
    const v = d.returnValue;
    if (v === 'ok' && f.name.value.trim()) {
      s.name = f.name.value.trim();
      await store.saveStation(s);
      viewer.setStation(s, clouds.get(s.id), stations.indexOf(s));
      renderList();
    } else if (v === 'delete') {
      if (s.status === 'reference' && stations.length > 1) {
        if (!confirm('È la stazione di riferimento: la prossima registrata diventerà il riferimento. Continuare?')) return;
      } else if (!confirm(`Eliminare ${s.name}?`)) return;
      if (aligning?.id === s.id) endAlign(false);
      await store.deleteStation(s.id);
      viewer.remove(s.id);
      clouds.delete(s.id);
      stations = stations.filter((x) => x.id !== s.id);
      if (s.status === 'reference') {
        const next = stations.find(isReg) || stations[0];
        if (next) { next.status = 'reference'; await store.saveStation(next); viewer.setStation(next, clouds.get(next.id), stations.indexOf(next)); }
      }
      renderList();
    } else if (v === 'realign') {
      s.status = 'pending';
      await store.saveStation(s);
      viewer.setStation(s, clouds.get(s.id), stations.indexOf(s));
      startAlign(s.id);
    }
  };
  d.showModal();
}

// ---------- vista ----------
function setView(v) {
  viewer.setMode(v);
  document.querySelectorAll('#segView button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('#btnSlice').hidden = v !== 'plan';
}
document.querySelectorAll('#segView button').forEach((b) => (b.onclick = () => setView(b.dataset.v)));
$('#selColor').onchange = (e) => viewer.setColorMode(e.target.value);
$('#btnFrame').onclick = () => viewer.frameAll();
$('#btnSlice').onclick = (e) => {
  const on = !e.currentTarget.classList.contains('on');
  e.currentTarget.classList.toggle('on', on);
  viewer.setSlice({ enabled: on });
};
$('#btnList').onclick = () => $('#side').classList.toggle('hidden');

// ---------- impostazioni ----------
$('#btnSettings').onclick = () => {
  const d = $('#dlgSettings');
  const f = d.querySelector('form');
  f.voxel.value = String(settings.voxel);
  f.maxRange.value = settings.maxRange;
  f.sliceLo.value = settings.sliceLo;
  f.sliceHi.value = settings.sliceHi;
  f.pointSize.value = settings.pointSize;
  f.levelled.checked = settings.levelled;
  f.autoRegister.checked = settings.autoRegister;
  d.onclose = () => {
    if (d.returnValue !== 'ok') return;
    settings = {
      voxel: +f.voxel.value,
      maxRange: +f.maxRange.value || DEFAULTS.maxRange,
      sliceLo: +f.sliceLo.value,
      sliceHi: +f.sliceHi.value,
      pointSize: +f.pointSize.value,
      levelled: f.levelled.checked,
      autoRegister: f.autoRegister.checked,
    };
    saveSettings();
    viewer.setPointSize(settings.pointSize);
    updateSliceRef();
  };
  d.showModal();
};

// ---------- esporta ----------
$('#btnExport').onclick = async () => {
  const regs = stations.filter(isReg);
  if (!regs.length) return toast('Nessuna stazione registrata da esportare');
  const skipped = stations.length - regs.length;
  if (skipped && !confirm(`${skipped} stazioni non sono registrate e verranno escluse. Continuare?`)) return;
  busy('Preparo l\'esportazione…', 0.2);
  try {
    const base = project.name.replace(/[^\w\-]+/g, '_');
    const ply = buildMergedPly(regs.map((s) => ({ station: s, cloud: clouds.get(s.id) })));
    const { json, csv } = buildTransforms(project, regs);
    busy('Salvo i file…', 0.6);
    const msg = await saveFiles([
      { name: `${base}_unita.ply`, blob: ply },
      { name: `${base}_stazioni.json`, blob: json },
      { name: `${base}_stazioni.csv`, blob: csv },
    ]);
    toast(msg);
  } catch (err) {
    alert(`Esportazione non riuscita: ${err.message}`);
  }
  busy(false);
};

// richiede memoria persistente così Android non cancella i dati del progetto
navigator.storage?.persist?.().catch(() => {});

loadProjects().catch((err) => alert(`Errore all'avvio: ${err.message}`));

// per i test automatici
window.__rilievi = { get stations() { return stations; }, importFile, register: (c) => register(c), viewer };
