// ui.js — 9-seat poker table rendering, action bubbles, action log

// ── Pip Layouts & Face Cards (same as before) ───────────────────────────────

const PIP_LAYOUTS = {
  '2': [[50, 18, false], [50, 82, true]],
  '3': [[50, 15, false], [50, 50, false], [50, 85, true]],
  '4': [[25, 18, false], [75, 18, false], [25, 82, true], [75, 82, true]],
  '5': [[25, 18, false], [75, 18, false], [50, 50, false], [25, 82, true], [75, 82, true]],
  '6': [[25, 15, false], [75, 15, false], [25, 50, false], [75, 50, false], [25, 85, true], [75, 85, true]],
  '7': [[25, 15, false], [75, 15, false], [50, 31, false], [25, 50, false], [75, 50, false], [25, 85, true], [75, 85, true]],
  '8': [[25, 15, false], [75, 15, false], [50, 31, false], [25, 50, false], [75, 50, false], [50, 69, true], [25, 85, true], [75, 85, true]],
  '9': [[25, 12, false], [75, 12, false], [25, 36, false], [75, 36, false], [50, 50, false], [25, 64, true], [75, 64, true], [25, 88, true], [75, 88, true]],
  'T': [[25, 10, false], [75, 10, false], [50, 24, false], [25, 37, false], [75, 37, false], [25, 63, true], [75, 63, true], [50, 76, true], [25, 90, true], [75, 90, true]],
};

const FACE_INFO = { 'J': '♞', 'Q': '♛', 'K': '♚' };

function buildCardBody(rank, suit, color) {
  // Face cards (J / Q / K)
  if (FACE_INFO[rank]) {
    return `<div class="card-face-area">
      <div class="face-piece ${color}">${FACE_INFO[rank]}</div>
      <div class="face-suit-sm ${color}">${suit}</div>
    </div>`;
  }
  // Ace: single large pip
  if (rank === 'A') {
    return `<div class="card-pips"><span class="pip pip-ace ${color}" style="left:50%;top:50%">${suit}</span></div>`;
  }
  // Number cards: correct pip count
  const layout = PIP_LAYOUTS[rank] || [];
  const sz = layout.length >= 9 ? '0.62rem' : layout.length >= 7 ? '0.72rem' : '0.84rem';
  const pips = layout.map(([x, y, flip]) => {
    const tf = flip ? 'translate(-50%,-50%) rotate(180deg)' : 'translate(-50%,-50%)';
    return `<span class="pip ${color}" style="left:${x}%;top:${y}%;transform:${tf};font-size:${sz}">${suit}</span>`;
  }).join('');
  return `<div class="card-pips">${pips}</div>`;
}

function buildCard(card, faceDown = false, animClass = '', small = false) {
  const sizeClass = small ? ' card-sm' : '';
  if (faceDown) return `<div class="card card-back${sizeClass} ${animClass}"><div class="card-inner">🂠</div></div>`;
  const { rank, suit, color } = cardDisplay(card);
  const displayRank = rank === 'T' ? '10' : rank;
  const isFace = rank === 'J' || rank === 'Q' || rank === 'K';
  const cornerSuit = isFace ? `<span class="card-suit ${color}">${suit}</span>` : '';
  return `<div class="card${sizeClass} ${animClass}" data-card="${card}">
    <div class="card-corner top-left">
      <span class="card-rank">${displayRank}</span>
      ${cornerSuit}
    </div>
    ${buildCardBody(rank, suit, color)}
    <div class="card-corner bottom-right">
      <span class="card-rank">${displayRank}</span>
      ${cornerSuit}
    </div>
  </div>`;
}

// ── Chip Stack Visual ────────────────────────────────────────────────────────

function chipStackHTML(amount) {
  return `<span class="chip-amt">$${amount.toLocaleString()}</span>`;
}

