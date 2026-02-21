// ai.js — AI strategy (preflop Chen formula + Monte Carlo post-flop)

// ── Preflop: Chen Formula ───────────────────────────────────────────────────

function chenScore(card1, card2) {
  const r1 = cardRank(card1), r2 = cardRank(card2);
  const s1 = cardSuit(card1), s2 = cardSuit(card2);
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  const suited = s1 === s2;
  const paired = r1 === r2;
  const gap = hi - lo;
  const rankScore = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 10];
  let score = rankScore[hi];
  if (paired) {
    score = Math.max(score * 2, 5);
  } else {
    if (suited) score += 2;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap > 3) score -= 5;
    if (gap <= 1 && lo >= 2 && hi <= 9) score += 1;
  }
  return score;
}

function preflopRaiseProb(score, posBonus) {
  const adj = score + posBonus;
  if (adj >= 10) return 1.0;
  if (adj >= 8) return 0.85;
  if (adj >= 7) return 0.65;
  if (adj >= 6) return 0.45;
  if (adj >= 5) return 0.25;
  if (adj >= 4) return 0.10;
  return 0.04;
}

function preflopCallProb(score, posBonus) {
  const adj = score + posBonus;
  if (adj >= 7) return 1.0;
  if (adj >= 5) return 0.80;
  if (adj >= 4) return 0.55;
  if (adj >= 3) return 0.30;
  return 0.12;
}

// Position bonus: later position = plays wider
function positionBonus(seat, dealerSeat, aliveSeats) {
  if (!aliveSeats || aliveSeats.length === 0) return 0;

  const numAlive = aliveSeats.length;
  const dealerIdx = aliveSeats.indexOf(dealerSeat);
  const seatIdx = aliveSeats.indexOf(seat);

  if (dealerIdx === -1 || seatIdx === -1) return 0;

  const pos = (seatIdx - dealerIdx + numAlive) % numAlive;
  // pos 0 = dealer (BTN), 1 = SB, 2 = BB, 3+ = early/mid
  if (pos === 0) return 2.5;  // BTN
  if (pos === 1) return 1.0;  // SB
  if (pos === 2) return 0.5;  // BB
  if (pos >= numAlive - 2 && numAlive > 4) return 1.5; // CO, HJ
  return 0;
}

// ── Monte Carlo Equity ──────────────────────────────────────────────────────

function fisherYates(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Equity for aiSeat vs all active opponents in multi-player game
function monteCarloEquityMulti(game, aiSeat, N = 400) {
  const aiCards = game.hands[aiSeat];
  const board = game.board;
  const active = game.activePlayers().filter(s => s !== aiSeat);
  const neededBoard = 5 - board.length;

  // Build known cards set (only AI's own cards and public board cards)
  const known = new Set([...aiCards, ...board]);
  const remaining = [];
  for (let c = 0; c < 52; c++) {
    if (!known.has(c)) remaining.push(c);
  }

  let wins = 0;
  for (let i = 0; i < N; i++) {
    fisherYates(remaining);
    let cardIdx = 0;

    // 1. Deal random runout for the board
    const runout = remaining.slice(cardIdx, cardIdx + neededBoard);
    cardIdx += neededBoard;
    const fullBoard = [...board, ...runout];
    const aiEval = evalBest([...aiCards, ...fullBoard]);

    // 2. Deal random hole cards for each active opponent
    let best = true, tieCount = 1;
    for (const oppSeat of active) {
      const oppHoleCards = [remaining[cardIdx], remaining[cardIdx + 1]];
      cardIdx += 2;
      const oppEval = evalBest([...oppHoleCards, ...fullBoard]);
      const cmp = compareHands(aiEval, oppEval);
      if (cmp < 0) { best = false; break; }
      if (cmp === 0) tieCount++;
    }

    if (best) {
      wins += (1 / tieCount);
    }
  }
  return wins / N;
}

// ── AI Decision ─────────────────────────────────────────────────────────────

function aiDecide(game, aiSeat) {
  const aiCards = game.hands[aiSeat];
  const board = game.board;
  const callAmt = game.callAmount();
  const betSize = game.betSize();
  const raiseCount = game.raiseCount;
  const legalActions = game.legalActions();
  const hasCheck = legalActions.includes('check');
  const hasCall = legalActions.some(a => a && a.action === 'call');
  const hasBet = legalActions.some(a => a && a.action === 'bet');
  const hasRaise = legalActions.some(a => a && a.action === 'raise');
  const canAggress = (hasBet || hasRaise) && raiseCount < MAX_RAISES;
  const aggressAction = legalActions.find(a => a && (a.action === 'bet' || a.action === 'raise'));
  const callAction = legalActions.find(a => a && a.action === 'call');

  const r = Math.random();

  const aliveSeats = [];
  for (let j = 0; j < game.numPlayers; j++) {
    if (!game.eliminated || !game.eliminated[j]) aliveSeats.push(j);
  }
  const posBonus = positionBonus(aiSeat, game.dealerSeat, aliveSeats);

  // ── PREFLOP ──
  if (game.street === STREET.PREFLOP) {
    const score = chenScore(aiCards[0], aiCards[1]);
    const maxBet = Math.max(...game.bets);

    if (maxBet <= BIG_BLIND) {
      // Unopened / Limped pot (or completing SB / checking BB)
      const raiseP = preflopRaiseProb(score, posBonus);
      if (canAggress && r < raiseP) return aggressAction;
      return hasCheck ? 'check' : (callAction || 'fold');
    } else {
      // Facing raise/bet
      const raiseP = preflopRaiseProb(score, posBonus) * 0.55;
      const callP = preflopCallProb(score, posBonus);
      const pot = game.pot;
      const potOdds = callAmt / (pot + callAmt);
      if (canAggress && r < raiseP) return aggressAction;
      if (r < callP) return callAction || 'fold';
      return 'fold';
    }
  }

  // ── POST-FLOP (use real hands from game) ──
  const equity = monteCarloEquityMulti(game, aiSeat, 300);
  const pot = game.pot;
  const potOdds = callAmt > 0 ? callAmt / (pot + callAmt) : 0;

  const STRONG = 0.55, MEDIUM = 0.40, DRAW = 0.28;

  if (equity >= STRONG) {
    if (canAggress && r < 0.80) return aggressAction;
    return hasCheck ? 'check' : (callAction || 'fold');
  }
  if (equity >= MEDIUM) {
    if (hasCheck) {
      if (canAggress && r < 0.35) return aggressAction;
      return 'check';
    }
    if (equity > potOdds + 0.05) {
      if (canAggress && r < 0.20) return aggressAction;
      return callAction || 'fold';
    }
    return equity > potOdds ? callAction || 'fold' : 'fold';
  }
  if (equity >= DRAW) {
    if (hasCheck) return 'check';
    return equity > potOdds ? callAction || 'fold' : 'fold';
  }
  // Weak: bluff rarely, else fold
  if (hasCheck) return 'check';
  if (canAggress && r < 0.06) return aggressAction;
  return 'fold';
}
