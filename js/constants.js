// constants.js — Card values, suits, hand rank names, game constants

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c']; // spades, hearts, diamonds, clubs
const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_COLORS = { s: 'black', h: 'red', d: 'orange', c: 'blue' };
const DECK_SIZE = 52;

function cardRank(card) { return Math.floor(card / 4); }
function cardSuit(card) { return card % 4; }
function cardLabel(card) { return RANKS[cardRank(card)] + SUITS[cardSuit(card)]; }
function cardDisplay(card) {
  return {
    rank: RANKS[cardRank(card)],
    suit: SUIT_SYMBOLS[SUITS[cardSuit(card)]],
    color: SUIT_COLORS[SUITS[cardSuit(card)]]
  };
}

const HAND_NAMES = [
  'High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
  'Straight', 'Flush', 'Full House', 'Four of a Kind',
  'Straight Flush', 'Royal Flush'
];

// Game constants — Limit 30/60
const SMALL_BET = 30;
const BIG_BET = 60;
const SMALL_BLIND = 15;
const BIG_BLIND = 30;
const MAX_RAISES = 4;
const STARTING_CHIPS = 1500;
const NUM_SEATS = 9;

// Streets
const STREET = { PREFLOP: 0, FLOP: 1, TURN: 2, RIVER: 3, SHOWDOWN: 4 };
const STREET_NAMES = ['Pre-Flop', 'Flop', 'Turn', 'River', 'Showdown'];

// Player is always seat 0
const POS = { PLAYER: 0 };

// Display names for each seat
const SEAT_NAMES = ['You', 'AI 1', 'AI 2', 'AI 3', 'AI 4', 'AI 5', 'AI 6', 'AI 7', 'AI 8'];

// Position names by (relative offset from BTN, numPlayers)
// rel=0 → BTN, rel=1 → SB, rel=2 → BB, rel=3 → UTG, ..., rel=N-1 → CO
const _POS_NAMES = {
  2: ['BTN', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'UTG'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'LJ', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'],
};

function getPositionName(seat, dealerSeat, aliveSeats) {
  if (!aliveSeats.includes(seat)) return ''; // Eliminated players get no position
  const numAlive = aliveSeats.length;
  if (numAlive < 2) return '';

  // Find where the dealer is in the alive array
  // If dealerSeat is not in aliveSeats (shouldn't happen with proper game logic, but just in case)
  // we fallback to the closest previous alive seat, but game.js advances dealer past dead seats.
  const dealerIdx = aliveSeats.indexOf(dealerSeat);
  const seatIdx = aliveSeats.indexOf(seat);

  if (dealerIdx === -1 || seatIdx === -1) return '';

  const rel = (seatIdx - dealerIdx + numAlive) % numAlive;
  return (_POS_NAMES[numAlive] || [])[rel] || '';
}