// ── Dynamic Seat Layout ───────────────────────────────────────────────────────
// Seats are arranged clockwise starting from bottom (seat 0 = player).
// Uses an elliptical formula scaled to the table-container aspect ratio.
// Container aspect: 820 × 560. Felt center ≈ 50%, 48%.
const _LAYOUT_CX = 50, _LAYOUT_CY = 40;
const _LAYOUT_RX = 42, _LAYOUT_RY = 38; // % radii

function applyTableLayout(N, mySeat = 0) {
  for (let i = 0; i < NUM_SEATS; i++) {
    const el = document.getElementById(`seat-${i}`);
    if (!el) continue;
    if (i >= N) {
      el.style.display = 'none';
    } else {
      el.style.display = '';
      // Rotate so that mySeat is always at the bottom (90°); others follow clockwise
      const visualPos = (i - mySeat + N) % N;
      const deg = 90 + visualPos * (360 / N);
      const rad = deg * Math.PI / 180;
      const sx = Math.sin(rad);  // >0 = lower half, <0 = upper half
      const cx = Math.cos(rad);  // >0 = right half, <0 = left half
      const x = _LAYOUT_CX + _LAYOUT_RX * cx;
      const y = _LAYOUT_CY + _LAYOUT_RY * sx;
      el.style.left = x.toFixed(1) + '%';
      el.style.top = y.toFixed(1) + '%';

      // ── Bet position: toward felt center ─────────────────────────────────
      const betEl = el.querySelector('.seat-bet');
      if (betEl) {
        betEl.style.top = betEl.style.bottom = betEl.style.left = betEl.style.right = '';
        // Vertical: lower half → bet above seat (toward center); upper half → bet below
        betEl.style[sx >= 0 ? 'top' : 'bottom'] = '-18px';
        // Horizontal nudge toward center
        if (cx > 0.35) betEl.style.right = '0';
        else if (cx < -0.35) betEl.style.left = '0';
      }

      // ── Range position: away from felt center ─────────────────────────────
      const rangeEl = el.querySelector('.seat-range');
      if (rangeEl) {
        rangeEl.style.top = rangeEl.style.bottom = rangeEl.style.left = rangeEl.style.right = rangeEl.style.transform = '';
        if (Math.abs(cx) > 0.65 && Math.abs(sx) < 0.55) {
          // Clearly left/right side → range on the outer lateral side
          rangeEl.style.top = '50%';
          rangeEl.style[cx > 0 ? 'left' : 'right'] = 'calc(100% + 6px)';
          rangeEl.style.transform = 'translateY(-50%)';
        } else if (sx >= 0) {
          // Lower half → range below (away from center)
          rangeEl.style.top = 'calc(100% + 4px)';
          rangeEl.style.left = '50%';
          rangeEl.style.transform = 'translateX(-50%)';
        } else {
          // Upper half → range above (away from center)
          rangeEl.style.bottom = 'calc(100% + 4px)';
          rangeEl.style.left = '50%';
          rangeEl.style.transform = 'translateX(-50%)';
        }
      }
    }
  }
}

// ── Card render cache (prevents re-animating on every renderAll) ─────────────
// Key: "handsPlayed-showFace"  →  only rebuild when hand changes or face flips
const _cardCache = {}; // { seat: stateKey }

// ── Seat Rendering ───────────────────────────────────────────────────────────

