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
  pickAiDrawTarget,
  emptyStats,
  parseStats,
  applyRoundStats,
  drawnFromHistory,
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

describe("newRound playerCount", () => {
  it("supports 2 players and conserves 53 cards", () => {
    const g = newRound(2, seq);
    expect(g.playerCount).toBe(2);
    const total = g.hands.reduce((a, h) => a + h.length, 0);
    expect(total + g.removed.length).toBe(53);
  });
  it("clamps out-of-range counts to 2..4", () => {
    expect(newRound(1, seq).playerCount).toBe(2);
    expect(newRound(5, seq).playerCount).toBe(4);
  });
});

function stateWithHands(hands) {
  const g = newRound(hands.length, seq);
  g.hands = hands.map((h) => h.map((r) => ({ rank: r.rank, suit: r.suit })));
  return g;
}

describe("pickAiDrawTarget", () => {
  it("easy: uniform random among live opponents", () => {
    const g = stateWithHands([[{ rank: 5 }], [{ rank: 3 }], [{ rank: 4 }], []]);
    expect(pickAiDrawTarget(g, 1, "easy", () => 0)).toBe(0);
    expect(pickAiDrawTarget(g, 1, "easy", () => 0.99)).toBe(2);
  });
  it("standard: most-cards target regardless of rand", () => {
    const g = stateWithHands([[{ rank: 5 }, { rank: 3 }], [], [{ rank: 4 }, { rank: 9 }, { rank: 7 }], [{ rank: 2 }]]);
    expect(pickAiDrawTarget(g, 1, "standard", () => 0)).toBe(2);
    expect(pickAiDrawTarget(g, 3, "standard", () => 0)).toBe(2);
  });
  it("hard: prefers drawing from the human (player 0)", () => {
    const g = stateWithHands([[{ rank: 5 }, { rank: 3 }], [], [{ rank: 4 }, { rank: 9 }, { rank: 7 }], []]);
    // standard would take p2 (3 cards); hard's human bonus flips it to p0
    expect(pickAiDrawTarget(g, 1, "standard", () => 0)).toBe(2);
    expect(pickAiDrawTarget(g, 1, "hard", () => 0)).toBe(0);
  });
  it("hard: avoids a near-empty hand holding its last card", () => {
    const g = stateWithHands([[{ rank: 5 }], [], [{ rank: 4 }], [{ rank: 9 }, { rank: 3 }]]);
    // ai=1: p0 has 1 (would score 1+5=6), p3 has 2 → p3 wins
    expect(pickAiDrawTarget(g, 1, "hard", () => 0)).toBe(3);
    // ai=2: p0 alone → p0 still chosen despite near-empty (no alternative)
    const h = stateWithHands([[{ rank: 5 }], [], [], [{ rank: 9 }, { rank: 3 }]]);
    expect(pickAiDrawTarget(h, 2, "hard", () => 0)).toBe(3);
  });
  it("hard: breaks score ties with rand", () => {
    // ai=0: live=[1,3], both single-card non-humans → same score, rand decides
    const g = stateWithHands([[], [{ rank: 9 }], [], [{ rank: 4 }]]);
    expect(pickAiDrawTarget(g, 0, "hard", () => 0)).toBe(1);
    expect(pickAiDrawTarget(g, 0, "hard", () => 0.99)).toBe(3);
  });
  it("returns -1 when no live opponent", () => {
    const g = stateWithHands([[], [], [{ rank: 5 }], []]);
    expect(pickAiDrawTarget(g, 2, "easy", () => 0)).toBe(-1);
    expect(pickAiDrawTarget(g, 2, "hard", () => 0)).toBe(-1);
  });
});

describe("stats persistence helpers", () => {
  it("emptyStats has zeroed fields", () => {
    const s = emptyStats();
    expect(s).toEqual({ best: 0, games: 0, turtles: 0, muted: false, ai: [{ games: 0, turtles: 0 }, { games: 0, turtles: 0 }, { games: 0, turtles: 0 }] });
  });
  it("parseStats accepts valid JSON, rejects garbage", () => {
    expect(parseStats('{"best":3,"games":5,"turtles":2,"muted":true,"ai":[{"games":5,"turtles":1},{"games":4,"turtles":1},{"games":0,"turtles":0}]}')).toEqual({ best: 3, games: 5, turtles: 2, muted: true, ai: [{ games: 5, turtles: 1 }, { games: 4, turtles: 1 }, { games: 0, turtles: 0 }] });
    expect(parseStats("not json")).toBeNull();
    expect(parseStats('"a string"')).toBeNull();
    expect(parseStats('{"best":"x"}')).toBeNull();
  });
  it("parseStats fills missing ai slots", () => {
    const s = parseStats('{"best":2,"games":2,"turtles":1}');
    expect(s.ai.length).toBe(3);
    expect(s.muted).toBe(false);
  });
  it("applyRoundStats counts games, player turtle, and per-AI records", () => {
    let s = emptyStats();
    s = applyRoundStats(s, 0, 4);
    expect(s.games).toBe(1);
    expect(s.turtles).toBe(1);
    expect(s.ai.every((a) => a.games === 1)).toBe(true);
    s = applyRoundStats(s, 2, 4);
    expect(s.turtles).toBe(1);
    expect(s.ai[1].turtles).toBe(1);
    expect(s.ai[0].games).toBe(2);
    // 2-player game: only ai[0] participates
    let t = emptyStats();
    t = applyRoundStats(t, 1, 2);
    expect(t.ai[0].games).toBe(1);
    expect(t.ai[0].turtles).toBe(1);
    expect(t.ai[1].games).toBe(0);
  });
  it("applyRoundStats leaves no-turtle draws as games only", () => {
    let s = emptyStats();
    s = applyRoundStats(s, null, 4);
    expect(s.games).toBe(1);
    expect(s.turtles).toBe(0);
    expect(s.ai.every((a) => a.games === 1 && a.turtles === 0)).toBe(true);
  });
});

describe("drawnFromHistory", () => {
  it("lists cards taken from a player, oldest-first, capped", () => {
    const g = newRound(4, seq);
    g.history = [
      { by: 1, from: 2, card: { rank: 3, suit: 0 }, paired: false },
      { by: 3, from: 0, card: { rank: 7, suit: 1 }, paired: true },
      { by: 1, from: 2, card: { rank: 9, suit: 2 }, paired: false },
      { by: 2, from: 3, card: { rank: 5, suit: 3 }, paired: false },
      { text: "event" },
      { by: 0, from: 2, card: { rank: 12, suit: 0 }, paired: true },
    ];
    expect(drawnFromHistory(g, 2, 2)).toEqual([
      { rank: 9, suit: 2 },
      { rank: 12, suit: 0 },
    ]);
    expect(drawnFromHistory(g, 0, 3)).toEqual([{ rank: 7, suit: 1 }]);
    expect(drawnFromHistory(g, 1, 3)).toEqual([]);
  });
});