// deck.js — Deck management: shuffle, deal, burn

class Deck {
  constructor() {
    this.reset();
  }

  reset() {
    // Cards 0–51
    this.cards = Array.from({ length: DECK_SIZE }, (_, i) => i);
    this.pos = 0;
    this.burned = [];
    this.shuffle();
  }

  // Fisher-Yates in-place shuffle
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    this.pos = 0;
  }

  deal(n = 1) {
    const dealt = [];
    for (let i = 0; i < n; i++) {
      if (this.pos >= this.cards.length) throw new Error('Deck exhausted');
      dealt.push(this.cards[this.pos++]);
    }
    return n === 1 ? dealt[0] : dealt;
  }

  burn() {
    const card = this.deal(1);
    this.burned.push(card);
    return card;
  }

  remaining() {
    return this.cards.slice(this.pos);
  }

  // Remove specific cards from deck (used in solver simulations)
  removeCards(toRemove) {
    const removed = new Set(toRemove);
    const fresh = this.cards.filter(c => !removed.has(c));
    this.cards = fresh;
    this.pos = 0;
  }

  clone() {
    const d = new Deck();
    d.cards = [...this.cards];
    d.pos = this.pos;
    d.burned = [...this.burned];
    return d;
  }
}