function renderSeat(game, seat) {
  const el = document.getElementById(`seat-${seat}`);
  if (!el) return;

  const isPlayer = game.playerSeat !== null && seat === game.playerSeat;
  const isShowdown = game.street === STREET.SHOWDOWN;
  const isFolded = game.folded[seat];
  const isDealer = seat === game.dealerSeat;
  const isActive = !isFolded && game.toAct === seat && !game.gameOver;
  const isEliminated = game.eliminated && game.eliminated[seat];

  // Active glow
  el.classList.toggle('seat-active', isActive);
  el.classList.toggle('seat-folded', isFolded && !isEliminated);
  el.classList.toggle('seat-eliminated', isEliminated);
  el.classList.toggle('seat-winner',
    game.gameOver && (game.winners || []).includes(seat));
  el.classList.toggle('seat-player', isPlayer);

  // Dealer badge
  const dealerBadge = el.querySelector('.dealer-badge');
  if (dealerBadge) dealerBadge.style.display = isDealer ? 'flex' : 'none';

  // Cards 
  const cardsEl = el.querySelector('.seat-cards');
  if (cardsEl) {
    cardsEl.style.display = 'flex';
    const showFace = isPlayer || (isShowdown && !isFolded);
    const stateKey = `${game.handsPlayed}-${showFace}-${isShowdown}`;
    const hd = game.hands[seat] || [];
    if (hd.length > 0 && _cardCache[seat] !== stateKey) {
      const isNewHand = !_cardCache[seat] ||
        _cardCache[seat].split('-')[0] !== String(game.handsPlayed);
      _cardCache[seat] = stateKey;
      cardsEl.innerHTML = hd.map((c, i) => {
        let animClass = isNewHand ? `deal-in delay-${i}` : '';
        if (showFace && !isPlayer && !isNewHand) animClass = `flip-in delay-${i}`;
        const isWinnerCard = isShowdown && (game.winners || []).includes(seat) &&
          game.evalResults && game.evalResults[seat] &&
          game.evalResults[seat].bestCards && game.evalResults[seat].bestCards.includes(c);
        return buildCard(c, !showFace, animClass + (isWinnerCard ? ' card-winner' : ''), true);
      }).join('');
    } else if (hd.length === 0) {
      cardsEl.innerHTML = '';
      _cardCache[seat] = '';
    }
  }

  // Chips
  const chipsEl = el.querySelector('.seat-chips');
  if (chipsEl) chipsEl.innerHTML = chipStackHTML(game.chips[seat]);

  // Current street bet
  const betEl = el.querySelector('.seat-bet');
  if (betEl) {
    const bet = game.bets[seat];
    if (bet > 0) {
      betEl.textContent = `$${bet}`;
      betEl.style.display = 'block';
    } else {
      betEl.style.display = 'none';
    }
  }

  // Seat name label (updated dynamically for multiplayer names)
  const nameEl = el.querySelector('.seat-name-label');
  if (nameEl) {
    const playerNames = game.playerNames || [];
    const displayName = playerNames[seat] || (isPlayer ? 'You' : `AI ${seat}`);
    nameEl.textContent = displayName;
  }

  // Position label (BTN, SB, BB, UTG, CO, …)
  const roleEl = el.querySelector('.seat-role');
  if (roleEl) {
    const aliveSeats = [];
    for (let j = 0; j < game.numPlayers; j++) {
      if (!game.eliminated || !game.eliminated[j]) aliveSeats.push(j);
    }
    const pos = getPositionName(seat, game.dealerSeat, aliveSeats);
    roleEl.textContent = pos;
    roleEl.style.color =
      pos === 'BTN' ? 'var(--gold)' :
        pos === 'SB' || pos === 'BB' ? '#f39c12' :
          'var(--text-dim)';
  }
}

// ── Board & Pot ───────────────────────────────────────────────────────────────

let _boardCache = ''; // "handsPlayed-boardLength"

function renderBoard(game) {
  const el = document.getElementById('board-cards');
  if (!el) return;

  const boardKey = `${game.handsPlayed}-${game.board.length}`;
  if (_boardCache !== boardKey) {
    _boardCache = boardKey;
    let html = '';
    for (let i = 0; i < 5; i++) {
      if (i < game.board.length) {
        // Only newly added cards get the animation; existing cards keep their spot
        const isNew = i >= (game.board.length - (game.street === STREET.FLOP ? 3 : 1));
        html += buildCard(game.board[i], false, isNew ? `deal-in delay-${i}` : '', false);
      } else {
        html += `<div class="card card-placeholder"></div>`;
      }
    }
    el.innerHTML = html;
  }

  const potEl = document.getElementById('pot-display');
  if (potEl) potEl.innerHTML =
    `<span class="pot-label">POT</span><span class="pot-amount">$${game.pot}</span>`;

  const streetEl = document.getElementById('street-name');
  if (streetEl) streetEl.textContent = game.streetName();
}

