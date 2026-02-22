// main.js — App bootstrap & event bindings (2–9 players)

let game = null;
let solverData = null;
let aiThinking = false;
let currentNumPlayers = 9;

// ── Multiplayer state ─────────────────────────────────────────────────────────
let multiplayerMode = false;  // false = solo / single-player
let isHost = false;
let _myPrivateCards = null;     // Non-host: caches own hole cards across state updates
let humanSeats = [];            // seats of currently-active human players
let _pendingHumanSeats = [];    // seats assigned but not yet active (AI plays this hand)
let _assignedSeat = null;       // observer: seat they'll take over next hand

// ── AutoPlay state ────────────────────────────────────────────────────────────
let autoPlayOn = false;
let _autoPlayTimer = null;

// ── Blind doubling ────────────────────────────────────────────────────────────
let blindDoublingHands = 9;  // 0 = never; set from select (pre-multiplied hand count)

// ── Random player names for default ────────────────────────────────────────
const DEFAULT_NAMES = [
  'Alice', 'Bob', 'Charlie', 'Diana', 'Emma', 'Frank', 'Grace', 'Henry',
  'Ivy', 'Jack', 'Kate', 'Leo', 'Maya', 'Nathan', 'Olivia', 'Peter',
  'Quinn', 'Rachel', 'Sam', 'Tina', 'Uma', 'Victor', 'Wendy', 'Xavier',
  'Yara', 'Zoe', 'Alex', 'Bailey', 'Casey', 'Dakota', 'Evan', 'Fiona',
];

function getRandomName() {
  return DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)];
}

// ── Sound helpers ─────────────────────────────────────────────────────────────

function playSoundForAction(actionObj) {
  const act = typeof actionObj === 'string' ? actionObj : (actionObj && actionObj.action);
  if (act === 'fold') _SFX.fold();
  else if (act === 'check') _SFX.check();
  else _SFX.chip();   // call, bet, raise
}

// Play a quick sequence of card-deal swishes (capped to keep it snappy)
function playDealSequence(n) {
  const count = Math.min(n, 6);
  for (let i = 0; i < count; i++) _SFX.deal(i * 0.08);
}

function playResultSound(g) {
  if (!g.gameOver) return;
  if (g.playerSeat === null) return;  // observer: no personal win/lose sound
  const won = (g.winners || []).includes(g.playerSeat);
  setTimeout(() => won ? _SFX.win() : _SFX.lose(), 250);
}

/**
 * Host: mid-game join request arrives.
 * Assign a seat immediately so the observer can rotate their table view,
 * but the seat won't be active (AI plays) until the current hand ends.
 */
function handleJoinRequest({ key, name }) {
  if (!game) return;
  // Find first seat not taken by any human (active or pending)
  const allTaken = [...humanSeats, ..._pendingHumanSeats.map(p => p.seat)];
  let newSeat = 1;
  while (allTaken.includes(newSeat)) newSeat++;
  if (newSeat >= game.numPlayers) return;   // no available AI seats

  _pendingHumanSeats.push({ seat: newSeat, name, key });
  game.playerNames = game.playerNames || {};
  game.playerNames[newSeat] = name;
  // Write seatAssignment immediately so observer knows their future seat
  Network.assignSeat(key, newSeat, name);
  // Push updated state so observer sees correct playerNames
  Network.pushGameState(game);
}

/**
 * Host: at each hand end, promote pending observers to active human seats.
 * They'll receive private cards and take actions from the next hand.
 */
function processJoinQueue() {
  if (!isHost) return;
  if (_pendingHumanSeats.length === 0) return;
  _pendingHumanSeats.forEach(({ seat }) => humanSeats.push(seat));
  _pendingHumanSeats = [];
  Network.updateHumanSeats(humanSeats);
}

// ── Shared render pipeline ────────────────────────────────────────────────────

/** Shared post-state-change render + history pipeline (host, guest, solo). */
function _renderAfterState(boardBefore) {
  if (!game) return;
  if (game.board.length > boardBefore) playDealSequence(game.board.length - boardBefore);
  renderLastAction(game);
  updateSolver();
  renderAll(game, solverData);
  playResultSound(game);
  onHandEnd(game);
  if (!game.gameOver && game.isPlayerTurn() && autoPlayOn) startAutoPlayCountdown();
}

