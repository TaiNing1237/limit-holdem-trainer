// history.js — PokerStars hand history recorder & exporter
//
// Output format: PokerStars Hand History (.txt)
// Compatible with: PokerTracker 4, Hold'em Manager 2/3, Poker Copilot,
//                  Hand2Note, PokerStrategy Elephant, most web analyzers.

const History = (() => {
  const _hands = [];

  // ── Record a completed hand ───────────────────────────────────────────────

  function record(game) {
    if (!game.gameOver)           return;
    if (game.bust || game.tourWin) return;  // session end, not a real hand
    if (!game.actionHistory || game.actionHistory.length === 0) return;

    _hands.push({
      handNum:       game.handsPlayed,
      timestamp:     new Date(),
      numPlayers:    game.numPlayers,
      dealerSeat:    game.dealerSeat,
      sbSeat:        game.sbSeat,
      bbSeat:        game.bbSeat,
      chipsStart:    [...(game.chipsStart || game.chips)],
      chipsEnd:      [...game.chips],
      hands:         game.hands.map(h => [...h]),
      board:         [...game.board],
      actionHistory: game.actionHistory.map(e => ({ ...e })),
      winners:       [...(game.winners || [])],
      winnerHand:    game.winnerHand ? { ...game.winnerHand } : null,
      pot:           game.pot,
      folded:        [...game.folded],
      eliminated:    [...game.eliminated],
      isShowdown:    game.street === STREET.SHOWDOWN,
      evalResults:   game.evalResults ? { ...game.evalResults } : {},
    });
  }

  // ── Card / string helpers ─────────────────────────────────────────────────

  // cardLabel() already returns PokerStars notation: "Ah", "Kd", "Tc", etc.
  function psCards(cards) {
    return '[' + cards.map(cardLabel).join(' ') + ']';
  }

  function psTime(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ET`;
  }

  // Convert stored action label → PokerStars action line
  function psAction(name, label, totalBet) {
    if (label === 'Fold')             return `${name}: folds`;
    if (label === 'Check')            return `${name}: checks`;
    if (label.startsWith('Call $'))   return `${name}: calls $${label.slice(6)}`;
    if (label.startsWith('Bet $'))    return `${name}: bets $${label.slice(5)}`;
    if (label.startsWith('Raise $')) {
      const amt = label.slice(7);   // raise increment, e.g. "30"
      const to  = totalBet ? ` to $${totalBet}` : '';
      return `${name}: raises $${amt}${to}`;
    }
    return `${name}: ${label.toLowerCase()}`;
  }

  // Position tag for summary line
  function posTag(seat, h) {
    if (seat === h.dealerSeat) return ' (button)';
    if (seat === h.sbSeat)     return ' (small blind)';
    if (seat === h.bbSeat)     return ' (big blind)';
    return '';
  }

  // ── Format one hand as PokerStars text ───────────────────────────────────

  function formatHandPS(h, idx) {
    const N    = h.numPlayers;
    const name = s => SEAT_NAMES[s] || `Seat${s+1}`;
    const lines = [];

    // ── Header
    lines.push(
      `PokerStars Hand #${idx}: Hold'em Limit ($15/$30) - ${psTime(h.timestamp)}`
    );
    lines.push(
      `Table 'Limit30-60' ${N}-max Seat #${h.dealerSeat + 1} is the button`
    );

    // ── Seat stack declarations (only players alive at hand start)
    for (let i = 0; i < N; i++) {
      if (h.eliminated[i]) continue;
      lines.push(`Seat ${i + 1}: ${name(i)} ($${h.chipsStart[i]} in chips)`);
    }

    // ── Blinds
    lines.push(`${name(h.sbSeat)}: posts small blind $${SMALL_BLIND}`);
    lines.push(`${name(h.bbSeat)}: posts big blind $${BIG_BLIND}`);

    // ── *** HOLE CARDS ***
    lines.push(`*** HOLE CARDS ***`);
    // Hero's cards always shown; others revealed only at showdown (PS convention)
    if (h.hands[POS.PLAYER] && h.hands[POS.PLAYER].length === 2) {
      lines.push(`Dealt to ${name(POS.PLAYER)} ${psCards(h.hands[POS.PLAYER])}`);
    }

    // ── Streets
    const streetDefs = [
      { id: STREET.PREFLOP, header: null },
      { id: STREET.FLOP,    header: () => `*** FLOP *** ${psCards(h.board.slice(0, 3))}` },
      { id: STREET.TURN,    header: () => `*** TURN *** ${psCards(h.board.slice(0, 3))} ${psCards([h.board[3]])}` },
      { id: STREET.RIVER,   header: () => `*** RIVER *** ${psCards(h.board.slice(0, 4))} ${psCards([h.board[4]])}` },
    ];

    for (const { id, header } of streetDefs) {
      const acts = h.actionHistory.filter(e => e.street === id);
      if (id !== STREET.PREFLOP && acts.length === 0) continue;
      if (header) lines.push(header());
      for (const e of acts) lines.push(psAction(name(e.seat), e.label, e.totalBet));
    }

    // ── *** SHOW DOWN ***
    if (h.isShowdown) {
      lines.push(`*** SHOW DOWN ***`);
      // Show all active hands (winners first, then losers)
      const shownSeats = new Set();
      for (const s of h.winners) {
        const handName = h.evalResults[s] ? h.evalResults[s].categoryName : '';
        lines.push(`${name(s)}: shows ${psCards(h.hands[s])} (${handName})`);
        lines.push(`${name(s)}: collected ($${Math.floor(h.pot / h.winners.length)})`);
        shownSeats.add(s);
      }
      for (let i = 0; i < N; i++) {
        if (shownSeats.has(i) || h.folded[i] || h.eliminated[i]) continue;
        if (!h.hands[i] || h.hands[i].length !== 2) continue;
        const handName = h.evalResults[i] ? h.evalResults[i].categoryName : '';
        lines.push(`${name(i)}: shows ${psCards(h.hands[i])} (${handName})`);
        lines.push(`${name(i)}: lost`);
      }
    }

    // ── *** SUMMARY ***
    lines.push(`*** SUMMARY ***`);
    lines.push(`Total pot $${h.pot} | Rake $0`);
    if (h.board.length > 0) lines.push(`Board ${psCards(h.board)}`);

    for (let i = 0; i < N; i++) {
      if (h.eliminated[i]) continue;
      const pt  = posTag(i, h);
      const nm  = name(i);

      if (h.winners.includes(i)) {
        if (h.isShowdown) {
          const hn = h.evalResults[i] ? h.evalResults[i].categoryName : '';
          lines.push(
            `Seat ${i+1}: ${nm}${pt} showed ${psCards(h.hands[i])} and won ($${h.pot}) with ${hn}`
          );
        } else {
          lines.push(`Seat ${i+1}: ${nm}${pt} collected ($${h.pot})`);
        }
      } else if (h.folded[i]) {
        const foldAct = [...h.actionHistory].reverse()
          .find(e => e.seat === i && e.label === 'Fold');
        const foldStreet = foldAct ? foldAct.street : STREET.PREFLOP;
        const where = foldStreet === STREET.PREFLOP ? 'before Flop'
                    : foldStreet === STREET.FLOP    ? 'on the Flop'
                    : foldStreet === STREET.TURN    ? 'on the Turn'
                    : 'on the River';
        lines.push(`Seat ${i+1}: ${nm}${pt} folded ${where}`);
      }
    }

    lines.push('');  // blank line between hands
    return lines.join('\n');
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function download() {
    if (_hands.length === 0) {
      alert('No hands recorded yet. Play a few hands first!');
      return;
    }
    const text = _hands.map((h, i) => formatHandPS(h, i + 1)).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `poker_history_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function count() { return _hands.length; }

  function getHands() { return _hands; }

  return { record, download, count, getHands };
})();