// ── Result Banner ─────────────────────────────────────────────────────────────

function renderResult(game) {
  const el = document.getElementById('result-banner');
  if (!el) return;
  if (!game.gameOver) { el.style.display = 'none'; return; }
  el.style.display = 'flex';

  // Tournament-level game-over states
  if (game.tourWin) {
    el.innerHTML = `<span class="res-win">You're the last one standing! New Game?</span>`;
    el.className = 'result-banner res-win-banner';
    return;
  }
  if (game.bust) {
    el.innerHTML = `<span class="res-lose">You're Busted! All chips lost.</span>`;
    el.className = 'result-banner res-lose-banner';
    return;
  }

  // Normal hand result
  const ps = game.playerSeat;
  const playerWins = ps !== null && (game.winners || []).includes(ps);
  const isSplit = game.winner === -1;

  if (playerWins && !isSplit) {
    // Sole winner
    el.innerHTML = `<span class="res-win">You Win $${game.pot}!</span>`;
    el.className = 'result-banner res-win-banner';
  } else if (playerWins && isSplit) {
    // Split pot — player is one of multiple winners
    const share = Math.floor(game.pot / (game.winners || [1]).length);
    el.innerHTML = `<span class="res-tie">Split Pot — You get $${share}</span>`;
    el.className = 'result-banner res-tie-banner';
  } else if (isSplit) {
    // Chop between AIs, player not involved
    el.innerHTML = `<span class="res-tie">Chop! Split Pot</span>`;
    el.className = 'result-banner res-tie-banner';
  } else {
    const winnerSeat = game.winner ?? -1;
    const w = winnerSeat >= 0 && winnerSeat < NUM_SEATS
      ? ((game.playerNames && game.playerNames[winnerSeat]) || SEAT_NAMES[winnerSeat])
      : 'Unknown';
    const hand = game.winnerHand ? game.winnerHand.categoryName : '';
    el.innerHTML = `<span class="res-lose">${w} Wins — ${hand}</span>`;
    el.className = 'result-banner res-lose-banner';
  }
}

// ── Action Buttons ────────────────────────────────────────────────────────────

function renderButtons(game) {
  const container = document.getElementById('action-buttons');
  if (!container) return;

  // Observer: seat assigned but not yet active this hand
  if (game.playerSeat === null) {
    container.innerHTML = `<div class="waiting-msg">Watching this hand… ♠ you'll take your seat next hand</div>`;
    return;
  }

  if (game.gameOver) {
    const isSessionOver = game.bust || game.tourWin;
    const label = isSessionOver ? 'New Game ↺' : 'New Hand ↺';
    container.innerHTML = `<button class="btn btn-new" id="btn-new-hand">${label}</button>`;
    return;
  }
  if (!game.isPlayerTurn()) {
    const toActName = (game.playerNames && game.playerNames[game.toAct]) || SEAT_NAMES[game.toAct];
    container.innerHTML = `<div class="waiting-msg">Waiting for <strong>${toActName}</strong>…</div>`;
    return;
  }

  const actions = game.legalActions();
  const betSize = game.betSize();
  let html = '';
  for (const act of actions) {
    if (act === 'fold') {
      html += `<button class="btn btn-fold" data-action="fold">Fold</button>`;
    } else if (act === 'check') {
      html += `<button class="btn btn-check" data-action="check">Check</button>`;
    } else if (act.action === 'call') {
      html += `<button class="btn btn-call" data-action="call" data-amount="${act.amount}">Call $${act.amount}</button>`;
    } else if (act.action === 'bet') {
      html += `<button class="btn btn-raise" data-action="bet" data-amount="${act.amount}">Bet $${betSize}</button>`;
    } else if (act.action === 'raise') {
      html += `<button class="btn btn-raise" data-action="raise" data-amount="${act.amount}">Raise $${betSize}</button>`;
    }
  }
  container.innerHTML = html;
}

// ── Action Bubble (speech bubble per seat) ────────────────────────────────────

