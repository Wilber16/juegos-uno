// Pruebas del motor: node chapalo/test-engine.mjs
import assert from 'node:assert/strict';
import { buildCards, sharedSymbol, newGame, apply, DECKS, PENALTY_MS } from './engine.js';

// 1. Cada par de cartas comparte exactamente un símbolo
for (const [key, cfg] of Object.entries(DECKS)) {
  const cards = buildCards(cfg.p);
  assert.equal(cards.length, cfg.p * cfg.p + cfg.p + 1, key + ': cantidad de cartas');
  for (const c of cards) assert.equal(new Set(c).size, cfg.symbols, key + ': símbolos por carta');
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++)
      assert.equal(cards[i].filter(s => cards[j].includes(s)).length, 1, `${key}: cartas ${i} y ${j}`);
}

// 2. Reparto parejo, sin cartas repetidas
for (const n of [2, 3, 4, 5, 6, 7, 8]) {
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'J' + i }));
  for (const deck of Object.keys(DECKS)) {
    const g = newGame(players, deck, 42 + n);
    const sizes = g.players.map(p => p.pile.length);
    assert.ok(sizes.every(s => s === sizes[0] && s > 0), `${deck}/${n}: reparto parejo`);
    const ids = [g.center.id, ...g.players.flatMap(p => p.pile.map(c => c.id))];
    assert.equal(new Set(ids).size, ids.length, 'sin cartas repetidas');
  }
}

// 3. Misma semilla = mismo reparto (necesario para el modo en línea)
const two = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
assert.deepEqual(newGame(two, 'rapido', 7), newGame(two, 'rapido', 7));

// 4. Jugada correcta, fallo con bloqueo, toque viejo y victoria
let g = newGame(two, 'mini', 1);
let t = 1000;
const wrongSym = g.players[0].pile[0].s.find(s => !g.center.s.includes(s));
let r = apply(g, { type: 'tap', playerId: 'a', symbol: wrongSym, rev: g.rev, now: t });
assert.equal(r.result, 'wrong');
assert.equal(r.state.players[0].lockUntil, t + PENALTY_MS);
g = r.state;
const good = sharedSymbol(g.players[0].pile[0].s, g.center.s);
assert.equal(apply(g, { type: 'tap', playerId: 'a', symbol: good, rev: g.rev, now: t + 500 }).result, 'locked');

// b acierta; luego el toque de a con la revisión anterior queda como "stale"
const goodB = sharedSymbol(g.players[1].pile[0].s, g.center.s);
const oldRev = g.rev;
r = apply(g, { type: 'tap', playerId: 'b', symbol: goodB, rev: g.rev, now: t + 600 });
assert.equal(r.result, 'ok');
g = r.state;
assert.equal(g.rev, oldRev + 1);
assert.equal(apply(g, { type: 'tap', playerId: 'a', symbol: good, rev: oldRev, now: t + 3000 }).result, 'stale');

// Jugar hasta el final solo con aciertos de b
while (g.status === 'playing') {
  const s = sharedSymbol(g.players[1].pile[0].s, g.center.s);
  r = apply(g, { type: 'tap', playerId: 'b', symbol: s, rev: g.rev, now: t });
  g = r.state;
}
assert.equal(r.result, 'win');
assert.equal(g.winner, 'b');
assert.equal(apply(g, { type: 'tap', playerId: 'a', symbol: 0, rev: g.rev, now: t }).result, 'ignored');

console.log('OK: todas las pruebas del motor pasaron');
