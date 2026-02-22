// game.js — Limit 30/60, 2–9 Player Texas Hold'em State Machine

class Game {
  constructor(numPlayers = 9, playerSeat = POS.PLAYER, betLevel = 0) {
    this.numPlayers = Math.max(2, Math.min(9, numPlayers));
    this.playerSeat = playerSeat;
    this.betLevel = betLevel;
    const rand = Math.floor(Math.random() * this.numPlayers);
    this.dealerSeat = (rand - 1 + this.numPlayers) % this.numPlayers;
    this.chips = Array.from({ length: NUM_SEATS }, () => STARTING_CHIPS);
    this.eliminated = Array(NUM_SEATS).fill(false); // persists across hands
    this.handsPlayed = 0;
    this.newHand();
  }

  newHand() {
    // Eliminate anyone who finished last hand with 0 chips
    for (let i = 0; i < this.numPlayers; i++) {
      if (this.chips[i] <= 0) this.eliminated[i] = true;
    }

    const alive    = (s) => !this.eliminated[s];
    const nextAlive = (from) => {
      for (let i = 1; i <= this.numPlayers; i++) {
        const s = (from + i) % this.numPlayers;
        if (alive(s)) return s;
      }
      return -1;
    };
    const aliveCount = this.eliminated
      .slice(0, this.numPlayers).filter(e => !e).length;

    // Game over: player bust, or only 1 survivor remains
    const mySeat = this.playerSeat ?? POS.PLAYER;
    if ((mySeat !== null && this.eliminated[mySeat]) || aliveCount < 2) {
      this.gameOver = true;
      this.bust      = mySeat !== null && this.eliminated[mySeat];
      this.tourWin   = !this.bust && aliveCount < 2;
      return;
    }

    // ── Reset per-hand state ─────────────────────────────────────────────────
    this.deck    = new Deck();
    this.board   = [];
    this.hands   = Array.from({ length: NUM_SEATS }, () => []);
    this.pot     = 0;
    this.street  = STREET.PREFLOP;
    this.bets    = Array(NUM_SEATS).fill(0);
    this.raiseCount   = 0;
    this.actionHistory = [];
    this.lastAction    = Array(NUM_SEATS).fill('');
    this.folded = Array(NUM_SEATS).fill(false);
    // Eliminated players are treated as already-folded for this hand
    for (let i = 0; i < this.numPlayers; i++) {
      if (this.eliminated[i]) this.folded[i] = true;
    }
    this.winner     = null;
    this.winners    = [];
    this.winnerHand = null;
    this.evalResults = {};
    this.gameOver   = false;
    this.bust       = false;
    this.tourWin    = false;

    // Advance dealer to next alive seat
    do {
      this.dealerSeat = (this.dealerSeat + 1) % this.numPlayers;
    } while (this.eliminated[this.dealerSeat]);

    // Blinds (HU special: BTN = SB)
    if (aliveCount === 2) {
      this.sbSeat = this.dealerSeat;
      this.bbSeat = nextAlive(this.dealerSeat);
    } else {
      this.sbSeat = nextAlive(this.dealerSeat);
      this.bbSeat = nextAlive(this.sbSeat);
    }
    // Snapshot chips before blinds (used by hand history export)
    this.chipsStart = [...this.chips];

    const mult = 1 << (this.betLevel || 0);
    this._postBlind(this.sbSeat, SMALL_BLIND * mult);
    this._postBlind(this.bbSeat, BIG_BLIND * mult);
    this.currentBet = BIG_BLIND * mult;
    this.raiseCount = 1;

    // Deal hole cards to alive players only
    for (let i = 0; i < this.numPlayers; i++) {
      if (!this.eliminated[i]) {
        this.hands[i] = [this.deck.deal(), this.deck.deal()];
      }
    }

    // Preflop first to act
    const utg = aliveCount === 2 ? this.sbSeat : nextAlive(this.bbSeat);
    this.toAct = utg;

    this.pendingAction = new Set(this.activePlayers());
    this.handsPlayed++;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Returns seats that haven't folded (eliminated seats are pre-folded)
  activePlayers() {
    const active = [];
    for (let i = 0; i < this.numPlayers; i++) {
      if (!this.folded[i]) active.push(i);
    }
    return active;
  }

  _postBlind(seat, amount) {
    const actual = Math.min(amount, this.chips[seat]);
    this.chips[seat] -= actual;
    this.bets[seat]  += actual;
    this.pot         += actual;
  }

  _nextActive(fromSeat) {
    for (let i = 1; i <= this.numPlayers; i++) {
      const s = (fromSeat + i) % this.numPlayers;
      if (!this.folded[s]) return s;
    }
    return -1;
  }

  _nextPending(fromSeat) {
    for (let i = 1; i <= this.numPlayers; i++) {
      const s = (fromSeat + i) % this.numPlayers;
      if (this.pendingAction.has(s)) return s;
    }
    return -1;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  legalActions() {
    const seat    = this.toAct;
    const myBet   = this.bets[seat];
    const maxBet  = Math.max(...this.bets.slice(0, this.numPlayers));
    const callAmt = maxBet - myBet;
    const betSize = this.betSize();
    const actions = ['fold'];

    if (callAmt <= 0) {
      actions.push('check');
    } else {
      actions.push({ action: 'call', amount: Math.min(callAmt, this.chips[seat]) });
    }

    if (this.raiseCount < MAX_RAISES && this.chips[seat] > Math.max(callAmt, 0)) {
      if (callAmt <= 0) {
        actions.push({ action: 'bet',   amount: betSize });
      } else {
        actions.push({ action: 'raise', amount: callAmt + betSize });
      }
    }

    return actions;
  }

  applyAction(actionObj) {
    if (this.gameOver) return;
    const seat = this.toAct;

    const isFold       = actionObj === 'fold'  || (actionObj && actionObj.action === 'fold');
    const isCheck      = actionObj === 'check' || (actionObj && actionObj.action === 'check');
    const isAggressive = actionObj && (actionObj.action === 'bet' || actionObj.action === 'raise');

    let label = '';

    if (isFold) {
      this.folded[seat] = true;
      label = 'Fold';
      this.pendingAction.delete(seat);

    } else if (isCheck) {
      label = 'Check';
      this.pendingAction.delete(seat);

    } else if (actionObj.action === 'call') {
      const maxBet  = Math.max(...this.bets.slice(0, this.numPlayers));
      const callAmt = maxBet - this.bets[seat];
      const amt     = Math.min(callAmt, this.chips[seat]);
      this.chips[seat] -= amt;
      this.bets[seat]  += amt;
      this.pot         += amt;
      label = `Call $${amt}`;
      this.pendingAction.delete(seat);

    } else if (isAggressive) {
      const betSize = this.betSize();
      const maxBet  = Math.max(...this.bets.slice(0, this.numPlayers));
      const callAmt = Math.max(0, maxBet - this.bets[seat]);
      const totalAdd = Math.min(callAmt + betSize, this.chips[seat]);
      this.chips[seat] -= totalAdd;
      this.bets[seat]  += totalAdd;
      this.pot         += totalAdd;
      this.raiseCount++;
      label = actionObj.action === 'bet' ? `Bet $${betSize}` : `Raise $${betSize}`;
      this.pendingAction.clear();
      for (const s of this.activePlayers()) {
        if (s !== seat) this.pendingAction.add(s);
      }
    }

    this.lastAction[seat] = label;
    this.actionHistory.push({ seat, label, street: this.street, name: SEAT_NAMES[seat], totalBet: this.bets[seat] });

    const active = this.activePlayers();
    if (active.length === 1) {
      this.winner = active[0];
      this.chips[active[0]] += this.pot;
      this.gameOver = true;
      this.winnerHand = { categoryName: 'Fold Win', bestCards: [] };
      return;
    }

    if (this.pendingAction.size === 0) {
      this._nextStreet();
    } else {
      this.toAct = this._nextPending(seat);
    }
  }

  // ── Street Transitions ────────────────────────────────────────────────────

  _nextStreet() {
    this.bets       = Array(NUM_SEATS).fill(0);
    this.raiseCount = 0;
    this.lastAction = Array(NUM_SEATS).fill('');
    this.street++;

    if (this.street > STREET.RIVER) {
      this._doShowdown();
      return;
    }

    this.deck.burn();
    if (this.street === STREET.FLOP) {
      this.board.push(...this.deck.deal(3));
    } else {
      this.board.push(this.deck.deal());
    }

    const active = this.activePlayers();
    this.pendingAction = new Set(active);
    this.toAct = this._nextActive(this.dealerSeat);
  }

  _doShowdown() {
    this.street   = STREET.SHOWDOWN;
    this.gameOver = true;
    const active  = this.activePlayers();

    this.evalResults = {};
    for (const s of active) {
      this.evalResults[s] = evalBest([...this.hands[s], ...this.board]);
    }

    let bestScore = -1;
    for (const s of active) {
      if (this.evalResults[s].score > bestScore) bestScore = this.evalResults[s].score;
    }
    this.winners = active.filter(s => this.evalResults[s].score === bestScore);

    const share = Math.floor(this.pot / this.winners.length);
    for (const w of this.winners) this.chips[w] += share;
    this.chips[this.winners[0]] += this.pot - share * this.winners.length;

    this.winner     = this.winners.length === 1 ? this.winners[0] : -1;
    this.winnerHand = this.evalResults[this.winners[0]];
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  streetName()   { return STREET_NAMES[this.street] || 'Showdown'; }
  betSize()      { const mult = 1 << (this.betLevel || 0); return (this.street <= STREET.FLOP ? SMALL_BET : BIG_BET) * mult; }
  callAmount()   {
    const seat   = this.toAct;
    const maxBet = Math.max(...this.bets.slice(0, this.numPlayers));
    return Math.max(0, maxBet - this.bets[seat]);
  }
  isPlayerTurn() { return !this.gameOver && this.toAct === this.playerSeat; }
}