/** Host/Solo: render + push to Firebase + schedule next AI turn. */
function _afterLocalAction(boardBefore) {
  _renderAfterState(boardBefore);
  if (multiplayerMode && isHost) Network.pushGameState(game);
  if (!game.gameOver && !game.isPlayerTurn()) {
    scheduleAI();
  } else {
    aiThinking = false;
  }
}

// ── AutoPlay ──────────────────────────────────────────────────────────────────

/** Map a solver recommendation string to a concrete legal action object. */
function solverRecToAction(rec, legalActions) {
  const canCheck = legalActions.includes('check');
  const callObj = legalActions.find(a => a?.action === 'call');
  const betObj = legalActions.find(a => a?.action === 'bet');
  const raiseObj = legalActions.find(a => a?.action === 'raise');
  switch (rec?.action) {
    case 'Raise': return raiseObj || callObj || (canCheck ? 'check' : 'fold');
    case 'Bet': return betObj || (canCheck ? 'check' : callObj || 'fold');
    case 'Call': return callObj || (canCheck ? 'check' : 'fold');
    case 'Check': return canCheck ? 'check' : (callObj || 'fold');
    case 'Fold': return 'fold';
    default: return canCheck ? 'check' : (callObj || 'fold');
  }
}

function cancelAutoPlay() {
  clearTimeout(_autoPlayTimer);
  _autoPlayTimer = null;
  const el = document.getElementById('autoplay-countdown');
  if (el) el.style.display = 'none';
}

function startAutoPlayCountdown() {
  if (!autoPlayOn || !game) return;
  // Two scenarios for AutoPlay:
  // 1) Mid-hand action (3s) — only if it's our turn
  // 2) New hand trigger (5s) — only if game is over AND we are Host / Solo
  const isOurTurn = !game.gameOver && game.isPlayerTurn();
  const isHostOrSolo = !multiplayerMode || isHost;
  const isNewHandTrigger = game.gameOver && isHostOrSolo;

  if (!isOurTurn && !isNewHandTrigger) return;

  clearTimeout(_autoPlayTimer);
  let remaining = isNewHandTrigger ? 5 : 3;

  const el = document.getElementById('autoplay-countdown');
  if (el) { el.style.display = 'block'; el.textContent = remaining; }

  function tick() {
    remaining--;
    if (el) el.textContent = remaining;
    if (remaining <= 0) {
      if (el) el.style.display = 'none';
      if (isNewHandTrigger) {
        startNewHand();
      } else {
        const legal = game.legalActions();
        const action = solverRecToAction(solverData?.rec, legal);
        if (action) handlePlayerAction(action);
      }
    } else {
      _autoPlayTimer = setTimeout(tick, 1000);
    }
  }
  _autoPlayTimer = setTimeout(tick, 1000);
}

// ── Blind doubling notification ───────────────────────────────────────────────

function _showBlindNotification(betLevel) {
  const mult = 1 << betLevel;
  showToast(`Blinds doubled! Limit ${SMALL_BET * mult}/${BIG_BET * mult}`, 'info');
}

// ── Leave Room ────────────────────────────────────────────────────────────────

function resetToLobby(message = '') {
  cancelAutoPlay();
  if (!multiplayerMode && !game) return;  // already in lobby
  game = null; aiThinking = false;
  multiplayerMode = false; isHost = false;
  humanSeats = []; _pendingHumanSeats = []; _assignedSeat = null; _myPrivateCards = null;
  Network.detach();
  Network.roomId = null; Network.mySeat = null;
  document.getElementById('game-root').style.display = 'none';
  document.getElementById('lobby-screen').style.display = '';
  document.getElementById('room-id-badge').style.display = 'none';
  document.getElementById('waiting-room').style.display = 'none';
  document.getElementById('btn-leave-room').style.display = 'none';
  document.getElementById('lobby-status').textContent = message;
  const nameInput = document.getElementById('player-name-input');
  if (nameInput) nameInput.value = getRandomName();
}

async function leaveRoom() {
  if (!multiplayerMode) { resetToLobby(); return; }
  if (isHost) {
    // Detach first so we don't trigger our own listenForRoomClosed callback
    Network.detach();
    await Network.closeRoom();
  } else {
    await Network.leaveAsGuest();
  }
  resetToLobby();
}

