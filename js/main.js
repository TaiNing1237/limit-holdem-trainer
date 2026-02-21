// main.js — App bootstrap & event bindings (2–9 players)

let game = null;
let solverData = null;
let aiThinking = false;
let currentNumPlayers = 9;

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
  const won = (g.winners || []).includes(POS.PLAYER);
  setTimeout(() => won ? _SFX.win() : _SFX.lose(), 250);
}

function onHandEnd(g) {
  if (!g.gameOver) return;
  History.record(g);
  const el = document.getElementById('history-count');
  const n = History.count();
  if (el) el.textContent = `${n} hand${n !== 1 ? 's' : ''}`;
  Panels.refresh();
}

// ── Game flow ─────────────────────────────────────────────────────────────────

function startNewHand() {
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
  applyTableLayout(game.numPlayers);
  Range.resetAll(game.numPlayers);
  _resetPrevDist();
  updateSolver();
  renderAll(game, solverData);
  if (!game.gameOver) playDealSequence(game.numPlayers * 2);
  if (!game.gameOver && !game.isPlayerTurn()) scheduleAI();
}

function startNewGame(numPlayers) {
  aiThinking = false;
  currentNumPlayers = numPlayers;
  for (let s = 0; s < NUM_SEATS; s++) _cardCache[s] = null;
  _boardCache = '';
  game = new Game(numPlayers);
  applyTableLayout(numPlayers);
  Range.resetAll(numPlayers);
  _resetPrevDist();
  updateSolver();
  renderAll(game, solverData);
  playDealSequence(numPlayers * 2);
  if (!game.gameOver && !game.isPlayerTurn()) scheduleAI();
}

function updateSolver() {
  if (!game || game.hands[POS.PLAYER].length < 2 || game.folded[POS.PLAYER]) {
    solverData = null;
    return;
  }
  solverData = solverAnalyze(game);
}

function handlePlayerAction(actionObj) {
  if (!game || game.gameOver || !game.isPlayerTurn() || aiThinking) return;
  const boardBefore = game.board.length;
  playSoundForAction(actionObj);
  game.applyAction(actionObj);
  Range.update(game);
  if (game.board.length > boardBefore)
    playDealSequence(game.board.length - boardBefore);  // flop/turn/river
  renderLastAction(game);
  updateSolver();
  renderAll(game, solverData);
  playResultSound(game);
  onHandEnd(game);
  if (!game.gameOver && !game.isPlayerTurn()) scheduleAI();
}

function scheduleAI() {
  if (!game || game.gameOver || game.isPlayerTurn()) { aiThinking = false; return; }
  aiThinking = true;
  setTimeout(() => {
    if (!game || game.gameOver) { aiThinking = false; return; }
    if (game.isPlayerTurn()) { aiThinking = false; return; }
    const aiSeat = game.toAct;
    const action = aiDecide(game, aiSeat);
    const boardBefore = game.board.length;
    game.applyAction(action);
    Range.update(game);
    playSoundForAction(action);
    if (game.board.length > boardBefore)
      playDealSequence(game.board.length - boardBefore);
    renderLastAction(game);
    updateSolver();
    renderAll(game, solverData);
    playResultSound(game);
    onHandEnd(game);
    if (!game.gameOver && !game.isPlayerTurn()) {
      scheduleAI();
    } else {
      aiThinking = false;
    }
  }, 450 + Math.random() * 650);
}

// ── Event Bindings ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // Action buttons
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

  // ── Settings Modal ────────────────────────────────────────────────────────
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

  // Mode tabs
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

  // Init
  game = new Game(currentNumPlayers);
  applyTableLayout(currentNumPlayers);
  Range.resetAll(currentNumPlayers);
  _resetPrevDist();
  updateSolver();
  renderAll(game, solverData);
  playDealSequence(currentNumPlayers * 2);
  if (!game.gameOver && !game.isPlayerTurn()) scheduleAI();
});
