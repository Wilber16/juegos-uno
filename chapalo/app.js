import { newGame, apply, sharedSymbol, rng, DECKS } from './engine.js?v=6';
import { SYMBOLS } from './symbols.js?v=6';
import { onlineAvailable, connect } from './net.js?v=6';

const $ = id => document.getElementById(id);
window.addEventListener('error', e => toast('Error: ' + (e.message || e), 6000));
window.addEventListener('unhandledrejection', e => toast('Error: ' + (e.reason?.message || e.reason), 6000));
// Tamaño de símbolos en px según el ancho real de cada carta (compatible con Safari antiguo)
const sizer = new ResizeObserver(entries => {
  for (const en of entries) en.target.style.setProperty('--cw', (en.target.clientWidth / 100) + 'px');
});
document.querySelectorAll('.card').forEach(c => sizer.observe(c));
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---------------- Lobby ----------------
const opts = { mode: 'bots', bots: 1, level: 'normal', deck: store.get('chapalo.deck', 'rapido') };
function seg(id, key, cast = x => x) {
  const box = $(id);
  box.querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', String(opts[key]) === b.dataset.v);
    b.addEventListener('click', () => {
      if (b.disabled) return;
      opts[key] = cast(b.dataset.v);
      box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if (key === 'mode') updateModeUI();
    });
  });
}
seg('modeSeg', 'mode'); seg('botsSeg', 'bots', Number); seg('levelSeg', 'level'); seg('deckSeg', 'deck');
$('name').value = store.get('chapalo.name', '');
$('play').onclick = () => {
  store.set('chapalo.name', $('name').value.trim());
  store.set('chapalo.deck', opts.deck);
  start();
};
$('howBtn').onclick = () => $('dlgHow').showModal();
$('howClose').onclick = () => $('dlgHow').close();

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}

