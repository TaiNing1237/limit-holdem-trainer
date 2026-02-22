// solver.js — Equity analysis & action recommendation (player vs all opponents)

function calcPlayerEquityMulti(game, N = 800) {
  const ps = game.playerSeat ?? POS.PLAYER;
  const playerCards = game.hands[ps];
  const board = game.board;
  if (playerCards.length < 2) return { equity: 0, outsCount: 0, outsDesc: '' };

  const active = game.activePlayers();
  const opponents = active.filter(s => s !== ps);
  const needed = 5 - board.length;

  // Build remaining deck (exclude all known cards)
  const known = new Set([...playerCards, ...board]);
  const remaining = [];
  for (let c = 0; c < 52; c++) {
    if (!known.has(c)) remaining.push(c);
  }

  let wins = 0, ties = 0;
  for (let i = 0; i < N; i++) {
    fisherYates(remaining);
    let cardIdx = 0;

    // 1. Deal random runout for the board
    const runout = remaining.slice(cardIdx, cardIdx + needed);
    cardIdx += needed;
    const fullBoard = [...board, ...runout];
    const plEval = evalBest([...playerCards, ...fullBoard]);

    // 2. Deal random hole cards for each active opponent
    let best = true, isTie = false;
    for (const opp of opponents) {
      const oppHoleCards = [remaining[cardIdx], remaining[cardIdx + 1]];
      cardIdx += 2;
      const oppEval = evalBest([...oppHoleCards, ...fullBoard]);
      const cmp = compareHands(plEval, oppEval);
      if (cmp < 0) { best = false; break; }
      if (cmp === 0) isTie = true;
    }
    if (best && !isTie) wins++;
    else if (best && isTie) ties += 0.5;
  }

  const equity = (wins + ties) / N;
  const outsInfo = board.length >= 3 ? calcOuts(playerCards, board, remaining) : { count: 0, desc: '' };
  return { equity, outsCount: outsInfo.count, outsDesc: outsInfo.desc };
}

function calcOuts(playerCards, board, remaining) {
  if (board.length === 0 || board.length >= 5) return { outs: [], count: 0, desc: '' };
  const currentEval = evalBest([...playerCards, ...board]);
  const currentCat = currentEval ? currentEval.categoryIndex : -1;
  const outs = [];
  for (const card of remaining) {
    const total = playerCards.length + board.length + 1;
    if (total < 4 || total > 7) continue;
    const newEval = evalBest([...playerCards, ...board, card]);
    if (newEval && newEval.categoryIndex > currentCat) outs.push(card);
  }
  return { count: outs.length, desc: describeOuts(playerCards, board, outs) };
}

function describeOuts(playerCards, board, outs) {
  if (outs.length === 0) return 'No clean outs';
  const parts = [];
  const allCards = [...playerCards, ...board];
  const suitCounts = [0, 0, 0, 0];
  allCards.forEach(c => suitCounts[cardSuit(c)]++);
  const flushSuit = suitCounts.findIndex(c => c === 4);
  if (flushSuit >= 0) {
    const n = outs.filter(c => cardSuit(c) === flushSuit).length;
    if (n > 0) parts.push(`${n} flush`);
  }
  const other = outs.length - (parts.length > 0 ? parseInt(parts[0]) : 0);
  if (other > 0 && parts.length === 0) parts.push(`${outs.length} improve`);
  else if (other > 0) parts.push(`${other} other`);
  return parts.join(' + ') + ' out' + (outs.length !== 1 ? 's' : '');
}

function pct(v) { return (v * 100).toFixed(1) + '%'; }

