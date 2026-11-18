import { newGame, apply, sharedSymbol, rng, DECKS } from './engine.js';
import { SYMBOLS } from './symbols.js';

const $ = id => document.getElementById(id);
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
      if (key === 'mode') $('botsOpts').hidden = opts.mode !== 'bots';
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

function baseGame(players, humans, screenId, centerEl) {
  const seed = Math.floor(Math.random() * 1e9);
  const g = {
    state: newGame(players, opts.deck, seed),
    seed, humans, timers: [], ticker: null, playing: false,
    prevCenter: null, changedAt: 0,
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
    const now = Date.now();
    for (const h of g.humans) {
      const p = g.state.players.find(x => x.id === h.id);
      const lock = h.el.querySelector('.lock');
      const left = p.lockUntil - now;
      lock.hidden = left <= 0;
      if (left > 0) lock.firstElementChild.textContent = Math.ceil(left / 1000);
    }
  };
  g.countdown = async () => {
    const cd = $('countdown'), sp = cd.firstElementChild;
    cd.hidden = false;
    for (const n of ['3', '2', '1', '¡YA!']) { sp.textContent = n; pulse(sp, 'x'); sp.style.animation = 'none'; void sp.offsetWidth; sp.style.animation = ''; await new Promise(r => setTimeout(r, 650)); }
    cd.hidden = true;
  };
  g.begin = async () => {
    show(screenId);
    g.render();
    await g.countdown();
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
  const g = baseGame([me, ...bots], [{ id: 'me', el: myEl, nav: $('nav0') }], 'game', $('centerCard'));
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
  const g = baseGame(players, [{ id: 'p1', el: c1, nav: $('nav1') }, { id: 'p2', el: c2, nav: $('nav2'), flip: true }], 'duel', cc);
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
$('again').onclick = () => { $('dlgEnd').close(); start(); };
$('menu').onclick = () => { $('dlgEnd').close(); G?.stop(); show('lobby'); };
$('quit').onclick = $('quitDuel').onclick = () => { G?.stop(); G = null; $('countdown').hidden = true; show('lobby'); };