// ---------------- Dibujo de cartas ----------------
// Disposición estable por carta (misma carta = mismo dibujo en tu mano y en el centro).
const LAYOUT = { 4: { ring: .56, w: 27 }, 6: { ring: .58, w: 25 }, 8: { ring: .61, w: 21.5 } };
function layoutFor(card, seed) {
  const n = card.s.length, L = LAYOUT[n];
  const rand = rng((seed % 100000) * 131 + card.id * 7919);
  const off = rand() * Math.PI * 2;
  return card.s.map((sym, i) => {
    let x = 50, y = 50;
    if (i > 0) {
      const a = off + (i - 1) * (Math.PI * 2 / (n - 1)) + (rand() - .5) * .25;
      const r = L.ring * 50 + (rand() - .5) * 4;
      x = 50 + r * Math.cos(a); y = 50 + r * Math.sin(a);
    }
    const s = i === 0 ? .8 + rand() * .2 : .75 + rand() * .33;
    const w = L.w * s;
    return { sym, x, y, w, f: w * .78, r: Math.round(rand() * 360 - 180) };
  });
}
function paintCard(el, card, seed, interactive) {
  if (!card) { el.querySelectorAll('.sym').forEach(n => n.remove()); el.dataset.cid = ''; return false; }
  if (el.dataset.cid === String(card.id)) return false;
  el.dataset.cid = card.id;
  el.querySelectorAll('.sym').forEach(n => n.remove());
  for (const p of layoutFor(card, seed)) {
    const info = SYMBOLS[p.sym];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sym';
    b.dataset.sym = p.sym;
    b.setAttribute('aria-label', info.n);
    b.style.cssText = `--x:${p.x}%;--y:${p.y}%;--w:${p.w}%;--f:${p.f};--r:${p.r}deg`;
    if (info.img) { const im = document.createElement('img'); im.src = info.img; im.alt = ''; b.appendChild(im); }
    else b.textContent = info.e;
    el.appendChild(b);
  }
  el.classList.toggle('tappable', !!interactive);
  return true;
}
function pulse(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function symEl(cardEl, sym) { return cardEl.querySelector(`.sym[data-sym="${sym}"]`); }

let toastT;
function toast(msg, ms = 1300) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------- Partida local ----------------
const BOT_NAMES = ['Don Anticucho', 'Tía Picarones', 'Tío Emoliente'];
const BOT_LEVEL = { facil: { min: 3600, max: 6500, err: .12 }, normal: { min: 2300, max: 4300, err: .07 }, pro: { min: 1300, max: 2600, err: .03 } };
const DECK_SPEED = { mini: .7, rapido: 1, clasico: 1.2 };

let G = null; // partida actual

function start() {
  if (G) G.stop();
  G = opts.mode === 'duel' ? duelGame() : botGame();
  G.begin();
}

function baseGame(state, humans, screenId, centerEl) {
  const g = {
    state, seed: state.seed, humans, timers: [], ticker: null, playing: false,
    prevCenter: null, changedAt: 0, now: () => Date.now(),
  };
  g.tap = (pid, sym, cardId) => {
    if (!g.playing) return;
    const now = Date.now();
    const st = g.state;
    // Si el centro acaba de cambiar y tu símbolo era el correcto con la carta anterior: te ganaron, sin castigo.
    if (!st.center.s.includes(sym) && g.prevCenter?.s.includes(sym) && now - g.changedAt < 450) return g.onResult(pid, 'stale', sym);
    const { state, result } = apply(st, { type: 'tap', playerId: pid, symbol: sym, rev: st.rev, now, cardId });
    if (state !== st && state.rev !== st.rev) { g.prevCenter = st.center; g.changedAt = now; }
    g.state = state;
    g.onResult(pid, result, sym);
  };
  for (const h of humans) { h.cursor = 0; h.el._g = g; h.el._h = h; }
  g.pileOf = h => g.state.players.find(x => x.id === h.id).pile;
  g.renderHumans = () => {
    for (const h of g.humans) {
      const pile = g.pileOf(h);
      h.cursor = Math.min(h.cursor, Math.max(0, pile.length - 1));
      if (paintCard(h.el, pile[h.cursor], g.seed, true) && !h.sliding) pulse(h.el, 'in');
      h.sliding = false;
      h.nav.querySelector('.pos').textContent = pile.length ? h.cursor + 1 : 0;
      h.nav.querySelector('.tot').textContent = pile.length;
      h.nav.querySelectorAll('button').forEach(b => { b.disabled = pile.length <= 1; });
    }
  };
  g.navigate = (h, d) => {
    const len = g.pileOf(h).length;
    if (len <= 1) return;
    h.cursor = (h.cursor + d + len) % len;
    h.sliding = true;
    g.renderHumans();
    pulse(h.el, d > 0 ? 'slideL' : 'slideR');
  };
  g.tapHuman = (h, sym) => {
    const card = g.pileOf(h)[h.cursor];
    if (card) g.tap(h.id, sym, card.id);
  };
  g.paintCenter = () => {
    const changed = paintCard(centerEl, g.state.center, g.seed, null);
    if (changed && g.state.last) {
      pulse(centerEl, 'in');
      const s = symEl(centerEl, g.state.last.symbol); if (s) pulse(s, 'glow');
    }
  };
  g.updateLocks = () => {
    const now = g.now();
    for (const h of g.humans) {
      const p = g.state.players.find(x => x.id === h.id);
      const lock = h.el.querySelector('.lock');
      const left = p.lockUntil - now;
      lock.hidden = left <= 0;
      if (left > 0) lock.firstElementChild.textContent = Math.ceil(left / 1000);
    }
  };
  g.countdown = async (startAt) => {
    const cd = $('countdown'), sp = cd.firstElementChild;
    cd.hidden = false;
    if (startAt && g.now() > startAt + 500) { cd.hidden = true; return; } // te uniste con la partida en curso
    if (startAt) { // en línea: todos arrancan a la misma hora del servidor
      const wait = startAt - g.now() - 2600;
      if (wait > 0) { sp.textContent = '…'; await new Promise(r => setTimeout(r, Math.min(wait, 8000))); }
    }
    for (const n of ['3', '2', '1', '¡YA!']) { sp.textContent = n; pulse(sp, 'x'); sp.style.animation = 'none'; void sp.offsetWidth; sp.style.animation = ''; await new Promise(r => setTimeout(r, 650)); }
    cd.hidden = true;
  };
  g.begin = async () => {
    show(screenId);
    g.render();
    await g.countdown(g.startAt);
    if (G !== g) return;
    g.playing = true;
    g.ticker = setInterval(g.updateLocks, 100);
    g.afterStart?.();
  };
  g.stop = () => {
    g.playing = false;
    clearInterval(g.ticker);
    g.timers.forEach(clearTimeout); g.timers = [];
  };
  g.finish = (winnerId) => {
    g.stop();
    const w = g.state.players.find(p => p.id === winnerId);
    setTimeout(() => {
      g.endText?.(w);
      $('dlgEnd').showModal();
    }, 700);
  };
  return g;
}

function botGame() {
  const me = { id: 'me', name: $('name').value.trim() || 'Tú' };
  const bots = BOT_NAMES.slice(0, opts.bots).map((n, i) => ({ id: 'bot' + i, name: n }));
  const myEl = $('myCard');
  const g = baseGame(newGame([me, ...bots], opts.deck, Math.floor(Math.random() * 1e9)), [{ id: 'me', el: myEl, nav: $('nav0') }], 'game', $('centerCard'));
  const lvl = BOT_LEVEL[opts.level], speed = DECK_SPEED[opts.deck];
  $('myName').textContent = me.name;
  $('lastMsg').innerHTML = '&nbsp;';
  ['in', 'shake'].forEach(c => myEl.classList.remove(c));
  myEl.dataset.cid = ''; $('centerCard').dataset.cid = '';

  g.render = () => {
    const st = g.state;
    g.paintCenter();
    g.renderHumans();
    const now = Date.now();
    $('opps').innerHTML = st.players.slice(1).map(p =>
      `<span class="opp${p.lockUntil > now ? ' locked' : ''}" data-id="${p.id}">${p.name} <b>${p.pile.length}</b></span>`).join('');
  };

  function scheduleBots() {
    g.timers.forEach(clearTimeout); g.timers = [];
    for (const b of bots) scheduleBot(b, 0);
  }
  function scheduleBot(b, extra) {
    const delay = (lvl.min + Math.random() * (lvl.max - lvl.min)) * speed + extra;
    g.timers.push(setTimeout(() => {
      if (!g.playing) return;
      const p = g.state.players.find(x => x.id === b.id);
      const now = Date.now();
      if (p.lockUntil > now) return scheduleBot(b, p.lockUntil - now);
      const top = p.pile[0];
      const good = sharedSymbol(top.s, g.state.center.s);
      const wrong = top.s.filter(s => s !== good);
      const sym = Math.random() < lvl.err ? wrong[Math.floor(Math.random() * wrong.length)] : good;
      g.tap(b.id, sym);
    }, delay));
  }
  g.afterStart = scheduleBots;

  g.onResult = (pid, result, sym) => {
    const isMe = pid === 'me';
    const name = g.state.players.find(p => p.id === pid).name;
    if (result === 'ok' || result === 'win') {
      if (isMe) { const s = symEl(myEl, sym); if (s) pulse(s, 'hit'); }
      $('lastMsg').textContent = isMe ? `¡Chapaste ${SYMBOLS[sym].e}!` : `${name} chapó ${SYMBOLS[sym].e}`;
      g.render();
      if (!isMe) { const chip = document.querySelector(`.opp[data-id="${pid}"]`); if (chip) pulse(chip, 'flash'); }
      if (result === 'win') return g.finish(pid);
      scheduleBots();
    } else if (result === 'wrong') {
      if (isMe) { pulse(myEl, 'shake'); navigator.vibrate?.(120); g.updateLocks(); }
      g.render();
    } else if (result === 'stale' && isMe) toast('¡Te ganaron! Busca de nuevo');
  };
  g.endText = w => {
    const meP = g.state.players[0];
    $('endTitle').textContent = w.id === 'me' ? '¡Ganaste!' : `¡Ganó ${w.name}!`;
    $('endText').textContent = w.id === 'me'
      ? `Te quedaste sin cartas primero. Mazo ${DECKS[opts.deck].label}, nivel ${opts.level}.`
      : `Te quedaron ${meP.pile.length} de ${g.state.perCard} cartas. ¡Revancha!`;
  };
  return g;
}

function duelGame() {
  const players = [{ id: 'p1', name: 'Jugador 1' }, { id: 'p2', name: 'Jugador 2' }];
  const c1 = $('card1'), c2 = $('card2'), cc = $('centerDuel');
  [c1, c2, cc].forEach(el => { el.dataset.cid = ''; });
  const g = baseGame(newGame(players, opts.deck, Math.floor(Math.random() * 1e9)), [{ id: 'p1', el: c1, nav: $('nav1') }, { id: 'p2', el: c2, nav: $('nav2'), flip: true }], 'duel', cc);
  g.render = () => {
    g.paintCenter();
    g.renderHumans();
  };
  g.onResult = (pid, result, sym) => {
    const el = pid === 'p1' ? c1 : c2;
    if (result === 'ok' || result === 'win') {
      const s = symEl(el, sym); if (s) pulse(s, 'hit');
      g.render();
      if (result === 'win') return g.finish(pid);
    } else if (result === 'wrong') { pulse(el, 'shake'); navigator.vibrate?.(120); g.updateLocks(); }
    else if (result === 'stale') toast(`¡${pid === 'p1' ? 'Jugador 2' : 'Jugador 1'} fue más rápido!`);
  };
  g.endText = w => {
    const other = g.state.players.find(p => p.id !== w.id);
    $('endTitle').textContent = `¡Ganó ${w.name}!`;
    $('endText').textContent = `A ${other.name} le quedaron ${other.pile.length} cartas.`;
  };
  return g;
}

// ---------------- Toques, deslizar y flechas ----------------
// Tocar un símbolo = jugar. Deslizar a los lados = pasar de carta.
const starts = new Map();
for (const [cardId, navId] of [['myCard', 'nav0'], ['card1', 'nav1'], ['card2', 'nav2']]) {
  const el = $(cardId);
  el.addEventListener('pointerdown', e => {
    if (!el._g?.playing) return;
    e.preventDefault();
    starts.set(e.pointerId, { x: e.clientX, y: e.clientY, sym: e.target.closest('.sym')?.dataset.sym });
  });
  el.addEventListener('pointerup', e => {
    const s = starts.get(e.pointerId); starts.delete(e.pointerId);
    if (!s || !el._g?.playing) return;
    let dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (el._h.flip) { dx = -dx; dy = -dy; }
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) el._g.navigate(el._h, dx < 0 ? 1 : -1);
    else if (s.sym != null && Math.hypot(dx, dy) < 30) el._g.tapHuman(el._h, Number(s.sym));
  });
  el.addEventListener('pointercancel', e => starts.delete(e.pointerId));
  $(navId).querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => { if (el._g?.playing) el._g.navigate(el._h, Number(b.dataset.d)); }));
}
document.addEventListener('keydown', e => {
  const h = $('myCard')._h, g = $('myCard')._g;
  if (!g?.playing || G !== g) return;
  if (e.key === 'ArrowRight') g.navigate(h, 1);
  if (e.key === 'ArrowLeft') g.navigate(h, -1);
});