function recommend(equity, pot, callAmount, numOpponents) {
  // Adjust equity threshold for multi-player (need higher equity to be +EV)
  const potOdds = callAmount > 0 ? callAmount / (pot + callAmount) : 0;
  // In N-way pot, equity threshold roughly scales
  const threshold = callAmount > 0 ? potOdds : 0;
  let action, reason, color;

  if (callAmount === 0) {
    if (equity >= 0.50) {
      action = 'Bet'; color = 'raise';
      reason = `Strong equity ${pct(equity)} in ${numOpponents + 1}-way pot. Bet for value.`;
    } else if (equity >= 0.35) {
      action = 'Check'; color = 'call';
      reason = `Marginal ${pct(equity)}. Check and see a free card.`;
    } else {
      action = 'Check'; color = 'fold';
      reason = `Weak ${pct(equity)} in ${numOpponents + 1}-way. Check/fold to bets.`;
    }
  } else {
    const margin = equity - threshold;
    if (equity >= 0.55) {
      action = 'Raise'; color = 'raise';
      reason = `Dominant ${pct(equity)} vs ${numOpponents} opp. Raise for value.`;
    } else if (margin >= 0.08) {
      action = 'Call'; color = 'call';
      reason = `Equity ${pct(equity)} beats pot odds ${pct(threshold)}. Call.`;
    } else if (margin >= 0) {
      action = 'Call'; color = 'call';
      reason = `Thin call: ${pct(equity)} ≈ pot odds ${pct(threshold)}.`;
    } else {
      action = 'Fold'; color = 'fold';
      reason = `Equity ${pct(equity)} < pot odds ${pct(threshold)}. Fold.`;
    }
  }
  return { action, reason, color, potOdds };
}

// Range-conditioned equity: sample opponent hands from their Bayesian range
function calcPlayerEquityRangeAware(game, N = 800) {
  const ps = game.playerSeat ?? POS.PLAYER;
  const playerCards = game.hands[ps];
  const board = game.board;
  if (playerCards.length < 2) return { equity: 0, outsCount: 0, outsDesc: '' };

  const active = game.activePlayers();
  const opponents = active.filter(s => s !== ps);
  const needed = 5 - board.length;

  let wins = 0, ties = 0;

  for (let i = 0; i < N; i++) {
    // Start with player cards + board as excluded
    const excluded = new Set([...playerCards, ...board]);

    // Sample (or randomly deal) hole cards for each opponent
    const oppHands = [];
    let valid = true;

    for (const opp of opponents) {
      let hand = Range.sampleHand(opp, excluded);  // opp already excludes ps
      if (!hand) {
        // Fallback: random 2 cards from remaining deck
        const remaining = [];
        for (let c = 0; c < 52; c++) {
          if (!excluded.has(c)) remaining.push(c);
        }
        if (remaining.length < 2) { valid = false; break; }
        fisherYates(remaining);
        hand = [remaining[0], remaining[1]];
      }
      oppHands.push(hand);
      excluded.add(hand[0]);
      excluded.add(hand[1]);
    }

    if (!valid) continue;

    // Build runout deck and shuffle
    const deckArr = [];
    for (let c = 0; c < 52; c++) {
      if (!excluded.has(c)) deckArr.push(c);
    }
    if (deckArr.length < needed) continue;

    fisherYates(deckArr);
    const fullBoard = [...board, ...deckArr.slice(0, needed)];
    const plEval = evalBest([...playerCards, ...fullBoard]);

    let best = true, isTie = false;
    for (const oppHand of oppHands) {
      const oppEval = evalBest([...oppHand, ...fullBoard]);
      const cmp = compareHands(plEval, oppEval);
      if (cmp < 0) { best = false; break; }
      if (cmp === 0) isTie = true;
    }
    if (best && !isTie) wins++;
    else if (best && isTie) ties += 0.5;
  }

  const equity = (wins + ties) / N;
  // Outs: use deck minus player+board only (opponent cards are unknown)
  const knownSet = new Set([...playerCards, ...board]);
  const remaining = [];
  for (let c = 0; c < 52; c++) {
    if (!knownSet.has(c)) remaining.push(c);
  }
  const outsInfo = board.length >= 3 ? calcOuts(playerCards, board, remaining) : { count: 0, desc: '' };
  return { equity, outsCount: outsInfo.count, outsDesc: outsInfo.desc };
}

function solverAnalyze(game) {
  const ps = game.playerSeat ?? POS.PLAYER;
  const playerCards = game.hands[ps];
  if (playerCards.length < 2 || game.folded[ps]) return null;
  const active = game.activePlayers();
  const numOpponents = active.filter(s => s !== ps).length;

  // Use range-conditioned equity if any active opponent has observed actions
  const anyHasRange = active.some(s => s !== ps && Range.hasRange(s));
  const { equity, outsCount, outsDesc } = anyHasRange
    ? calcPlayerEquityRangeAware(game, 800)
    : calcPlayerEquityMulti(game, 800);

  const callAmt = game.isPlayerTurn() ? game.callAmount() : 0;
  const rec = recommend(equity, game.pot, callAmt, numOpponents);
  return { equity, outsCount, outsDesc, rec, numOpponents };
}
