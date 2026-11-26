// Salvataggio locale (IndexedDB): progetti, stazioni e nuvole decimate.

const DB = 'rilievi';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = (e) => {
        const d = req.result;
        if (e.oldVersion < 1) {
          d.createObjectStore('projects', { keyPath: 'id' });
          const st = d.createObjectStore('stations', { keyPath: 'id' });
          st.createIndex('project', 'projectId');
          d.createObjectStore('clouds', { keyPath: 'id' });
        }
        // v2: panorami 360° delle stazioni FLS (per l'allineamento a punti)
        if (!d.objectStoreNames.contains('panos')) d.createObjectStore('panos', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx(stores, mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(stores, mode);
        let out;
        Promise.resolve(fn(t)).then((v) => (out = v));
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Salvataggio annullato (memoria piena?)'));
      }),
  );
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function listProjects() {
  return tx(['projects'], 'readonly', (t) => req2p(t.objectStore('projects').getAll()));
}

export async function saveProject(p) {
  return tx(['projects'], 'readwrite', (t) => { t.objectStore('projects').put(p); });
}

export async function deleteProject(id) {
  const stations = await listStations(id);
  return tx(['projects', 'stations', 'clouds', 'panos'], 'readwrite', (t) => {
    t.objectStore('projects').delete(id);
    for (const s of stations) {
      t.objectStore('stations').delete(s.id);
      t.objectStore('clouds').delete(s.id);
      t.objectStore('panos').delete(s.id);
    }
  });
}

export async function listStations(projectId) {
  const all = await tx(['stations'], 'readonly', (t) => req2p(t.objectStore('stations').index('project').getAll(projectId)));
  return all.sort((a, b) => a.order - b.order);
}

export async function saveStation(s) {
  return tx(['stations'], 'readwrite', (t) => { t.objectStore('stations').put(s); });
}

export async function saveCloud(id, cloud) {
  return tx(['clouds'], 'readwrite', (t) => { t.objectStore('clouds').put({ id, ...cloud }); });
}

export async function loadCloud(id) {
  return tx(['clouds'], 'readonly', (t) => req2p(t.objectStore('clouds').get(id)));
}

export async function deleteStation(id) {
  return tx(['stations', 'clouds', 'panos'], 'readwrite', (t) => {
    t.objectStore('stations').delete(id);
    t.objectStore('clouds').delete(id);
    t.objectStore('panos').delete(id);
  });
}

export async function savePano(id, pano) {
  return tx(['panos'], 'readwrite', (t) => { t.objectStore('panos').put({ id, ...pano }); });
}

export async function loadPano(id) {
  return tx(['panos'], 'readonly', (t) => req2p(t.objectStore('panos').get(id)));
}
