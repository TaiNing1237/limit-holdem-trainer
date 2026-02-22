// range.js — Bayesian hand-range tracker for AI seats
// Loaded after ai.js (uses chenScore, preflopRaiseProb, preflopCallProb, positionBonus)
// Loaded before solver.js

// ── Hand-type index (169 abstract types) ────────────────────────────────────
// Pairs:   indices  0–12  (22=0, 33=1, …, AA=12),   6 combos each
// Suited:  indices 13–90  (AKs=13, …, 32s=90),      4 combos each
// Offsuit: indices 91–168 (AKo=91, …, 32o=168),    12 combos each

const HAND_TYPES = [];        // { r1, r2, suited, combos }
const HAND_TYPE_MAP = [];     // [r1][r2][suitedInt] → HAND_TYPES index  (r1 >= r2)

(function buildHandTypes() {
  // Initialise 3-D map skeleton
  for (let r = 0; r < 13; r++) {
    HAND_TYPE_MAP[r] = [];
    for (let k = 0; k < 13; k++) {
      HAND_TYPE_MAP[r][k] = [null, null]; // [0]=offsuit, [1]=suited
    }
  }

  // ── 0–12: Pairs (22=0 … AA=12) ──
  for (let r = 0; r < 13; r++) {
    HAND_TYPES[r] = { r1: r, r2: r, suited: false, combos: 6 };
    HAND_TYPE_MAP[r][r][0] = r;
    HAND_TYPE_MAP[r][r][1] = r;
  }

  // ── 13–90: Suited (r1>r2), high card descending then kicker descending ──
  // Order: AKs(13) … A2s(24), KQs(25) … K2s(35), … 32s(90)
  let idx = 13;
  for (let h = 12; h >= 1; h--) {
    for (let k = h - 1; k >= 0; k--) {
      HAND_TYPES[idx] = { r1: h, r2: k, suited: true, combos: 4 };
      HAND_TYPE_MAP[h][k][1] = idx;
      idx++;
    }
  }
  // idx === 91 here

  // ── 91–168: Offsuit (r1>r2), same ordering ──
  for (let h = 12; h >= 1; h--) {
    for (let k = h - 1; k >= 0; k--) {
      HAND_TYPES[idx] = { r1: h, r2: k, suited: false, combos: 12 };
      HAND_TYPE_MAP[h][k][0] = idx;
      idx++;
    }
  }
  // idx === 169
})();

// ── Per-seat state ───────────────────────────────────────────────────────────
const _weights = [];  // _weights[seat]      = Float64Array(169), init = combo counts
const _actionCount = [];  // _actionCount[seat]  = number of actions observed
const _hasAggressed = [];  // _hasAggressed[seat] = true once a bet/raise is seen

// ── Helpers ──────────────────────────────────────────────────────────────────

function _aliveSeats(game) {
  const alive = [];
  for (let j = 0; j < game.numPlayers; j++) {
    if (!game.eliminated || !game.eliminated[j]) alive.push(j);
  }
  return alive;
}

// Representative cards for an abstract hand type
function _repCards(r1, r2, isPair, isSuited) {
  if (isPair) return [r1 * 4 + 0, r1 * 4 + 1]; // As, Ah
  if (isSuited) return [r1 * 4 + 0, r2 * 4 + 0]; // both spades
  return [r1 * 4 + 0, r2 * 4 + 1];       // spade + heart
}

function _preflopLikelihood(label, r1, r2, isPair, isSuited, game, seat) {
  const [c1, c2] = _repCards(r1, r2, isPair, isSuited);
  const score = chenScore(c1, c2);
  const posBonus = positionBonus(seat, game.dealerSeat, _aliveSeats(game));
  const rProb = preflopRaiseProb(score, posBonus);
  const cProb = preflopCallProb(score, posBonus);
  const fProb = Math.max(0, 1 - rProb - cProb);
  const lc = label.toLowerCase();
  if (lc === 'fold') return fProb;
  if (lc.startsWith('bet') || lc.startsWith('raise')) return rProb;
  return cProb; // call / check
}