function showActionBubble(seat, label) {
  const bubble = document.getElementById(`bubble-${seat}`);
  const seatEl = document.getElementById(`seat-${seat}`);
  if (!bubble) return;
  const lc = label.toLowerCase();
  let cls = 'bubble-check';
  if (lc === 'fold') cls = 'bubble-fold';
  else if (lc.startsWith('call')) cls = 'bubble-call';
  else if (lc.startsWith('bet') || lc.startsWith('raise')) cls = 'bubble-raise';
  bubble.textContent = label.toUpperCase();
  bubble.className = `action-bubble ${cls} bubble-show`;
  if (seatEl) seatEl.style.zIndex = '100';
  clearTimeout(bubble._t);
  bubble._t = setTimeout(() => {
    bubble.className = 'action-bubble';
    if (seatEl) seatEl.style.zIndex = '';
  }, 2200);
}

// ── Action Log Table ──────────────────────────────────────────────────────────

const STREET_SHORT = ['Pre', 'Flop', 'Turn', 'River'];

function actionCellClass(labels) {
  if (!labels || labels.length === 0) return 'at-empty';
  const last = labels[labels.length - 1].toLowerCase();
  if (last === 'fold') return 'at-fold';
  if (last.startsWith('bet') || last.startsWith('raise')) return 'at-raise';
  if (last.startsWith('call')) return 'at-call';
  return 'at-check';
}

