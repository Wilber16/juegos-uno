// ¡Chápalo! — motor de reglas puro (sin DOM ni red).
// El mismo motor sirve para el modo local y, más adelante, para Firebase:
// el estado es un objeto JSON plano y apply() devuelve un estado nuevo.

export const PENALTY_MS = 2000;

// Tamaños de mazo: p = símbolos por carta - 1 (debe ser primo).
export const DECKS = {
  mini:    { p: 3, label: 'Mini',    symbols: 4, cards: 13 },
  rapido:  { p: 5, label: 'Rápido',  symbols: 6, cards: 31 },
  clasico: { p: 7, label: 'Clásico', symbols: 8, cards: 55 }, // 57 posibles, se usan 55 como el original
};

// Plano proyectivo de orden p: p²+p+1 cartas, cada par comparte exactamente 1 símbolo.
export function buildCards(p) {
  const cards = [];
  for (let i = 0; i <= p; i++) {
    const c = [0];
    for (let j = 0; j < p; j++) c.push(1 + i * p + j);
    cards.push(c);
  }
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      const c = [i + 1];
      for (let k = 0; k < p; k++) c.push(p + 1 + p * k + ((i * k + j) % p));
      cards.push(c);
    }
  }
  return cards;
}

export function sharedSymbol(a, b) {
  return a.find(s => b.includes(s));
}

// Generador pseudoaleatorio con semilla (para que todos los dispositivos repartan igual).
export function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// players: [{id, name}]. Reparte todo, pone una carta al centro y descarta sobrantes
// para que todos empiecen con la misma cantidad.
export function newGame(players, deckKey = 'rapido', seed = Date.now()) {
  const cfg = DECKS[deckKey];
  if (!cfg) throw new Error('Mazo desconocido: ' + deckKey);
  if (players.length < 2) throw new Error('Se necesitan al menos 2 jugadores');
  const rand = rng(seed);
  const all = buildCards(cfg.p).map((symbols, id) => ({ id, s: shuffle(symbols, rand) }));
  const cards = shuffle(all, rand).slice(0, cfg.cards);
  const center = cards.pop();
  const each = Math.floor(cards.length / players.length);
  const ps = players.map((pl, i) => ({
    id: pl.id,
    name: pl.name,
    pile: cards.slice(i * each, (i + 1) * each),
    lockUntil: 0,
  }));
  return {
    deck: deckKey,
    seed,
    rev: 0,              // sube cada vez que cambia la carta del centro
    center,
    players: ps,
    status: 'playing',
    winner: null,
    last: null,          // {playerId, symbol, rev} última jugada ganada
    perCard: each,
  };
}

// action: {type:'tap', playerId, symbol, rev, now}
// Devuelve {state, result} con result: 'ok' | 'win' | 'wrong' | 'stale' | 'locked' | 'ignored'
export function apply(state, action) {
  if (state.status !== 'playing' || action.type !== 'tap') return { state, result: 'ignored' };
  const idx = state.players.findIndex(p => p.id === action.playerId);
  if (idx < 0) return { state, result: 'ignored' };
  const me = state.players[idx];
  const now = action.now ?? Date.now();
  if (now < me.lockUntil) return { state, result: 'locked' };
  if (action.rev !== state.rev) return { state, result: 'stale' }; // el centro cambió antes de tu toque
  const top = me.pile[0];
  if (!top || !top.s.includes(action.symbol)) return { state, result: 'ignored' };

  const players = state.players.slice();
  if (!state.center.s.includes(action.symbol)) {
    players[idx] = { ...me, lockUntil: now + PENALTY_MS };
    return { state: { ...state, players }, result: 'wrong' };
  }
  const pile = me.pile.slice(1);
  players[idx] = { ...me, pile };
  const next = {
    ...state,
    players,
    center: top,
    rev: state.rev + 1,
    last: { playerId: me.id, symbol: action.symbol, rev: state.rev + 1 },
  };
  if (pile.length === 0) {
    next.status = 'over';
    next.winner = me.id;
    return { state: next, result: 'win' };
  }
  return { state: next, result: 'ok' };
}

export function topCard(state, playerId) {
  const p = state.players.find(x => x.id === playerId);
  return p ? p.pile[0] : null;
}