// Board-aware postflop likelihood: uses evalBest to determine actual hand
// strength on the current board, giving much more accurate range narrowing.
function _postflopLikelihood(label, r1, r2, isPair, isSuited, board) {
  const [c1, c2] = _repCards(r1, r2, isPair, isSuited);

  // Check if rep cards conflict with board
  const boardSet = new Set(board);
  if (boardSet.has(c1) || boardSet.has(c2)) {
    // Try alternative suit combos
    let found = false;
    for (let s1 = 0; s1 < 4 && !found; s1++) {
      const alt1 = r1 * 4 + s1;
      if (boardSet.has(alt1)) continue;
      const s2Start = isPair ? s1 + 1 : 0;
      for (let s2 = s2Start; s2 < 4 && !found; s2++) {
        if (isSuited && s2 !== s1) continue;
        if (!isSuited && !isPair && s2 === s1) continue;
        const alt2 = r2 * 4 + s2;
        if (boardSet.has(alt2)) continue;
        // Use these alternative cards — just need the eval
        const ev = evalBest([alt1, alt2, ...board]);
        if (ev) {
          found = true;
          return _likelihoodFromEval(label, ev);
        }
      }
    }
    return 0.3; // fallback if all suits blocked
  }

  const ev = evalBest([c1, c2, ...board]);
  if (!ev) return 0.3;
  return _likelihoodFromEval(label, ev);
}