function renderActionLog(game) {
  const el = document.getElementById('action-log-list');
  if (!el) return;

  const N = game.numPlayers;

  // Build map: cellData[seat][street] = [label, ...]
  const cellData = Array.from({ length: N }, () => ({ 0: [], 1: [], 2: [], 3: [] }));
  for (const e of game.actionHistory) {
    if (e.seat < N && e.street <= STREET.RIVER) {
      cellData[e.seat][e.street].push(e.label);
    }
  }

  // Which streets have any actions?
  const streets = [0, 1, 2, 3].filter(s =>
    game.actionHistory.some(e => e.street === s)
  );

  if (streets.length === 0) {
    el.innerHTML = '<div class="log-empty">Hand in progress…</div>';
    return;
  }

  // Table header
  let html = '<table class="action-table"><thead><tr>';
  html += '<th class="at-th-name"></th>';
  for (const s of streets) {
    html += `<th class="at-th-street">${STREET_SHORT[s]}</th>`;
  }
  html += '</tr></thead><tbody>';

  // One row per player
  const aliveSeats = [];
  for (let j = 0; j < N; j++) {
    if (!game.eliminated || !game.eliminated[j]) aliveSeats.push(j);
  }

  for (let seat = 0; seat < N; seat++) {
    const isPlayer = game.playerSeat !== null && seat === game.playerSeat;
    const isFolded = game.folded[seat];
    const pos = getPositionName(seat, game.dealerSeat, aliveSeats);
    const name = isPlayer ? 'You'
      : (game.playerNames && game.playerNames[seat]) || SEAT_NAMES[seat];
    const rowCls = [isPlayer ? 'at-player-row' : '', isFolded ? 'at-folded-row' : ''].join(' ');

    html += `<tr class="${rowCls}">`;
    html += `<td class="at-td-name">${name}<span class="at-pos">${pos}</span></td>`;

    for (const s of streets) {
      const labels = cellData[seat][s];
      const cls = actionCellClass(labels);
      if (labels.length === 0) {
        html += `<td class="at-td ${cls}">—</td>`;
      } else {
        // Abbreviate for space
        const text = labels.map(abbrevAction).join('<br>');
        html += `<td class="at-td ${cls}">${text}</td>`;
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  el.innerHTML = html;
}

function abbrevAction(label) {
  if (label === 'Fold') return 'Fold';
  if (label === 'Check') return 'Check';
  if (label.startsWith('Call')) return label.replace('Call ', 'C ');
  if (label.startsWith('Bet')) return label.replace('Bet ', 'B ');
  if (label.startsWith('Raise')) return label.replace('Raise ', 'R ');
  return label;
}

// ── Solver Panel ───────────────────────────────────────────────────────────────

function renderSolver(game, data) {
  const panel = document.getElementById('solver-panel');
  if (!panel) return;
  if (!data) {
    panel.innerHTML = '<p class="solver-placeholder">Deal a hand to see analysis.</p>';
    return;
  }
  const { equity, outsCount, outsDesc, rec, numOpponents } = data;
  const eqPct = (equity * 100).toFixed(1);
  const cards = game.hands[game.playerSeat ?? POS.PLAYER];
  const ev = cards.length >= 2 ? evalBest([...cards, ...game.board]) : null;

  let recHTML = rec ? `<div class="rec rec-${rec.color}">
    <span class="rec-action">${rec.action}</span>
    <span class="rec-reason">${rec.reason}</span>
  </div>` : '';

  panel.innerHTML = `
    <h3 class="solver-title">Solver — ${numOpponents} Opp.</h3>
    <div class="equity-section">
      <div class="equity-label">
        <span>You <strong>${eqPct}%</strong></span>
        <span>Field <strong>${(100 - equity * 100).toFixed(1)}%</strong></span>
      </div>
      <div class="equity-bar"><div class="equity-fill" style="width:${eqPct}%"></div></div>
    </div>
    ${outsCount > 0 ? `<div class="outs-section">
      <span class="outs-count">${outsCount}</span>
      <span class="outs-label">${outsDesc}</span>
    </div>` : ''}
    ${recHTML}
    ${ev ? `<div class="current-hand">Current: <strong>${ev.categoryName}</strong></div>` : ''}
  `;
}

// ── Range Display (Analyze mode only) ────────────────────────────────────────
// • Preflop: show "~XX%" range width
// • Post-flop: equity bar + category % + persistent delta arrows
//   Uses score-level comparison (same category hands are also compared).

const _CAT_SHORT = ['HC', '1P', '2P', '3K', 'ST', 'FL', 'FH', '4K', 'SF', 'RF'];

// Cache previous equity per seat: { boardLen, losePct }
// Persists across renders within the same street, only updates on street change.
const _prevEquity = {};

function _resetPrevDist() {
  for (let s = 0; s < NUM_SEATS; s++) _prevEquity[s] = null;
}

function renderRanges(game) {
  if (game.playerSeat === null) return;  // observer: no range analysis yet
  const hasBoard = game.board.length >= 3;
  const boardLen = game.board.length;
  const ps = game.playerSeat ?? POS.PLAYER;
  const playerCards = game.hands[ps];

  // If player folded, no point showing analysis
  if (game.folded[ps]) {
    for (let s = 0; s < game.numPlayers; s++) {
      if (s === ps) continue;
      const el = document.getElementById(`range-${s}`);
      if (el) el.innerHTML = '';
    }
    return;
  }

  for (let s = 0; s < game.numPlayers; s++) {
    if (s === ps) continue;
    const el = document.getElementById(`range-${s}`);
    if (!el) continue;

    if (game.eliminated[s] || game.folded[s] || !Range.hasRange(s)) {
      el.innerHTML = '';
      el.style.display = 'none';
      continue;
    }

    const pct = Range.getRangePercent(s);

    if (!hasBoard) {
      el.innerHTML = '';
      el.style.display = 'none';
      continue;
    }

    el.style.display = '';

    // Score-level equity breakdown
    const eq = Range.getEquityBreakdown(s, game.board, playerCards);
    if (!eq || eq.total === 0) {
      el.innerHTML = `<span style="opacity:.5">~${pct}%</span>`;
      continue;
    }

    const winPct = Math.round(eq.win / eq.total * 100);
    const losePct = Math.round(eq.lose / eq.total * 100);
    const tiePct = 100 - winPct - losePct;

    // Player's category for color-coding
    const pEval = evalBest([...playerCards, ...game.board]);
    const playerCat = pEval ? pEval.categoryIndex : -1;

    // Category bar chart rows (only categories with >0%)
    let catHtml = '';
    for (let cat = 9; cat >= 0; cat--) {
      if (eq.catPct[cat] === 0) continue;
      const cls = cat > playerCat ? 'cb-lose' : cat === playerCat ? 'cb-tie' : 'cb-win';
      catHtml +=
        '<div class="cb-row">' +
        '<span class="cb-lbl">' + _CAT_SHORT[cat] + '</span>' +
        '<div class="cb-track"><div class="cb-fill ' + cls + '" style="width:' + eq.catPct[cat] + '%"></div></div>' +
        '<span class="cb-pct">' + eq.catPct[cat] + '</span>' +
        '</div>';
    }

    // Delta arrow (persists for the entire street)
    let deltaHtml = '';
    const prev = _prevEquity[s];
    if (prev && prev.boardLen < boardLen) {
      const diff = losePct - prev.losePct;
      if (diff > 0) deltaHtml = `<span class="hd-delta hd-up">↑${diff}</span>`;
      else if (diff < 0) deltaHtml = `<span class="hd-delta hd-down">↓${Math.abs(diff)}</span>`;
    }

    // Assemble: category bars + equity bar + labels
    const html =
      catHtml +
      `<div class="eq-bar">` +
      `<div class="eq-bar-lose" style="width:${losePct}%"></div>` +
      `<div class="eq-bar-tie" style="width:${tiePct}%"></div>` +
      `<div class="eq-bar-win" style="width:${winPct}%"></div>` +
      `</div>` +
      `<div class="eq-labels">` +
      `<span class="eq-lose">◄${losePct}%${deltaHtml}</span>` +
      `<span class="eq-win">${winPct}%►</span>` +
      `</div>`;

    el.innerHTML = html;

    // Save for next street (only on street change)
    if (!_prevEquity[s] || _prevEquity[s].boardLen !== boardLen) {
      _prevEquity[s] = { boardLen, losePct };
    }
  }
}




// ── Master Render ─────────────────────────────────────────────────────────────

function renderAll(game, solverData) {
  for (let s = 0; s < NUM_SEATS; s++) renderSeat(game, s);
  renderBoard(game);
  renderResult(game);
  renderButtons(game);
  renderActionLog(game);
  renderSolver(game, solverData);
  renderRanges(game);

  // Session stats
  const sp = document.getElementById('stat-player-chips');
  const sh = document.getElementById('stat-hands');
  const _ps = game.playerSeat;
  if (sp) sp.textContent = _ps !== null ? `$${game.chips[_ps].toLocaleString()}` : '—';
  if (sh) sh.textContent = game.handsPlayed;

  // Dynamic blind title in header
  const mult = 1 << (game.betLevel || 0);
  const blindTitleEl = document.getElementById('header-title-blinds');
  if (blindTitleEl) blindTitleEl.textContent = `Limit ${SMALL_BET * mult}/${BIG_BET * mult}`;

  // Session stats - Bet sizes
  const sbEl = document.getElementById('stat-bet-sizes');
  if (sbEl) sbEl.textContent = `$${SMALL_BET * mult} / $${BIG_BET * mult}`;

  // Session stats - Next blind double countdown
  const nextDoubleRow = document.getElementById('stat-next-double-row');
  const nextDoubleEl = document.getElementById('stat-next-double');
  if (typeof blindDoublingHands !== 'undefined' && blindDoublingHands > 0) {
    if (nextDoubleRow) nextDoubleRow.style.display = '';
    const handsPlayed = game.handsPlayed || 0;
    const remaining = blindDoublingHands - (handsPlayed % blindDoublingHands);
    if (nextDoubleEl) nextDoubleEl.textContent = `in ${remaining} hand${remaining !== 1 ? 's' : ''}`;
  } else {
    if (nextDoubleRow) nextDoubleRow.style.display = 'none';
  }
}

// Called after each action to show bubble
function renderLastAction(game) {
  const lastEntry = game.actionHistory[game.actionHistory.length - 1];
  if (lastEntry) showActionBubble(lastEntry.seat, lastEntry.label);
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('toast-show'), 10);
  setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300); }, 2200);
}
