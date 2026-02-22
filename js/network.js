// network.js — Firebase Realtime Database multiplayer layer
// Symmetric model: Host/Guest both get full UI; Host runs game logic + AI.
// All non-host players send actions via Firebase; Host applies and pushes state.

// ── Firebase config ───────────────────────────────────────────────────────────
// FIREBASE_CONFIG is now loaded from js/config.js to keep API keys secure

if (!firebase.apps || firebase.apps.length === 0) {
  firebase.initializeApp(FIREBASE_CONFIG);
}
const db = firebase.database();

// ── Helpers ───────────────────────────────────────────────────────────────────

function _genRoomId() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

function _publicGameState(game, humanSeats) {
  return {
    toAct: game.toAct,
    bets: game.bets.slice(),
    pot: game.pot,
    chips: game.chips.slice(),
    folded: game.folded.slice(),
    eliminated: game.eliminated.slice(),
    street: game.street,
    board: game.board.slice(),
    handsPlayed: game.handsPlayed,
    gameOver: game.gameOver,
    bust: game.bust ?? false,
    tourWin: game.tourWin ?? false,
    winner: game.winner ?? -1,
    winners: game.winners ? game.winners.slice() : [],
    winnerHand: game.winnerHand ? { categoryName: game.winnerHand.categoryName, bestCards: game.winnerHand.bestCards ? game.winnerHand.bestCards.slice() : [] } : null,
    dealerSeat: game.dealerSeat,
    sbSeat: game.sbSeat ?? -1,
    bbSeat: game.bbSeat ?? -1,
    chipsStart: game.chipsStart ? game.chipsStart.slice() : [],
    numPlayers: game.numPlayers,
    betLevel: game.betLevel || 0,
    raiseCount: game.raiseCount,
    lastAction: game.lastAction ? game.lastAction.slice() : [],
    evalResults: (() => {
      const arr = Array(NUM_SEATS).fill(null);
      if (game.evalResults) {
        for (let i = 0; i < NUM_SEATS; i++) {
          const r = game.evalResults[i];
          if (r) arr[i] = { categoryName: r.categoryName, bestCards: r.bestCards ? r.bestCards.slice() : [] };
        }
      }
      return arr;
    })(),
    hands: game.hands ? game.hands.map(h => (h ? h.slice() : [])) : [],
    humanSeats: humanSeats ? humanSeats.slice() : [],
    playerNames: game.playerNames ? { ...game.playerNames } : {},
    actionHistory: game.actionHistory ? game.actionHistory.map(e => ({ ...e })) : [],
  };
}

// ── Network object ────────────────────────────────────────────────────────────