// Convert hand evaluation + action into a likelihood probability
function _likelihoodFromEval(label, ev) {
  const lc = label.toLowerCase();
  const isAggress = lc.startsWith('bet') || lc.startsWith('raise');
  const isFold = lc === 'fold';
  const cat = ev.categoryIndex;

  // categoryIndex: 0=HC,1=1P,2=2P,3=3K,4=ST,5=FL,6=FH,7=4K,8=SF,9=RF
  if (cat >= 6) {
    // Monster (FH, Quads, SF, RF): very likely to raise/call, never fold
    return isAggress ? 0.85 : isFold ? 0.02 : 0.70;
  } else if (cat >= 4) {
    // Strong (Straight, Flush): often raise, rarely fold
    return isAggress ? 0.70 : isFold ? 0.05 : 0.65;
  } else if (cat === 3) {
    // Trips: raise or call, unlikely fold
    return isAggress ? 0.60 : isFold ? 0.08 : 0.60;
  } else if (cat === 2) {
    // Two pair: moderately aggressive
    return isAggress ? 0.50 : isFold ? 0.12 : 0.55;
  } else if (cat === 1) {
    // One pair: depends on pair strength (top pair vs bottom pair)
    // Use score within category as rough indicator
    return isAggress ? 0.30 : isFold ? 0.25 : 0.55;
  } else {
    // High card: rarely bets, often folds
    return isAggress ? 0.10 : isFold ? 0.65 : 0.35;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

const _raiseCount = {};  // per-seat raise counter for acceleration

function resetAll(numPlayers) {
  for (let s = 0; s < numPlayers; s++) {
    const w = new Float64Array(169);
    for (let i = 0; i < 169; i++) w[i] = HAND_TYPES[i].combos;
    _weights[s] = w;
    _actionCount[s] = 0;
    _hasAggressed[s] = false;
    _raiseCount[s] = 0;
  }
}

// Call after every game.applyAction()
function update(game) {
  const history = game.actionHistory;
  if (!history || history.length === 0) return;
  const e = history[history.length - 1];
  const seat = e.seat;
  if (seat === (game.playerSeat ?? POS.PLAYER)) return;  // skip human player
  if (seat < 0 || seat >= game.numPlayers) return;
  if (!_weights[seat]) return;
  if (game.eliminated && game.eliminated[seat]) return;

  const lc = e.label.toLowerCase();
  const isAggress = lc.startsWith('bet') || lc.startsWith('raise');
  if (isAggress) {
    _hasAggressed[seat] = true;
    _raiseCount[seat] = (_raiseCount[seat] || 0) + 1;
  }

  const isPreflop = (e.street === STREET.PREFLOP);
  const w = _weights[seat];

  // Raise acceleration: repeated raises apply a power multiplier
  // so weak hands shrink exponentially faster (tuned down for realism)
  const raisePow = isAggress ? 1 + (_raiseCount[seat] - 1) * 0.15 : 1;

  for (let i = 0; i < 169; i++) {
    if (w[i] < 1e-10) continue;
    const { r1, r2, suited } = HAND_TYPES[i];
    const isPair = r1 === r2;
    const p = isPreflop
      ? _preflopLikelihood(e.label, r1, r2, isPair, suited, game, seat)
      : _postflopLikelihood(e.label, r1, r2, isPair, suited, game.board);
    w[i] *= Math.pow(p, raisePow);
  }

  // Normalise by max weight to prevent underflow
  let maxW = 0;
  for (let i = 0; i < 169; i++) if (w[i] > maxW) maxW = w[i];
  if (maxW > 1e-10) {
    for (let i = 0; i < 169; i++) w[i] /= maxW;
  }
  _actionCount[seat]++;
}

// Returns [card1, card2] sampled proportional to range weights, or null
function sampleHand(seat, excludedCards) {
  if (!_weights[seat]) return null;
  const excluded = new Set(excludedCards);
  const w = _weights[seat];

  const items = [];      // [weight, card1, card2]
  let totalWeight = 0;

  for (let i = 0; i < 169; i++) {
    if (w[i] < 1e-9) continue;
    const { r1, r2, suited } = HAND_TYPES[i];
    const wt = w[i];
    const isPair = r1 === r2;

    if (isPair) {
      // 6 combos: all pairs of 4 suits
      for (let s1 = 0; s1 < 4; s1++) {
        for (let s2 = s1 + 1; s2 < 4; s2++) {
          const c1 = r1 * 4 + s1, c2 = r1 * 4 + s2;
          if (!excluded.has(c1) && !excluded.has(c2)) {
            items.push([wt, c1, c2]);
            totalWeight += wt;
          }
        }
      }
    } else if (suited) {
      // 4 combos: same suit index for both ranks
      for (let s = 0; s < 4; s++) {
        const c1 = r1 * 4 + s, c2 = r2 * 4 + s;
        if (!excluded.has(c1) && !excluded.has(c2)) {
          items.push([wt, c1, c2]);
          totalWeight += wt;
        }
      }
    } else {
      // 12 combos: all cross-suit combos
      for (let s1 = 0; s1 < 4; s1++) {
        for (let s2 = 0; s2 < 4; s2++) {
          if (s1 === s2) continue;
          const c1 = r1 * 4 + s1, c2 = r2 * 4 + s2;
          if (!excluded.has(c1) && !excluded.has(c2)) {
            items.push([wt, c1, c2]);
            totalWeight += wt;
          }
        }
      }
    }
  }

  if (items.length === 0 || totalWeight < 1e-12) return null;

  let rand = Math.random() * totalWeight;
  for (const [wt, c1, c2] of items) {
    rand -= wt;
    if (rand <= 0) return [c1, c2];
  }
  const last = items[items.length - 1];
  return [last[1], last[2]];
}

// ── Notation ─────────────────────────────────────────────────────────────────

const _RNAMES = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

function getNotation(seat) {
  if (!_weights[seat]) return '';
  const w = _weights[seat];
  let maxW = 0;
  for (let i = 0; i < 169; i++) if (w[i] > maxW) maxW = w[i];
  if (maxW < 1e-10) return '';

  const threshold = 0.15 * maxW;
  const pairRanks = [];           // rank indices above threshold
  const suitedMap = {};           // suitedMap[h] = [kicker, ...]
  const offsuitMap = {};          // offsuitMap[h] = [kicker, ...]

  for (let i = 0; i < 169; i++) {
    if (w[i] < threshold) continue;
    const { r1, r2, suited } = HAND_TYPES[i];
    if (r1 === r2) {
      pairRanks.push(r1);
    } else if (suited) {
      if (!suitedMap[r1]) suitedMap[r1] = [];
      suitedMap[r1].push(r2);
    } else {
      if (!offsuitMap[r1]) offsuitMap[r1] = [];
      offsuitMap[r1].push(r2);
    }
  }

  const parts = [];

  // ── Pairs ─────────────────────────────────────────────────────────────────
  pairRanks.sort((a, b) => b - a); // descending
  let pi = 0;
  while (pi < pairRanks.length) {
    let pj = pi;
    while (pj + 1 < pairRanks.length && pairRanks[pj] - pairRanks[pj + 1] === 1) pj++;
    const hi = pairRanks[pi], lo = pairRanks[pj];
    if (hi === 12 && pj > pi) {
      parts.push(_RNAMES[lo] + _RNAMES[lo] + '+');
    } else {
      for (let pk = pi; pk <= pj; pk++) {
        parts.push(_RNAMES[pairRanks[pk]] + _RNAMES[pairRanks[pk]]);
      }
    }
    pi = pj + 1;
  }

  // ── Suited ────────────────────────────────────────────────────────────────
  for (const h of Object.keys(suitedMap).map(Number).sort((a, b) => b - a)) {
    const kickers = suitedMap[h].sort((a, b) => b - a);
    let ki = 0;
    while (ki < kickers.length) {
      let kj = ki;
      while (kj + 1 < kickers.length && kickers[kj] - kickers[kj + 1] === 1) kj++;
      const topKicker = kickers[ki], botKicker = kickers[kj];
      if (topKicker === h - 1 && kj > ki) {
        parts.push(_RNAMES[h] + _RNAMES[botKicker] + 's+');
      } else {
        for (let kk = ki; kk <= kj; kk++) {
          parts.push(_RNAMES[h] + _RNAMES[kickers[kk]] + 's');
        }
      }
      ki = kj + 1;
    }
  }

  // ── Offsuit ───────────────────────────────────────────────────────────────
  for (const h of Object.keys(offsuitMap).map(Number).sort((a, b) => b - a)) {
    const kickers = offsuitMap[h].sort((a, b) => b - a);
    let ki = 0;
    while (ki < kickers.length) {
      let kj = ki;
      while (kj + 1 < kickers.length && kickers[kj] - kickers[kj + 1] === 1) kj++;
      const topKicker = kickers[ki], botKicker = kickers[kj];
      if (topKicker === h - 1 && kj > ki) {
        parts.push(_RNAMES[h] + _RNAMES[botKicker] + 'o+');
      } else {
        for (let kk = ki; kk <= kj; kk++) {
          parts.push(_RNAMES[h] + _RNAMES[kickers[kk]] + 'o');
        }
      }
      ki = kj + 1;
    }
  }

  return parts.join(', ');
}

// ── Range width helpers ───────────────────────────────────────────────────────

// % of all 1326 possible combos that are above the display threshold
function getRangePercent(seat) {
  if (!_weights[seat]) return 100;
  const w = _weights[seat];
  let maxW = 0;
  for (let i = 0; i < 169; i++) if (w[i] > maxW) maxW = w[i];
  if (maxW < 1e-10) return 100;
  const threshold = 0.15 * maxW;
  let above = 0;
  for (let i = 0; i < 169; i++) {
    if (w[i] >= threshold) above += HAND_TYPES[i].combos;
  }
  return Math.round(above / 1326 * 100);
}

// Count of concrete combos above threshold, excluding cards already known to the player
// (player's hole cards + board cards) — from the player's perspective only
function getComboCount(seat, excludedCards) {
  if (!_weights[seat]) return 0;
  const excluded = new Set(excludedCards || []);
  const w = _weights[seat];
  let maxW = 0;
  for (let i = 0; i < 169; i++) if (w[i] > maxW) maxW = w[i];
  if (maxW < 1e-10) return 0;
  const threshold = 0.15 * maxW;
  let count = 0;
  for (let i = 0; i < 169; i++) {
    if (w[i] < threshold) continue;
    const { r1, r2, suited } = HAND_TYPES[i];
    const isPair = r1 === r2;
    if (isPair) {
      for (let s1 = 0; s1 < 4; s1++)
        for (let s2 = s1 + 1; s2 < 4; s2++)
          if (!excluded.has(r1 * 4 + s1) && !excluded.has(r1 * 4 + s2)) count++;
    } else if (suited) {
      for (let s = 0; s < 4; s++)
        if (!excluded.has(r1 * 4 + s) && !excluded.has(r2 * 4 + s)) count++;
    } else {
      for (let s1 = 0; s1 < 4; s1++)
        for (let s2 = 0; s2 < 4; s2++) {
          if (s1 === s2) continue;
          if (!excluded.has(r1 * 4 + s1) && !excluded.has(r2 * 4 + s2)) count++;
        }
    }
  }
  return count;
}

function hasRange(seat) {
  return (_actionCount[seat] || 0) > 0;
}

function hasAggressed(seat) {
  return !!_hasAggressed[seat];
}

// ── Grid data for mini range chart (9–A only) ────────────────────────────────
// Returns a 6×6 matrix [row][col] where indices 0-5 map to ranks A,K,Q,J,T,9.
// Diagonal = pairs, upper-right triangle = suited, lower-left = offsuit.
// Each cell = { inRange: bool, combos: int } (combos excludes known cards).
const GRID_RANKS = [12, 11, 10, 9, 8, 7]; // A, K, Q, J, T, 9

function getGridData(seat, excludedCards) {
  if (!_weights[seat]) return null;
  const w = _weights[seat];
  const excluded = new Set(excludedCards || []);

  let maxW = 0;
  for (let i = 0; i < 169; i++) if (w[i] > maxW) maxW = w[i];
  if (maxW < 1e-10) return null;
  const threshold = 0.15 * maxW;

  const grid = [];
  for (let ri = 0; ri < 6; ri++) {
    grid[ri] = [];
    for (let ci = 0; ci < 6; ci++) {
      const r1 = GRID_RANKS[ri], r2 = GRID_RANKS[ci];
      if (ri === ci) {
        // Pair
        const idx = HAND_TYPE_MAP[r1][r1][0]; // pairs stored at [r][r][0]
        const inRange = w[idx] >= threshold;
        let combos = 0;
        if (inRange) {
          for (let s1 = 0; s1 < 4; s1++)
            for (let s2 = s1 + 1; s2 < 4; s2++)
              if (!excluded.has(r1 * 4 + s1) && !excluded.has(r1 * 4 + s2)) combos++;
        }
        grid[ri][ci] = { inRange, combos };
      } else {
        const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
        const isSuited = ci > ri; // upper-right = suited
        const suitedInt = isSuited ? 1 : 0;
        const idx = HAND_TYPE_MAP[hi][lo][suitedInt];
        const inRange = idx != null && w[idx] >= threshold;
        let combos = 0;
        if (inRange) {
          if (isSuited) {
            for (let s = 0; s < 4; s++)
              if (!excluded.has(hi * 4 + s) && !excluded.has(lo * 4 + s)) combos++;
          } else {
            for (let s1 = 0; s1 < 4; s1++)
              for (let s2 = 0; s2 < 4; s2++) {
                if (s1 === s2) continue;
                if (!excluded.has(hi * 4 + s1) && !excluded.has(lo * 4 + s2)) combos++;
              }
          }
        }
        grid[ri][ci] = { inRange, combos };
      }
    }
  }
  return grid;
}

// ── Hand distribution by category (post-flop only) ───────────────────────────
// For each combo in the opponent's range, evaluate against the board and tally
// how many combos produce each hand category (High Card, Pair, … , Royal Flush).
// Returns { dist: int[10], total: int } or null if no board.

function getHandDistribution(seat, board, excludedCards) {
  if (!_weights[seat] || !board || board.length < 3) return null;
  const w = _weights[seat];
  const excluded = new Set(excludedCards || []);

  let maxW = 0;
  for (let i = 0; i < 169; i++) if (w[i] > maxW) maxW = w[i];
  if (maxW < 1e-10) return null;
  const threshold = 0.15 * maxW;

  // categoryIndex: 0=HC,1=1P,2=2P,3=3K,4=ST,5=FL,6=FH,7=4K,8=SF,9=RF
  const dist = new Array(10).fill(0);
  let total = 0;

  for (let i = 0; i < 169; i++) {
    if (w[i] < threshold) continue;
    const { r1, r2, suited } = HAND_TYPES[i];
    const isPair = r1 === r2;

    // Helper to eval one combo
    const tryCombo = (c1, c2) => {
      if (excluded.has(c1) || excluded.has(c2)) return;
      const ev = evalBest([c1, c2, ...board]);
      if (ev) { dist[ev.categoryIndex]++; total++; }
    };

    if (isPair) {
      for (let s1 = 0; s1 < 4; s1++)
        for (let s2 = s1 + 1; s2 < 4; s2++)
          tryCombo(r1 * 4 + s1, r1 * 4 + s2);
    } else if (suited) {
      for (let s = 0; s < 4; s++)
        tryCombo(r1 * 4 + s, r2 * 4 + s);
    } else {
      for (let s1 = 0; s1 < 4; s1++)
        for (let s2 = 0; s2 < 4; s2++) {
          if (s1 === s2) continue;
          tryCombo(r1 * 4 + s1, r2 * 4 + s2);
        }
    }
  }

  return { dist, total };
}

// ── Equity breakdown: score-level comparison (post-flop only) ────────────────
// Compares each in-range combo's evaluated hand score against the player's hand
// score. Returns { win, tie, lose, total, catPct[10] } where win/tie/lose are
// COUNTS, and catPct[i] is the percentage of combos that form category i.

function getEquityBreakdown(seat, board, playerCards) {
  if (!_weights[seat] || !board || board.length < 3) return null;
  const w = _weights[seat];
  const knownCards = [...playerCards, ...board];
  const excluded = new Set(knownCards);

  // Evaluate player's hand
  const playerEval = evalBest([...playerCards, ...board]);
  if (!playerEval) return null;

  let maxW = 0;
  for (let i = 0; i < 169; i++) if (w[i] > maxW) maxW = w[i];
  if (maxW < 1e-10) return null;
  const threshold = 0.15 * maxW;

  let win = 0, tie = 0, lose = 0, total = 0;
  const catCount = new Array(10).fill(0);

  for (let i = 0; i < 169; i++) {
    if (w[i] < threshold) continue;
    const { r1, r2, suited } = HAND_TYPES[i];
    const isPair = r1 === r2;

    const tryCombo = (c1, c2) => {
      if (excluded.has(c1) || excluded.has(c2)) return;
      const oppEval = evalBest([c1, c2, ...board]);
      if (!oppEval) return;
      total++;
      catCount[oppEval.categoryIndex]++;
      const cmp = compareHands(playerEval, oppEval);
      if (cmp > 0) win++;
      else if (cmp === 0) tie++;
      else lose++;
    };

    if (isPair) {
      for (let s1 = 0; s1 < 4; s1++)
        for (let s2 = s1 + 1; s2 < 4; s2++)
          tryCombo(r1 * 4 + s1, r1 * 4 + s2);
    } else if (suited) {
      for (let s = 0; s < 4; s++)
        tryCombo(r1 * 4 + s, r2 * 4 + s);
    } else {
      for (let s1 = 0; s1 < 4; s1++)
        for (let s2 = 0; s2 < 4; s2++) {
          if (s1 === s2) continue;
          tryCombo(r1 * 4 + s1, r2 * 4 + s2);
        }
    }
  }

  if (total === 0) return null;

  // Category percentages
  const catPct = catCount.map(c => Math.round(c / total * 100));

  return { win, tie, lose, total, catPct };
}

// ── Exported API ─────────────────────────────────────────────────────────────
const Range = {
  update, resetAll,
  sampleHand,
  getNotation, getRangePercent, getComboCount,
  getGridData, GRID_RANKS,
  getHandDistribution, getEquityBreakdown,
  hasRange, hasAggressed,
};
