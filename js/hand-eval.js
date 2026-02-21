// hand-eval.js — 7-card hand evaluator (full ranking)

// Hand category scores (base values, higher = better)
const HC_HIGH_CARD = 0;
const HC_ONE_PAIR = 10000000;
const HC_TWO_PAIR = 20000000;
const HC_TRIPS = 30000000;
const HC_STRAIGHT = 40000000;
const HC_FLUSH = 50000000;
const HC_FULL_HOUSE = 60000000;
const HC_QUADS = 70000000;
const HC_STRAIGHT_FLUSH = 80000000;

// Returns [category_index, score] for a 5-card hand
function eval5(cards) {
  const ranks = cards.map(c => cardRank(c)).sort((a, b) => b - a);
  const suits = cards.map(c => cardSuit(c));

  const flush = suits.every(s => s === suits[0]);
  const straight = isStraight5(ranks);
  const counts = rankCounts(ranks);
  const countVals = Object.values(counts).sort((a, b) => b - a);
  const groups = groupsByCount(counts);

  // Score kicker contribution: sum rank values weighted by position
  function kickerScore(ks) {
    let s = 0;
    for (let i = 0; i < ks.length; i++) s += ks[i] * Math.pow(13, ks.length - 1 - i);
    return s;
  }

  if (flush && straight) {
    const highRank = ranks[0] === 12 && ranks[4] === 0 ? 3 : ranks[0]; // wheel: A-2-3-4-5
    const cat = (ranks[0] === 12 && ranks[1] === 11) ? 9 : 8;
    return [cat, HC_STRAIGHT_FLUSH + highRank * 1000];
  }
  if (countVals[0] === 4) {
    const quad = groups[4][0];
    const kicker = groups[1][0];
    return [7, HC_QUADS + quad * 1000 + kicker];
  }
  if (countVals[0] === 3 && countVals[1] === 2) {
    const trips = groups[3][0];
    const pair = groups[2][0];
    return [6, HC_FULL_HOUSE + trips * 100 + pair];
  }
  if (flush) {
    return [5, HC_FLUSH + kickerScore(ranks)];
  }
  if (straight) {
    const highRank = ranks[0] === 12 && ranks[4] === 0 ? 3 : ranks[0];
    return [4, HC_STRAIGHT + highRank * 1000];
  }
  if (countVals[0] === 3) {
    const trips = groups[3][0];
    const kickers = groups[1].sort((a, b) => b - a);
    return [3, HC_TRIPS + trips * 10000 + kickerScore(kickers)];
  }
  if (countVals[0] === 2 && countVals[1] === 2) {
    const pairs = groups[2].sort((a, b) => b - a);
    const kicker = groups[1][0];
    return [2, HC_TWO_PAIR + pairs[0] * 10000 + pairs[1] * 100 + kicker];
  }
  if (countVals[0] === 2) {
    const pair = groups[2][0];
    const kickers = groups[1].sort((a, b) => b - a);
    return [1, HC_ONE_PAIR + pair * 100000 + kickerScore(kickers)];
  }
  return [0, HC_HIGH_CARD + kickerScore(ranks)];
}

function isStraight5(sortedRanks) {
  // Normal straight
  if (sortedRanks[0] - sortedRanks[4] === 4 && new Set(sortedRanks).size === 5) return true;
  // Wheel: A-2-3-4-5
  if (sortedRanks[0] === 12 && sortedRanks[1] === 3 && sortedRanks[2] === 2 &&
    sortedRanks[3] === 1 && sortedRanks[4] === 0) return true;
  return false;
}

function rankCounts(ranks) {
  const c = {};
  for (const r of ranks) c[r] = (c[r] || 0) + 1;
  return c;
}

function groupsByCount(counts) {
  const g = {};
  for (const [rank, cnt] of Object.entries(counts)) {
    if (!g[cnt]) g[cnt] = [];
    g[cnt].push(Number(rank));
  }
  return g;
}

// Evaluate best 5-card hand from an array of 5–7 cards
// Returns { score, categoryIndex, categoryName, bestCards }
function evalBest(cards) {
  if (cards.length < 5) return null;
  if (cards.length === 5) {
    const [cat, score] = eval5(cards);
    return { score, categoryIndex: cat, categoryName: HAND_NAMES[cat], bestCards: cards };
  }
  // Generate all C(n,5) combinations
  let best = null;
  const combos = combinations(cards, 5);
  for (const combo of combos) {
    const [cat, score] = eval5(combo);
    if (!best || score > best.score) {
      best = { score, categoryIndex: cat, categoryName: HAND_NAMES[cat], bestCards: combo };
    }
  }
  return best;
}

function combinations(arr, k) {
  const result = [];
  function helper(start, chosen) {
    if (chosen.length === k) { result.push([...chosen]); return; }
    for (let i = start; i < arr.length; i++) {
      chosen.push(arr[i]);
      helper(i + 1, chosen);
      chosen.pop();
    }
  }
  helper(0, []);
  return result;
}

// Compare two evalBest results; returns 1 if a wins, -1 if b wins, 0 if tie
function compareHands(a, b) {
  if (a.score > b.score) return 1;
  if (a.score < b.score) return -1;
  return 0;
}
