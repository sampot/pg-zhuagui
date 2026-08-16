import { describe, it, expect } from "vitest";
import {
  makeDeck,
  shuffle,
  isPair,
  removePairs,
  newRound,
  drawCard,
  nextTurn,
  checkDone,
  tally,
  cardText,
} from "./game.js";

// 可排序(nullary)的偽隨機產生器，像 Math.random 每次呼叫回一個值
let _seed = 1;
function seq() {
  _seed = (Math.imul(_seed, 1664525) + 1013904223) >>> 0;
  return _seed / 4294967296;
}

describe("makeDeck", () => {
  it("builds 53 cards (52 + joker)", () => {
    const d = makeDeck(() => 0.5);
    expect(d.length).toBe(53);
    expect(d.filter((c) => c.rank === 0).length).toBe(1);
  });
  it("has every rank 1..13 in each of 4 suits", () => {
    const d = makeDeck(() => 0.5);
    for (let s = 0; s < 4; s++) {
      for (let r = 1; r <= 13; r++) {
        expect(d.some((c) => c.suit === s && c.rank === r)).toBe(true);
      }
    }
  });
});

describe("shuffle", () => {
  it("keeps all cards", () => {
    const d = makeDeck(() => 0.5);
    const s = shuffle(d, () => 0.7);
    expect(s.length).toBe(d.length);
    expect(new Set(s.map((c) => `${c.suit}-${c.rank}`)).size).toBe(d.length);
  });
});

describe("isPair", () => {
  it("pairs same rank across suits", () => {
    expect(isPair({ rank: 7, suit: 0 }, { rank: 7, suit: 2 })).toBe(true);
  });
  it("never pairs joker", () => {
    expect(isPair({ rank: 0, suit: 4 }, { rank: 0, suit: 4 })).toBe(false);
    expect(isPair({ rank: 5, suit: 0 }, { rank: 0, suit: 4 })).toBe(false);
  });
  it("different ranks never pair", () => {
    expect(isPair({ rank: 9, suit: 0 }, { rank: 8, suit: 0 })).toBe(false);
  });
});

describe("removePairs", () => {
  it("removes exact pairs", () => {
    const hand = [
      { rank: 5, suit: 0 },
      { rank: 5, suit: 1 },
      { rank: 3, suit: 2 },
    ];
    const { kept, removed } = removePairs(hand);
    expect(kept.length).toBe(1);
    expect(kept[0].rank).toBe(3);
    expect(removed.length).toBe(2);
  });
  it("removes two pairs from four-of-a-kind", () => {
    const hand = [
      { rank: 2, suit: 0 },
      { rank: 2, suit: 1 },
      { rank: 2, suit: 2 },
      { rank: 2, suit: 3 },
      { rank: 9, suit: 0 },
    ];
    const { kept, removed } = removePairs(hand);
    expect(kept.length).toBe(1);
    expect(removed.length).toBe(4);
  });
  it("removes floor(n/2)*2 from an odd count (three of a kind drops two, keeps one)", () => {
    const { kept, removed } = removePairs([
      { rank: 9, suit: 0 },
      { rank: 9, suit: 1 },
      { rank: 9, suit: 2 },
    ]);
    expect(kept.length).toBe(1);
    expect(removed.length).toBe(2);
  });
  it("removes all of four-of-a-kind plus a single", () => {
    const hand = Array.from({ length: 4 }, (_, i) => ({ rank: 4, suit: i }));
    hand.push({ rank: 7, suit: 0 });
    const { kept, removed } = removePairs(hand);
    expect(kept.length).toBe(1); // 只剩一張 7
    expect(kept[0].rank).toBe(7);
    expect(removed.length).toBe(4);
  });
  it("keeps the joker always", () => {
    const hand = [
      { rank: 0, suit: 4 },
      { rank: 7, suit: 0 },
      { rank: 7, suit: 1 },
    ];
    const { kept } = removePairs(hand);
    expect(kept.length).toBe(1);
    expect(kept[0].rank).toBe(0);
  });
});