function onHandEnd(g) {
  if (!g.gameOver) return;
  // Host processes join queue so new players get seats for the next hand
  if (multiplayerMode && isHost) processJoinQueue();

  // Blind doubling — only host/solo advances betLevel; guest syncs from Firebase
  if (!multiplayerMode || isHost) {
    if (blindDoublingHands > 0 && g.handsPlayed > 0 && g.handsPlayed % blindDoublingHands === 0) {
      game.betLevel = (game.betLevel || 0) + 1;
      _showBlindNotification(game.betLevel);
    }
  }

  History.record(g);
  const el = document.getElementById('history-count');
  const n = History.count();
  if (el) el.textContent = `${n} hand${n !== 1 ? 's' : ''}`;
  Panels.refresh();

  // If AutoPlay is enabled and game is over, start 5s countdown to next hand
  if (g.gameOver) {
    startAutoPlayCountdown();
  }
}

// ── Game flow ─────────────────────────────────────────────────────────────────

function startNewHand() {
  if (multiplayerMode && !isHost) return;  // Guest cannot trigger new hands
  // If session is fully over (bust or tournament win), reset everything
  if (game && (game.bust || game.tourWin)) {
    startNewGame(currentNumPlayers);
    return;
  }
  aiThinking = false;
  for (let s = 0; s < NUM_SEATS; s++) _cardCache[s] = null;
  _boardCache = '';
  if (game) {
    game.newHand();
  } else {
    game = new Game(currentNumPlayers);
  }
  applyTableLayout(game.numPlayers, game.playerSeat ?? 0);
  Range.resetAll(game.numPlayers);
  _resetPrevDist();
  updateSolver();
  renderAll(game, solverData);
  if (!game.gameOver) playDealSequence(game.numPlayers * 2);
  if (multiplayerMode && isHost) Network.pushGameState(game);
  if (!game.gameOver && !game.isPlayerTurn()) scheduleAI();
}

function startNewGame(numPlayers) {
  aiThinking = false;
  currentNumPlayers = numPlayers;
  for (let s = 0; s < NUM_SEATS; s++) _cardCache[s] = null;
  _boardCache = '';
  game = new Game(numPlayers);
  applyTableLayout(numPlayers, game.playerSeat ?? 0);
  Range.resetAll(numPlayers);
  _resetPrevDist();
  updateSolver();
  renderAll(game, solverData);
  playDealSequence(numPlayers * 2);
  if (multiplayerMode && isHost) Network.pushGameState(game);
  if (!game.gameOver && !game.isPlayerTurn()) scheduleAI();
}

function updateSolver() {
  const ps = game ? game.playerSeat : POS.PLAYER;
  if (!game || ps === null || game.hands[ps].length < 2 || game.folded[ps]) {
    solverData = null;
    return;
  }
  solverData = solverAnalyze(game);
}

function handlePlayerAction(actionObj) {
  if (!game || game.gameOver || !game.isPlayerTurn() || aiThinking) return;
  cancelAutoPlay();
  const boardBefore = game.board.length;
  playSoundForAction(actionObj);

  if (multiplayerMode && !isHost) {
    // Non-host: send action to Firebase; Host will apply and push back new state
    Network.sendAction(actionObj);
    return;
  }

  game.applyAction(actionObj);
  Range.update(game);
  _afterLocalAction(boardBefore);
}

function scheduleAI() {
  if (multiplayerMode && !isHost) return;   // Non-host never drives AI
  if (!game || game.gameOver || game.isPlayerTurn()) { aiThinking = false; return; }
  // In multiplayer, wait for any other human seat's action instead of auto-deciding
  if (multiplayerMode && isHost && humanSeats.includes(game.toAct)) { aiThinking = false; return; }
  aiThinking = true;
  setTimeout(() => {
    if (!game || game.gameOver) { aiThinking = false; return; }
    if (game.isPlayerTurn()) { aiThinking = false; return; }
    if (multiplayerMode && isHost && humanSeats.includes(game.toAct)) { aiThinking = false; return; }
    const boardBefore = game.board.length;
    const action = aiDecide(game, game.toAct);
    playSoundForAction(action);
    game.applyAction(action);
    Range.update(game);
    _afterLocalAction(boardBefore);
    // aiThinking is managed by the next scheduleAI call (via _afterLocalAction)
    // or set to false there if game is over / player's turn
  }, 450 + Math.random() * 650);
}