// ---------------- Fin / salir ----------------
$('again').onclick = () => { $('dlgEnd').close(); if (G?.online) rematch(); else start(); };
$('menu').onclick = () => { $('dlgEnd').close(); G?.stop(); if (R.code) leaveRoom(); else show('lobby'); };
$('quit').onclick = $('quitDuel').onclick = () => { G?.stop(); G = null; $('countdown').hidden = true; if (R.code) leaveRoom(); else show('lobby'); };

// ================= EN LÍNEA =================
const R = { api: null, code: null, room: null, unsub: null };
const FAKE_Q = new URLSearchParams(location.search).has('fake') ? 'fake=1' : '';

function updateModeUI() {
  $('botsOpts').hidden = opts.mode !== 'bots';
  $('onlineOpts').hidden = opts.mode !== 'online';
  $('play').hidden = opts.mode === 'online';
  if (opts.mode === 'online' && !onlineAvailable()) $('onlineHint').textContent = 'El modo en línea se activa cuando conectemos el Firebase del juego.';
}
function myName() { return $('name').value.trim() || 'Jugador'; }
function roomUrl(code) { return location.origin + location.pathname + '?sala=' + code + (FAKE_Q ? '&' + FAKE_Q : ''); }
async function api() {
  if (!onlineAvailable()) { toast('El modo en línea aún no está conectado', 2500); return null; }
  try { R.api = await connect(); return R.api; }
  catch (e) { toast('No se pudo conectar: ' + e.message, 4000); return null; }
}
function busy(on) { ['createRoom', 'joinRoom'].forEach(id => { $(id).disabled = on; }); }