describe("newRound", () => {
  it("deals all 53 cards across 4 hands (some discarded as pairs)", () => {
    const g = newRound(4, seq);
    const total = g.hands.reduce((a, h) => a + h.length, 0);
    const removedTotal = g.removed.length;
    expect(total + removedTotal).toBe(53);
    expect(g.playerCount).toBe(4);
  });
  it("keeps turn at player 0", () => {
    const g = newRound(3, seq);
    expect(g.turn).toBe(0);
  });
  it("every remaining card has an unpaired count (no pairs left in any hand)", () => {
    const g = newRound(4, seq);
    for (const h of g.hands) {
      const { kept } = removePairs(h);
      expect(kept.length).toBe(h.length);
    }
  });
});

describe("drawCard flow", () => {
  it("moves a card between players", () => {
    const g = newRound(4, seq);
    // build predictable small hands
    g.hands[0] = [{ rank: 4, suit: 0 }];
    g.hands[1] = [{ rank: 9, suit: 0 }];
    g.hands[0] = [{ rank: 4, suit: 0 }];
    g.hands[2] = [];
    g.hands[3] = [];
    const res = drawCard(g, 0, 1, 0); // player1 draws from player0
    expect(res.ok).toBe(true);
    expect(res.drawn.rank).toBe(4);
    expect(g.hands[0].length).toBe(0);
    expect(g.hands[1].length).toBe(2); // 9 + drawn 4
  });
  it("pairs and discards when a match exists", () => {
    const g = newRound(4, seq);
    g.hands[0] = [{ rank: 6, suit: 0 }];
    g.hands[1] = [{ rank: 1, suit: 0 }, { rank: 6, suit: 1 }];
    g.hands[2] = [];
    g.hands[3] = [];
    g.removed = [];
    const res = drawCard(g, 0, 1, 0); // player1 draws the 6 from player0
    expect(res.ok).toBe(true);
    expect(res.paired).toBe(true);
    expect(g.hands[1]).toEqual([{ rank: 1, suit: 0 }]); // match removed
    expect(g.removed.length).toBe(2);
  });
  it("discards all even copies when a three-of-a-kind is completed", () => {
    const g = newRound(4, seq);
    g.hands[0] = [{ rank: 6, suit: 2 }];
    g.hands[1] = [{ rank: 6, suit: 0 }, { rank: 6, suit: 1 }];
    g.hands[2] = [];
    g.hands[3] = [];
    g.removed = [];
    const res = drawCard(g, 0, 1, 0); // player1 draws a 6 → holds three 6s
    expect(res.ok).toBe(true);
    expect(res.paired).toBe(true);
    expect(g.hands[1].filter((c) => c.rank === 6).length).toBe(1); // 留一張
    expect(g.removed.filter((c) => c.rank === 6).length).toBe(2); // 丟兩張
  });
  it("rejects self-draw", () => {
    const g = newRound(4, seq);
    const res = drawCard(g, 0, 0, 0);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("self-draw");
  });
});

describe("checkDone + nextTurn", () => {
  it("finishes when only one card remains", () => {
    const g = newRound(2, seq);
    g.hands[0] = [{ rank: 0, suit: 4 }];
    g.hands[1] = [];
    g.done = checkDone(g);
    expect(g.done).not.toBeNull();
    expect(g.done.turtle).toBe(0);
  });
  it("ends when a single player holds all remaining cards (must include joker)", () => {
    const g = newRound(4, seq);
    g.hands[0] = [];
    g.hands[1] = [];
    g.hands[2] = [{ rank: 3, suit: 0 }, { rank: 7, suit: 1 }, { rank: 0, suit: 4 }];
    g.hands[3] = [];
    g.done = checkDone(g);
    expect(g.done).not.toBeNull();
    expect(g.done.turtle).toBe(2);
  });
  it("nextTurn skips empty hands", () => {
    const g = newRound(4, seq);
    g.hands[1] = [];
    g.hands[2] = [];
    expect(nextTurn(g, 0)).toBe(3);
  });
});

describe("tally", () => {
  it("awards +1 to everyone but the turtle", () => {
    const g = newRound(2, seq);
    g.done = { turtle: 1, remaining: [{ i: 1, n: 1 }] };
    expect(tally(g, [0, 0])).toEqual([1, 0]);
  });
});

describe("cardText", () => {
  it("labels values and suits", () => {
    expect(cardText({ rank: 1, suit: 0 })).toBe("A♠");
    expect(cardText({ rank: 11, suit: 1 })).toBe("J♥");
    expect(cardText({ rank: 0, suit: 4 })).toBe("🐢");
  });
});