const Network = {
  roomId: null,
  mySeat: null,
  myName: null,
  humanSeats: [],
  _lastActionId: null,

  // ── Host: create room (status = 'waiting', game not started yet) ───────────
  async createRoom(numPlayers, hostName = 'Host') {
    const roomId = _genRoomId();
    this.roomId = roomId;
    this.mySeat = 0;
    this.myName = hostName;
    this.humanSeats = [0];

    await db.ref(`rooms/${roomId}/meta`).set({
      numPlayers,
      status: 'waiting',          // ← waiting for Host to click Start
      humanSeats: [0],
      playerNames: { '0': hostName },
      createdAt: Date.now(),
    });

    return roomId;
  },

  // ── Any client: join a room ────────────────────────────────────────────────
  // Returns:
  //   { numPlayers, mySeat, status: 'waiting' }  → pre-game, seat assigned now
  //   { numPlayers, pushKey, status: 'playing' } → mid-game, queued; seat assigned at hand end
  async joinRoom(roomId, playerName = 'Guest') {
    this.roomId = roomId.trim();
    this.myName = playerName;

    const snap = await db.ref(`rooms/${this.roomId}/meta`).get();
    if (!snap.exists()) throw new Error('Room not found: ' + this.roomId);

    const meta = snap.val();

    if (meta.status === 'waiting') {
      // Pre-game: assign seat immediately
      const taken = Array.isArray(meta.humanSeats) ? meta.humanSeats : Object.values(meta.humanSeats || {});
      const available = [];
      for (let i = 1; i < meta.numPlayers; i++) {
        if (!taken.includes(i)) available.push(i);
      }
      if (available.length === 0) throw new Error('Room is full');
      const newSeat = available[Math.floor(Math.random() * available.length)];

      this.mySeat = newSeat;
      const newHumanSeats = [...taken, newSeat];
      this.humanSeats = newHumanSeats;

      await db.ref(`rooms/${this.roomId}/meta`).update({
        humanSeats: newHumanSeats,
        [`playerNames/${newSeat}`]: playerName,
      });

      return { numPlayers: meta.numPlayers, mySeat: newSeat, status: 'waiting' };
    } else {
      // Mid-game: join queue; AI plays this hand, player takes over next hand
      const pushRef = db.ref(`rooms/${this.roomId}/joinQueue`).push();
      await pushRef.set({ name: playerName, joinedAt: Date.now() });
      return { numPlayers: meta.numPlayers, pushKey: pushRef.key, status: 'playing' };
    }
  },

  // ── Host: signal game start ────────────────────────────────────────────────
  async startGame() {
    await db.ref(`rooms/${this.roomId}/meta/status`).set('playing');
  },

  // ── Any client: listen for player list changes (waiting room) ──────────────
  listenForPlayers(callback) {
    db.ref(`rooms/${this.roomId}/meta`).on('value', snap => {
      if (snap.val()) callback(snap.val());
    });
  },

  // ── Guest: listen for Host to start the game ──────────────────────────────
  listenForGameStart(callback) {
    const ref = db.ref(`rooms/${this.roomId}/meta/status`);
    const handler = snap => {
      if (snap.val() === 'playing') {
        ref.off('value', handler);
        callback();
      }
    };
    ref.on('value', handler);
  },

  // ── Host: push full game state + private cards to Firebase ─────────────────
  pushGameState(game) {
    const ref = db.ref(`rooms/${this.roomId}`);
    ref.child('gameState').set(_publicGameState(game, this.humanSeats));
    const privateCards = {};
    this.humanSeats.forEach(s => {
      if (game.hands && game.hands[s]) privateCards[`seat${s}`] = game.hands[s];
    });
    ref.child('privateCards').set(privateCards);
  },

  // ── Host: update humanSeats in Firebase meta ───────────────────────────────
  updateHumanSeats(seats) {
    this.humanSeats = seats;
    if (this.roomId) {
      db.ref(`rooms/${this.roomId}/meta/humanSeats`).set(seats);
    }
  },

  // ── Non-host: send action to Host ─────────────────────────────────────────
  sendAction(actionObj) {
    db.ref(`rooms/${this.roomId}/actions/pending`).set({
      seat: this.mySeat,
      action: actionObj,
      id: Date.now().toString(),
    });
  },

  // ── Host: listen for any human player's action ─────────────────────────────
  listenForHumanAction(callback) {
    db.ref(`rooms/${this.roomId}/actions/pending`).on('value', snap => {
      const data = snap.val();
      if (!data) return;
      if (data.id === this._lastActionId) return;
      this._lastActionId = data.id;
      callback(data);
      db.ref(`rooms/${this.roomId}/actions/pending`).remove();
    });
  },

  // ── Host: listen for mid-game join requests ────────────────────────────────
  listenForJoinQueue(callback) {
    db.ref(`rooms/${this.roomId}/joinQueue`).on('child_added', snap => {
      callback({ key: snap.key, ...snap.val() });
    });
  },

  // ── Host: assign a queued player to a seat ────────────────────────────────
  // Only writes seatAssignment + playerName; humanSeats update happens at hand end.
  async assignSeat(queueKey, newSeat, playerName) {
    const updates = {};
    updates[`rooms/${this.roomId}/seatAssignments/${queueKey}`] = newSeat;
    updates[`rooms/${this.roomId}/joinQueue/${queueKey}`] = null;
    updates[`rooms/${this.roomId}/meta/playerNames/${newSeat}`] = playerName;
    await db.ref().update(updates);
  },

  // ── Observer: wait for seat assignment ─────────────────────────────────────
  listenForSeatAssignment(pushKey, callback) {
    const ref = db.ref(`rooms/${this.roomId}/seatAssignments/${pushKey}`);
    const handler = snap => {
      const val = snap.val();
      if (val !== null && val !== undefined) {
        ref.off('value', handler);
        callback(val);
      }
    };
    ref.on('value', handler);
  },

  // ── Non-host: listen for game state updates ────────────────────────────────
  listenForStateUpdate(onGameState) {
    db.ref(`rooms/${this.roomId}/gameState`).on('value', snap => {
      if (snap.val()) onGameState(snap.val());
    });
  },

  // ── Non-host: listen for own private cards (call when mySeat is known) ─────
  listenForPrivateCards(onMyCards) {
    if (this.mySeat === null) return;
    db.ref(`rooms/${this.roomId}/privateCards/seat${this.mySeat}`).on('value', snap => {
      if (snap.val()) onMyCards(snap.val());
    });
  },

  // ── Host: close room (sets status = 'closed' so all clients can detect) ────
  async closeRoom() {
    if (!this.roomId) return;
    await db.ref(`rooms/${this.roomId}/meta/status`).set('closed');
  },

  // ── Any client: listen for the room being closed by Host ──────────────────
  listenForRoomClosed(callback) {
    if (!this.roomId) return;
    db.ref(`rooms/${this.roomId}/meta/status`).on('value', snap => {
      if (snap.val() === 'closed') callback();
    });
  },

  // ── Guest: remove own seat from humanSeats so Host's AI takes over ─────────
  async leaveAsGuest() {
    if (!this.roomId || this.mySeat === null) return;
    const mySeat = this.mySeat;
    await db.ref(`rooms/${this.roomId}/meta`).transaction(meta => {
      if (!meta) return meta;
      if (Array.isArray(meta.humanSeats)) {
        meta.humanSeats = meta.humanSeats.filter(s => s !== mySeat);
      }
      return meta;
    });
  },

  // ── Cleanup ────────────────────────────────────────────────────────────────
  detach() {
    if (!this.roomId) return;
    db.ref(`rooms/${this.roomId}/gameState`).off();
    db.ref(`rooms/${this.roomId}/actions/pending`).off();
    db.ref(`rooms/${this.roomId}/joinQueue`).off();
    db.ref(`rooms/${this.roomId}/meta`).off();
    db.ref(`rooms/${this.roomId}/meta/status`).off();
    if (this.mySeat !== null) {
      db.ref(`rooms/${this.roomId}/privateCards/seat${this.mySeat}`).off();
    }
  },
};