// ── Multiplayer helpers ───────────────────────────────────────────────────────

/** Host: called when any non-host human player's action arrives from Firebase */
function applyHumanAction(data) {
  if (!game || game.gameOver) return;
  if (!humanSeats.includes(data.seat)) return;  // safety: only accept from known humans
  if (data.seat !== game.toAct) return;          // safety: ignore mismatched seat
  const boardBefore = game.board.length;
  playSoundForAction(data.action);
  game.applyAction(data.action);
  Range.update(game);
  _afterLocalAction(boardBefore);
}

/** Non-host: apply a public gameState snapshot received from Firebase */
function applyRemoteState(state) {
  if (!game || !state) return;
  const boardBefore = game.board.length;
  const prevHandsPlayed = game.handsPlayed;
  // mySeat starts as current playerSeat; may be updated below if observer activates
  let mySeat = game.playerSeat;

  game.toAct = state.toAct;
  game.bets = state.bets || game.bets;
  game.pot = state.pot;
  game.chips = state.chips || game.chips;
  game.folded = state.folded || game.folded;
  game.eliminated = state.eliminated || game.eliminated;
  game.street = state.street;
  game.board = state.board || [];
  game.handsPlayed = state.handsPlayed;
  game.gameOver = state.gameOver;
  game.bust = state.bust;
  game.tourWin = state.tourWin;
  game.winner = state.winner ?? -1;
  game.winners = state.winners || [];
  game.winnerHand = state.winnerHand || null;
  game.dealerSeat = state.dealerSeat;
  game.sbSeat = state.sbSeat;
  game.bbSeat = state.bbSeat;
  if (state.chipsStart && state.chipsStart.length > 0) game.chipsStart = state.chipsStart;
  game.raiseCount = state.raiseCount;
  if (state.betLevel !== undefined) game.betLevel = state.betLevel;
  game.lastAction = state.lastAction || game.lastAction;
  // Convert evalResults array back to object (keyed by seat)
  if (state.evalResults) {
    game.evalResults = {};
    for (let i = 0; i < NUM_SEATS; i++) {
      if (state.evalResults[i]) game.evalResults[i] = state.evalResults[i];
    }
  }
  // All hole cards (AI showdown rendering needs actual cards)
  if (state.hands) game.hands = state.hands.map(h => (h ? [...h] : []));
  // Clear stale private cards on new hand so they don't override the fresh state.hands
  if (state.handsPlayed !== prevHandsPlayed) _myPrivateCards = null;
  // Re-apply own private cards — may have arrived in a different Firebase event
  if (_myPrivateCards) game.hands[Network.mySeat] = _myPrivateCards;
  // Sync humanSeats and player names
  if (state.humanSeats) {
    const prevHumanSeats = humanSeats.slice();
    humanSeats = Array.isArray(state.humanSeats) ? state.humanSeats : Object.values(state.humanSeats);
    Network.humanSeats = humanSeats;

    // Observer becomes active player when their assigned seat enters humanSeats
    if (_assignedSeat !== null && mySeat === null && humanSeats.includes(_assignedSeat)) {
      mySeat = _assignedSeat;   // update local so the final assignment below uses the new seat
      Network.mySeat = _assignedSeat;
      _assignedSeat = null;
      applyTableLayout(game.numPlayers, mySeat);
      // Start listening for private cards now that we have an active seat
      Network.listenForPrivateCards((cards) => {
        _myPrivateCards = cards;
        if (game) { game.hands[Network.mySeat] = cards; updateSolver(); renderAll(game, solverData); }
      });
    }
  }
  if (state.playerNames) game.playerNames = { ...state.playerNames };
  // Restore/set seat identity after all state fields are overwritten
  game.playerSeat = mySeat;

  // Track action history delta before we overwrite it
  const prevHistoryLen = game.actionHistory ? game.actionHistory.length : 0;
  if (state.actionHistory) game.actionHistory = state.actionHistory;

  // On new hand: clear caches, reset Range, replay full new-hand history
  if (game.handsPlayed !== prevHandsPlayed) {
    for (let s = 0; s < NUM_SEATS; s++) _cardCache[s] = null;
    _boardCache = '';
    Range.resetAll(game.numPlayers);
    _resetPrevDist();
    playDealSequence(game.numPlayers * 2);
    // Replay every action in the new hand so Range weights are up to date
    for (let i = 0; i < (game.actionHistory || []).length; i++) {
      Range.update({ ...game, actionHistory: game.actionHistory.slice(0, i + 1) });
    }
  } else {
    // Same hand: replay only newly arrived actions (delta)
    for (let i = prevHistoryLen; i < (game.actionHistory || []).length; i++) {
      Range.update({ ...game, actionHistory: game.actionHistory.slice(0, i + 1) });
    }
  }

  _renderAfterState(boardBefore);
}