$('createRoom').onclick = async () => {
  busy(true);
  try {
    const a = await api(); if (!a) return;
    store.set('chapalo.name', $('name').value.trim());
    const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code;
    for (let i = 0; i < 6; i++) {
      code = Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join('');
      if (!(await a.get(code))) break;
    }
    await a.set(code, {
      host: a.uid, status: 'lobby', deck: opts.deck, createdAt: a.serverTime(),
      players: { [a.uid]: { name: myName(), joinedAt: a.serverTime() } },
    });
    enterRoom(code);
  } catch (e) { toast('Error al crear la sala: ' + e.message, 4000); }
  finally { busy(false); }
};

$('joinRoom').onclick = () => joinRoom($('joinCode').value);
$('joinCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(e.target.value); });

async function joinRoom(raw) {
  const code = String(raw || '').toUpperCase().trim();
  if (!/^[A-Z]{4}$/.test(code)) return toast('El código tiene 4 letras');
  busy(true);
  try {
    const a = await api(); if (!a) return;
    store.set('chapalo.name', $('name').value.trim());
    const room = await a.get(code);
    if (!room) return toast('No existe la sala ' + code, 2500);
    const inside = room.players && room.players[a.uid];
    if (!inside) {
      if (room.status !== 'lobby') return toast('Esa partida ya empezó. Pide que te esperen en la revancha.', 3000);
      if (Object.keys(room.players || {}).length >= 8) return toast('La sala está llena (8 jugadores)', 2500);
      await a.set(`${code}/players/${a.uid}`, { name: myName(), joinedAt: a.serverTime() });
    }
    enterRoom(code);
  } catch (e) { toast('No se pudo entrar: ' + e.message, 4000); }
  finally { busy(false); }
}

function enterRoom(code) {
  R.code = code;
  history.replaceState(null, '', '?sala=' + code + (FAKE_Q ? '&' + FAKE_Q : ''));
  $('roomCode').textContent = code;
  show('room');
  R.unsub?.();
  R.unsub = R.api.listen(code, onRoom);
}

function leaveRoom() {
  const a = R.api, code = R.code, room = R.room;
  R.unsub?.(); R.unsub = null; R.code = null; R.room = null;
  if (a && code && room?.status === 'lobby') { a.cancelOnDisconnect(`${code}/players/${a.uid}`); a.remove(`${code}/players/${a.uid}`); }
  if (G?.online) { G.stop(); G = null; }
  history.replaceState(null, '', location.pathname + (FAKE_Q ? '?' + FAKE_Q : ''));
  show('lobby');
}
$('leaveRoom').onclick = leaveRoom;

$('shareRoom').onclick = async () => {
  const url = roomUrl(R.code);
  const text = `¡Juguemos ¡Chápalo!! Entra a la sala ${R.code}`;
  try {
    if (navigator.share) await navigator.share({ title: '¡Chápalo!', text, url });
    else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
  } catch { /* el usuario canceló */ }
};

$('roomDeckSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (R.room?.host === R.api?.uid && R.room.status === 'lobby') R.api.update(R.code, { deck: b.dataset.v });
}));

