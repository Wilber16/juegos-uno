// Capa de red de ¡Chápalo! — todo lo que toca Firebase pasa por aquí.
// Rutas relativas a chapalo/rooms. Con ?fake=1 en la URL se usa un backend
// simulado en el navegador (localStorage, para probar con dos pestañas sin Firebase).
import { firebaseConfig } from './firebase-config.js?v=7';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const ROOT = 'chapalo/rooms';
const FAKE = new URLSearchParams(location.search).has('fake');
let api = null;

export function onlineAvailable() {
  return FAKE || !!(firebaseConfig && firebaseConfig.databaseURL);
}

export async function connect() {
  if (api) return api;
  api = FAKE ? fakeApi() : await firebaseApi();
  return api;
}

async function firebaseApi() {
  const [{ initializeApp }, A, D] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-database.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  const cred = await A.signInAnonymously(A.getAuth(app));
  const db = D.getDatabase(app);
  let offset = 0;
  D.onValue(D.ref(db, '.info/serverTimeOffset'), s => { offset = s.val() || 0; });
  const r = p => D.ref(db, p ? `${ROOT}/${p}` : ROOT);
  return {
    uid: cred.user.uid,
    now: () => Date.now() + offset,
    serverTime: () => D.serverTimestamp(),
    get: async p => (await D.get(r(p))).val(),
    set: (p, v) => D.set(r(p), v),
    update: (p, v) => D.update(r(p), v),
    remove: p => D.remove(r(p)),
    listen: (p, cb) => D.onValue(r(p), s => cb(s.val())),
    transact: async (p, fn) => {
      const res = await D.runTransaction(r(p), fn, { applyLocally: false });
      return { committed: res.committed, value: res.snapshot.val() };
    },
    removeOnDisconnect: p => D.onDisconnect(r(p)).remove(),
    cancelOnDisconnect: p => D.onDisconnect(r(p)).cancel(),
    // Borra hasta 25 salas creadas hace más de un día (lo permiten las reglas).
    cleanup: async () => {
      try {
        const old = Date.now() + offset - 24 * 3600 * 1000;
        const q = D.query(r(''), D.orderByChild('createdAt'), D.endAt(old), D.limitToFirst(25));
        const snap = await D.get(q);
        const ups = {};
        snap.forEach(ch => { ups[ch.key] = null; });
        if (Object.keys(ups).length) await D.update(r(''), ups);
      } catch { /* sin permiso o sin red: no importa */ }
    },
  };
}

// ---------- Backend simulado (solo pruebas): localStorage + evento storage ----------
function fakeApi() {
  const KEY = 'chapalo.fakedb';
  const listeners = new Set();
  let uid = sessionStorage.getItem('fake.uid');
  if (!uid) { uid = 'u' + Math.random().toString(36).slice(2, 8); sessionStorage.setItem('fake.uid', uid); }
  const load = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  // Imita a Firebase: sin null, sin arreglos ni objetos vacíos.
  const prune = v => {
    if (Array.isArray(v)) { const a = v.map(prune); return a.every(x => x === undefined) ? undefined : a.map(x => x === undefined ? null : x); }
    if (v && typeof v === 'object') {
      const o = {}; for (const k in v) { const x = prune(v[k]); if (x !== undefined && x !== null) o[k] = x; }
      return Object.keys(o).length ? o : undefined;
    }
    return v === null ? undefined : v;
  };
  const parts = p => (p ? p.split('/') : []);
  const read = p => { let n = load(); for (const k of parts(p)) { if (n == null) return null; n = n[k]; } return n ?? null; };
  const write = (p, v) => {
    const db = load(); const ks = parts(p);
    if (!ks.length) { localStorage.setItem(KEY, JSON.stringify(prune(v) ?? {})); notify(); return; }
    let n = db; for (const k of ks.slice(0, -1)) { if (typeof n[k] !== 'object' || n[k] == null) n[k] = {}; n = n[k]; }
    const val = prune(JSON.parse(JSON.stringify(v ?? null)));
    if (val === undefined) delete n[ks.at(-1)]; else n[ks.at(-1)] = val;
    localStorage.setItem(KEY, JSON.stringify(prune(db) ?? {}));
    notify();
  };
  const notify = () => { setTimeout(fire, 0); };
  const fire = () => listeners.forEach(l => { const v = JSON.stringify(read(l.p)); if (v !== l.last) { l.last = v; l.cb(JSON.parse(v)); } });
  addEventListener('storage', e => { if (e.key === KEY) fire(); });
  const onDisc = new Set();
  addEventListener('pagehide', () => onDisc.forEach(p => write(p, null)));
  return {
    uid,
    now: () => Date.now(),
    serverTime: () => Date.now(),
    get: async p => read(p),
    set: async (p, v) => write(p, v),
    update: async (p, obj) => { for (const k in obj) write(p + '/' + k, obj[k]); },
    remove: async p => write(p, null),
    listen: (p, cb) => { const l = { p, cb, last: undefined }; listeners.add(l); setTimeout(fire, 0); return () => listeners.delete(l); },
    transact: async (p, fn) => {
      await new Promise(r => setTimeout(r, 30 + Math.random() * 60)); // latencia simulada
      const out = fn(read(p));
      if (out === undefined) return { committed: false, value: read(p) };
      write(p, out); return { committed: true, value: read(p) };
    },
    removeOnDisconnect: async p => { onDisc.add(p); },
    cancelOnDisconnect: async p => { onDisc.delete(p); },
  };
}