// ── Lobby helpers ─────────────────────────────────────────────────────────────

function _showGame(roomId = null) {
  document.getElementById('lobby-screen').style.display = 'none';
  const gameRoot = document.getElementById('game-root');
  if (gameRoot) gameRoot.style.display = '';
  // Show Room ID badge in game header so late joiners can use it
  if (roomId) {
    const badge = document.getElementById('room-id-badge');
    const rid = document.getElementById('header-room-id');
    if (badge) badge.style.display = '';
    if (rid) rid.textContent = roomId;
  }
  // Show Leave Room button only in multiplayer
  const btnLeave = document.getElementById('btn-leave-room');
  if (btnLeave) btnLeave.style.display = multiplayerMode ? '' : 'none';
}

/** Render the player list in the waiting room */
function _updatePlayerList(meta) {
  const list = document.getElementById('player-list');
  if (!list) return;
  const seats = Array.isArray(meta.humanSeats) ? meta.humanSeats : Object.values(meta.humanSeats || {});
  const names = meta.playerNames || {};
  list.innerHTML = seats.map(s =>
    `<div>${s === 0 ? '👑' : '👤'} ${names[s] || `Seat ${s}`}${s === Network.mySeat ? ' <span style="color:#8aaa8a;font-size:0.8em;">(you)</span>' : ''}</div>`
  ).join('') || '<div style="color:#8aaa8a;">—</div>';
}

/** Solo mode: start immediately, no Firebase */
function initSoloGame() {
  multiplayerMode = false;
  isHost = false;
  _showGame();
  startNewGame(currentNumPlayers);
}

/** Host: create room → show waiting room → on Start click → enter game */
async function initHostGame() {
  const btnHost = document.getElementById('btn-host');
  btnHost.disabled = true;
  try {
    const hostName = document.getElementById('player-name-input').value.trim() || getRandomName();
    const roomId = await Network.createRoom(currentNumPlayers, hostName);

    // Show waiting room in lobby
    document.getElementById('waiting-room').style.display = 'block';
    document.getElementById('display-room-id').textContent = roomId;
    document.getElementById('btn-start-game').style.display = 'block';
    document.getElementById('lobby-status').textContent = 'Share the Room ID, then click Start Game when everyone is in.';

    // Live player list while waiting; keep Network.humanSeats up-to-date
    let _latestMeta = { humanSeats: [0], playerNames: { '0': hostName } };
    Network.listenForPlayers((meta) => {
      _latestMeta = meta;
      if (meta.humanSeats) {
        Network.humanSeats = Array.isArray(meta.humanSeats)
          ? meta.humanSeats.map(Number)
          : Object.values(meta.humanSeats).map(Number);
      }
      _updatePlayerList(meta);
    });

    // Host clicks "Start Game" → begin
    document.getElementById('btn-start-game').onclick = async () => {
      document.getElementById('btn-start-game').disabled = true;
      await Network.startGame();   // set status = 'playing' in Firebase

      multiplayerMode = true;
      isHost = true;
      humanSeats = Network.humanSeats.slice();   // everyone who joined the waiting room
      _pendingHumanSeats = [];
      _showGame(roomId);

      aiThinking = false;
      game = new Game(currentNumPlayers, 0);
      game.playerNames = { ...(_latestMeta.playerNames || {}) };
      applyTableLayout(game.numPlayers, 0);
      Range.resetAll(game.numPlayers);
      _resetPrevDist();
      updateSolver();
      Network.pushGameState(game);
      renderAll(game, solverData);
      playDealSequence(game.numPlayers * 2);
      Network.listenForHumanAction(applyHumanAction);
      Network.listenForJoinQueue(handleJoinRequest);
      // Monitor for guests leaving mid-game (their seat removed from meta.humanSeats)
      Network.listenForPlayers(meta => {
        if (!isHost) return;
        const newSeats = Array.isArray(meta.humanSeats)
          ? meta.humanSeats.map(Number)
          : Object.values(meta.humanSeats || {}).map(Number);
        humanSeats = newSeats;
        Network.humanSeats = newSeats;
      });
      // If Host leaves, notify guests
      Network.listenForRoomClosed(() => resetToLobby('Host has left — room closed.'));
      if (!game.gameOver && !game.isPlayerTurn()) scheduleAI();
    };
  } catch (err) {
    alert('Error creating room: ' + err.message);
    btnHost.disabled = false;
    document.getElementById('waiting-room').style.display = 'none';
    document.getElementById('lobby-status').textContent = '';
  }
}