$('startOnline').onclick = () => {
  const room = R.room; if (!room) return;
  const list = Object.entries(room.players || {})
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))
    .map(([id, p]) => ({ id, name: p.name }));
  if (list.length < 2) return toast('Se necesitan al menos 2 jugadores');
  launch(list, room.deck);
};

function launch(list, deck) {
  const st = newGame(list, deck, Math.floor(Math.random() * 1e9));
  return R.api.update(R.code, { status: 'playing', game: st, startAt: R.api.now() + 3800 });
}
function rematch() {
  const st = G.state;
  launch(st.players.map(p => ({ id: p.id, name: p.name })), st.deck);
}

function onRoom(room) {
  if (!R.code) return;
  if (!room) { toast('La sala se cerró', 2500); return leaveRoom(); }
  R.room = room;
  const uid = R.api.uid, isHost = room.host === uid;
  const players = Object.entries(room.players || {}).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  $('plist').innerHTML = players.map(([id, p]) =>
    `<li><span>${esc(p.name)}${id === uid ? ' (tú)' : ''}</span>${id === room.host ? '<small>ANFITRIÓN</small>' : ''}</li>`).join('');
  $('pcount').textContent = `(${players.length}/8)`;
  $('roomDeckSeg').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.v === room.deck); b.disabled = !isHost; });
  $('startOnline').hidden = !isHost;
  $('startOnline').disabled = players.length < 2;
  $('startOnline').textContent = players.length < 2 ? 'Esperando jugadores…' : '¡Empezar!';
  $('roomWait').hidden = isHost;

  if (room.status === 'lobby') R.api.removeOnDisconnect(`${R.code}/players/${uid}`);
  if (room.status === 'playing' && room.game) {
    R.api.cancelOnDisconnect(`${R.code}/players/${uid}`);
    const st = normalize(room.game);
    if (!st.players.some(p => p.id === uid)) { $('roomWait').hidden = false; $('roomWait').textContent = 'Hay una partida en curso. Entras en la revancha.'; return; }
    if (G?.online && G.seed === st.seed) G.sync(st);
    else { if ($('dlgEnd').open) $('dlgEnd').close(); startOnline(st, room.startAt); }
  }
}