/** Guest: join a room — handles waiting room (pre-game) and mid-game observer */
async function initGuestGame(roomId) {
  const btnJoin = document.getElementById('btn-join');
  btnJoin.disabled = true;
  try {
    const guestName = document.getElementById('player-name-input').value.trim() || getRandomName();
    document.getElementById('lobby-status').textContent = 'Joining\u2026';

    const result = await Network.joinRoom(roomId, guestName);

    if (result.status === 'waiting') {
      // ── Pre-game: show waiting room, wait for Host to click Start ──────────
      const { numPlayers, mySeat } = result;
      document.getElementById('waiting-room').style.display = 'block';
      document.getElementById('display-room-id').textContent = roomId;
      document.getElementById('waiting-hint').style.display = 'block';
      document.getElementById('lobby-status').textContent = `You're in! Seat ${mySeat} — waiting for host to start…`;

      Network.listenForPlayers(_updatePlayerList);

      Network.listenForGameStart(() => {
        // Host started — enter game
        multiplayerMode = true;
        isHost = false;
        humanSeats = [];  // will sync from first gameState push
        _myPrivateCards = null;
        _assignedSeat = null;
        _showGame(roomId);

        aiThinking = false;
        game = new Game(numPlayers, mySeat);
        game.playerNames = {};
        applyTableLayout(numPlayers, mySeat);
        Range.resetAll(numPlayers);
        _resetPrevDist();
        renderAll(game, solverData);

        Network.listenForStateUpdate(applyRemoteState);
        Network.listenForPrivateCards((cards) => {
          _myPrivateCards = cards;
          if (game) { game.hands[Network.mySeat] = cards; updateSolver(); renderAll(game, solverData); }
        });
        Network.listenForRoomClosed(() => resetToLobby('Host has left — room closed.'));
      });

    } else {
      // ── Mid-game: enter as observer, take over next hand ───────────────────
      const { numPlayers, pushKey } = result;
      document.getElementById('lobby-status').textContent = 'Joining as observer — you\'ll take a seat next hand…';

      // Seat is assigned immediately by Host; listen for it
      Network.listenForSeatAssignment(pushKey, (assignedSeat) => {
        multiplayerMode = true;
        isHost = false;
        humanSeats = [];
        _myPrivateCards = null;
        _assignedSeat = assignedSeat;  // table rotates to this seat; not yet active
        _showGame(roomId);

        aiThinking = false;
        // playerSeat = null → observer mode (no action buttons, no hole cards)
        game = new Game(numPlayers, null);
        game.playerNames = {};
        applyTableLayout(numPlayers, assignedSeat);  // rotate table to assigned seat
        Range.resetAll(numPlayers);
        _resetPrevDist();
        renderAll(game, solverData);

        Network.listenForStateUpdate(applyRemoteState);
        Network.listenForRoomClosed(() => resetToLobby('Host has left — room closed.'));
        // Private card listener set up in applyRemoteState when seat becomes active
      });
    }
  } catch (err) {
    alert('Error joining room: ' + err.message);
    btnJoin.disabled = false;
    document.getElementById('lobby-status').textContent = '';
  }
}