function esc(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Firebase quita arreglos vacíos y nulls: se restauran aquí.
function arr(v) { return Array.isArray(v) ? v : v ? Object.values(v) : []; }
function card(c) { return c ? { id: c.id ?? 0, s: arr(c.s) } : null; }
function normalize(g) {
  return {
    ...g,
    rev: g.rev || 0,
    center: card(g.center),
    players: arr(g.players).map(p => ({ id: p.id, name: p.name, pile: arr(p.pile).map(card), lockUntil: p.lockUntil || 0 })),
    last: g.last || null,
    winner: g.winner ?? null,
    status: g.status || 'playing',
  };
}

function startOnline(st, startAt) {
  if (G) G.stop();
  const a = R.api, uid = a.uid, myEl = $('myCard');
  myEl.dataset.cid = ''; $('centerCard').dataset.cid = '';
  ['in', 'shake'].forEach(c => myEl.classList.remove(c));
  const g = baseGame(st, [{ id: uid, el: myEl, nav: $('nav0') }], 'game', $('centerCard'));
  G = g;
  g.online = true; g.now = a.now; g.startAt = startAt;
  $('myName').textContent = st.players.find(p => p.id === uid).name;
  $('lastMsg').innerHTML = '&nbsp;';

  g.render = () => {
    g.paintCenter();
    g.renderHumans();
    const now = g.now();
    $('opps').innerHTML = g.state.players.filter(p => p.id !== uid).map(p =>
      `<span class="opp${p.lockUntil > now ? ' locked' : ''}" data-id="${p.id}">${esc(p.name)} <b>${p.pile.length}</b></span>`).join('');
  };
  g.tap = async (pid, sym, cardId) => {
    if (!g.playing) return;
    const rev = g.state.rev;
    let result = 'ignored';
    try {
      await a.transact(`${R.code}/game`, cur => {
        if (cur == null) return cur;
        const s0 = normalize(cur);
        const r = apply(s0, { type: 'tap', playerId: uid, symbol: sym, rev, now: a.now(), cardId });
        result = r.result;
        return r.state === s0 ? undefined : r.state;
      });
    } catch (e) { return toast('Sin conexión: ' + e.message, 2500); }
    if (result === 'wrong') { pulse(myEl, 'shake'); navigator.vibrate?.(120); }
    else if (result === 'stale') toast('¡Te ganaron! Busca de nuevo');
  };
  g.sync = st2 => {
    const old = g.state;
    g.state = st2;
    if (st2.rev !== old.rev && st2.last) {
      const who = st2.players.find(p => p.id === st2.last.playerId);
      const e = SYMBOLS[st2.last.symbol]?.e || '';
      $('lastMsg').textContent = st2.last.playerId === uid ? `¡Chapaste ${e}!` : `${who?.name || 'Alguien'} chapó ${e}`;
    }
    g.render(); g.updateLocks();
    if (st2.rev !== old.rev && st2.last && st2.last.playerId !== uid) {
      const chip = document.querySelector(`.opp[data-id="${st2.last.playerId}"]`); if (chip) pulse(chip, 'flash');
    }
    if (st2.status === 'over' && !g.ended) { g.ended = true; g.finish(st2.winner); }
  };
  g.onResult = () => {};
  g.endText = w => {
    const me = g.state.players.find(p => p.id === uid);
    $('endTitle').textContent = w.id === uid ? '¡Ganaste!' : `¡Ganó ${w.name}!`;
    $('endText').textContent = w.id === uid ? 'Te quedaste sin cartas primero.' : `Te quedaron ${me.pile.length} de ${g.state.perCard} cartas.`;
  };
  g.begin();
  if (st.status === 'over') { g.ended = true; g.finish(st.winner); }
}

// Entrar directo con un enlace ?sala=CODIGO
(() => {
  const q = new URLSearchParams(location.search).get('sala');
  updateModeUI();
  if (!q) return;
  opts.mode = 'online';
  $('modeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === 'online'));
  updateModeUI();
  $('joinCode').value = q.toUpperCase();
  if ($('name').value.trim()) joinRoom(q);
  else { $('onlineHint').textContent = 'Escribe tu nombre y toca Unirme.'; $('name').focus(); }
})();