// ── Event Bindings ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Pre-fill name input with a random English name (user can delete/change it)
  const nameInput = document.getElementById('player-name-input');
  if (nameInput) nameInput.value = getRandomName();

  // ── Lobby buttons ──────────────────────────────────────────────────────────
  document.getElementById('btn-solo').addEventListener('click', initSoloGame);
  document.getElementById('btn-host').addEventListener('click', initHostGame);
  document.getElementById('btn-join').addEventListener('click', () => {
    const roomId = document.getElementById('room-id-input').value.trim();
    if (!roomId) { alert('Please enter a Room ID'); return; }
    initGuestGame(roomId);
  });

  // ── Action buttons ─────────────────────────────────────────────────────────
  document.getElementById('action-buttons').addEventListener('click', (e) => {
    if (e.target.closest('#btn-new-hand')) { startNewHand(); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const amount = btn.dataset.amount ? parseInt(btn.dataset.amount) : undefined;
    if (action === 'fold') handlePlayerAction('fold');
    else if (action === 'check') handlePlayerAction('check');
    else if (action === 'call') handlePlayerAction({ action: 'call', amount });
    else if (action === 'bet') handlePlayerAction({ action: 'bet', amount });
    else if (action === 'raise') handlePlayerAction({ action: 'raise', amount });
  });

  // ── Settings Modal ─────────────────────────────────────────────────────────
  const modal = document.getElementById('settings-modal');
  const btnSettings = document.getElementById('btn-settings');
  const btnCloseModal = document.getElementById('btn-close-settings');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const muteToggle = document.getElementById('mute-toggle');
  let pendingNumPlayers = currentNumPlayers;

  // Open modal
  btnSettings.addEventListener('click', () => {
    // Sync current state to modal UI
    pendingNumPlayers = currentNumPlayers;
    document.querySelectorAll('#modal-count-btns .count-btn').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.count) === currentNumPlayers);
    });
    modal.classList.add('open');
  });

  // Close modal without saving
  btnCloseModal.addEventListener('click', () => {
    modal.classList.remove('open');
  });

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });

  // Player count selection within modal
  document.getElementById('modal-count-btns').addEventListener('click', (e) => {
    const btn = e.target.closest('.count-btn');
    if (!btn) return;
    pendingNumPlayers = parseInt(btn.dataset.count);
    document.querySelectorAll('#modal-count-btns .count-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // Save Settings
  btnSaveSettings.addEventListener('click', () => {
    _SFX.setMuted(muteToggle.checked);
    modal.classList.remove('open');
    startNewGame(pendingNumPlayers);

    // Update header player count label
    const headerCount = document.getElementById('header-player-count');
    if (headerCount) headerCount.textContent = pendingNumPlayers;
  });

  // ── Mode tabs ──────────────────────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.mode === 'analyze') {
        document.body.classList.add('show-analyze');
      } else {
        document.body.classList.remove('show-analyze');
      }
    });
  });

  // ── Leave Room button ──────────────────────────────────────────────────────
  document.getElementById('btn-leave-room').addEventListener('click', leaveRoom);

  // ── AutoPlay toggle ────────────────────────────────────────────────────────
  document.getElementById('autoplay-toggle').addEventListener('change', e => {
    autoPlayOn = e.target.checked;
    if (!autoPlayOn) {
      cancelAutoPlay();
    } else if (game && !game.gameOver && game.isPlayerTurn()) {
      startAutoPlayCountdown();
    }
  });

  // ── Blind Doubling select ──────────────────────────────────────────────────
  const blindDoublingSelect = document.getElementById('blind-doubling-select');
  if (blindDoublingSelect) {
    blindDoublingHands = parseInt(blindDoublingSelect.value);
    blindDoublingSelect.addEventListener('change', e => {
      blindDoublingHands = parseInt(e.target.value);
    });
  }

  // ── Page unload cleanup ────────────────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    if (multiplayerMode) Network.detach();
  });

  // NOTE: Game does NOT auto-start here; the lobby is shown first.
  // The user clicks "Solo Practice", "Create Room", or "Join Room" to begin.
});
