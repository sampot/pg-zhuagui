/**
 * 抓烏龜 — 純邏輯：發牌、去對、抽牌、判定勝負。
 * 純函式設計，方便單元測試。
 *
 * 規則（台灣常見童玩）：
 *  1. 52 張撲克＋1 張鬼牌（烏龜牌）。依人數盡量平分。
 *  2. 各家先把手上的「對子」（同數字、不限花色）丟掉。
 *  3. 依序從別家手中盲抽一張；抽中的牌若能與手上某張成對，立刻丟掉一對。
 *  4. 牌面剩下最後一張的持有者＝烏龜（輸家）；其餘玩家得分。
 */

/** 花色順序與檔名對應 */
export const SUITS = ["spades", "hearts", "diamonds", "clubs"];
export const SUIT_CHAR = ["♠", "♥", "♦", "♣"];

/** A=1…13=K；鬼牌 rank=0 */
export function makeDeck(rand = Math.random) {
  const cards = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 1; r <= 13; r++) {
      cards.push({ rank: r, suit: s });
    }
  }
  cards.push({ rank: 0, suit: 4 }); // 鬼牌＝烏龜牌
  return shuffle(cards, rand);
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 兩張是否成對：同數字、不限花色（鬼牌永不配對）。 */
export function isPair(a, b) {
  return a.rank !== 0 && a.rank === b.rank;
}

/**
 * 從一手牌中移除所有對子，回傳成對後的手牌與被丟掉的牌。
 * 同一 rank 拿 n 張：丟掉 n - (n%2) 張（成對），留下 n%2 張（0 或 1）。
 */
export function removePairs(hand) {
  const count = new Map();
  for (const c of hand) {
    if (c.rank !== 0) count.set(c.rank, (count.get(c.rank) || 0) + 1);
  }
  const kept = [];
  const removed = [];
  const keptSoFar = new Map();
  for (const c of hand) {
    if (c.rank === 0) {
      kept.push(c); // 烏龜牌永不離開
      continue;
    }
    const toKeep = count.get(c.rank) % 2;
    const k = keptSoFar.get(c.rank) || 0;
    if (k < toKeep) {
      keptSoFar.set(c.rank, k + 1);
      kept.push(c);
    } else {
      removed.push(c);
    }
  }
  return { kept, removed };
}

/**
 * 開新一局。playerCount = 玩家數（人＋AI，介於 2~4）。
 * 回傳 state：
 *   hands: Card[][], turn: number, removed: Card[]（已丟出的牌堆）,
 *   done: null | { turtle: number }
 */
export function newRound(playerCount, rand = Math.random) {
  const n = Math.max(2, Math.min(4, playerCount));
  const deck = makeDeck(rand);
  // 依序發牌，盡量平分
  const hands = Array.from({ length: n }, () => []);
  deck.forEach((c, i) => hands[i % n].push(c));
  const state = {
    playerCount: n,
    hands,
    turn: 0,
    removed: [],
    history: [],
    done: null,
  };
  // 每家的初始對子
  for (let p = 0; p < n; p++) {
    const res = removePairs(hands[p]);
    state.hands[p] = res.kept;
    state.removed.push(...res.removed);
    if (res.removed.length) {
      state.history.push({ text: `第 ${p + 1} 家先丟出 ${describeCards(res.removed)}` });
    }
  }
  state.done = checkDone(state);
  return state;
}

/** 描述一疊牌（用於歷史訊息）。 */
function describeCards(cards) {
  if (!cards || !cards.length) return "";
  const byRank = new Map();
  for (const c of cards) byRank.set(c.rank, (byRank.get(c.rank) || 0) + 1);
  const parts = [];
  for (const [rank, count] of byRank) {
    if (rank === 0) parts.push("🐢烏龜");
    else parts.push(`${rankText(rank)}×${count}`);
  }
  return parts.join("、");
}

export function rankText(r) {
  if (r === 0) return "🐢";
  if (r === 1) return "A";
  if (r === 11) return "J";
  if (r === 12) return "Q";
  if (r === 13) return "K";
  return String(r);
}

export function cardText(c) {
  if (c.rank === 0) return "🐢";
  return `${rankText(c.rank)}${SUIT_CHAR[c.suit]}`;
}

/**
 * 是否結束：
 *  - 全場只剩一張牌（必定是烏龜牌）→ 該家是烏龜。
 *  - 只剩一家有牌（總張數恆為奇數，必然含烏龜牌）→ 該家是烏龜，
 *    避免其他家都空手、無人可抽而卡死。
 */
export function checkDone(state) {
  const remaining = state.hands.map((h, i) => ({ i, n: h.length })).filter((x) => x.n > 0);
  const total = remaining.reduce((a, x) => a + x.n, 0);
  if (total <= 1) {
    return { turtle: total === 1 ? remaining[0].i : null, remaining };
  }
  if (remaining.length === 1) {
    return { turtle: remaining[0].i, remaining };
  }
  return null;
}

/**
 * 由 from 玩家手中盲抽一張（human 選第 pick 張／AI 隨機）。
 * 抽完立刻配對：成對則把該 rank 的偶數張全數丟掉。
 * 回傳 { ok, drawn, paired, by } 或 { ok:false }。
 */
export function drawCard(state, from, by, pick = -1) {
  if (state.done) return { ok: false, reason: "finished" };
  if (from === by) return { ok: false, reason: "self-draw" };
  const hand = state.hands[from];
  if (!hand || !hand.length) return { ok: false, reason: "empty-hand" };
  const idx = pick >= 0 && pick < hand.length ? pick : Math.floor(Math.random() * hand.length);
  const [card] = hand.splice(idx, 1);

  const byHand = state.hands[by];
  // 抽到的牌放進手牌，再移除該 rank 的成對張數（留 0 或 1 張）
  byHand.push(card);
  let droppedCount = 0;
  if (card.rank !== 0) {
    const total = byHand.filter((c) => c.rank === card.rank).length;
    const toDrop = total - (total % 2);
    for (let i = byHand.length - 1; i >= 0 && droppedCount < toDrop; i--) {
      if (byHand[i].rank === card.rank) {
        state.removed.push(byHand[i]);
        byHand.splice(i, 1);
        droppedCount++;
      }
    }
  }
  const paired = droppedCount > 0;
  state.history.push({ by, from, card, paired, dropped: droppedCount });
  state.done = checkDone(state);
  if (state.done) {
    state.history.push({
      text: state.done.remaining.length
        ? `烏龜出爐：第 ${state.done.remaining[0].i + 1} 家留下烏龜牌！`
        : "咦…全部配完了？",
    });
  }
  return { ok: true, drawn: card, paired, by, from };
}

/** 下一位手牌非空的下家。 */
export function nextTurn(state, after = state.turn) {
  if (state.done) return after;
  const n = state.playerCount;
  for (let d = 1; d <= n; d++) {
    const p = (after + d) % n;
    if (state.hands[p].length > 0) return p;
  }
  return after;
}

/** 對局結算：非烏龜者 +1 分；烏龜得不到分。 */
export function tally(state, scores) {
  const next = scores.slice();
  if (state.done?.turtle != null) {
    for (let i = 0; i < state.playerCount; i++) {
      if (i !== state.done.turtle) next[i] = (next[i] || 0) + 1;
    }
  }
  return next;
}

/**
 * AI 選抽牌目標。level：
 *  - easy：有牌對手中均勻隨機。
 *  - standard：手牌最多者（並列取先）。
 *  - hard：計分制——優先抽玩家（+5）、避開只剩一張的準空手（−6）、
 *    基礎分＝手牌張數；並列以 rand 決定。
 * 無合法目標回傳 -1。
 */
export function pickAiDrawTarget(state, ai, level = "standard", rand = Math.random) {
  const live = [];
  for (let p = 0; p < state.playerCount; p++) {
    if (p !== ai && state.hands[p].length > 0) live.push(p);
  }
  if (!live.length) return -1;
  if (level === "easy") {
    return live[Math.floor(rand() * live.length)];
  }
  if (level === "hard") {
    const anyMulti = live.some((q) => state.hands[q].length > 1);
    const scored = live.map((p) => {
      let s = state.hands[p].length;
      if (p === 0) s += 5;
      if (state.hands[p].length === 1 && anyMulti) s -= 6;
      return { p, s };
    });
    const max = Math.max(...scored.map((x) => x.s));
    const tied = scored.filter((x) => x.s === max).map((x) => x.p);
    return tied[Math.floor(rand() * tied.length)];
  }
  let target = live[0];
  for (const p of live) if (state.hands[p].length > state.hands[target].length) target = p;
  return target;
}

/** 生涯戰績（KV `pg-zhuagui-stats` 的結構）。ai[i] 對應第 i+1 家 AI。 */
export function emptyStats() {
  return {
    best: 0,
    games: 0,
    turtles: 0,
    muted: false,
    ai: [
      { games: 0, turtles: 0 },
      { games: 0, turtles: 0 },
      { games: 0, turtles: 0 },
    ],
  };
}

function isInt(v) {
  return Number.isInteger(v) && v >= 0;
}

/** 解析 KV 字串；無效回傳 null。缺角補零、ai 補齊 3 位。 */
export function parseStats(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!isInt(raw.best) || !isInt(raw.games) || !isInt(raw.turtles)) return null;
  if (raw.muted !== undefined && typeof raw.muted !== "boolean") return null;
  const ai = emptyStats().ai;
  if (raw.ai !== undefined) {
    if (!Array.isArray(raw.ai)) return null;
    for (let i = 0; i < Math.min(3, raw.ai.length); i++) {
      const a = raw.ai[i];
      if (!a || !isInt(a.games) || !isInt(a.turtles)) return null;
      ai[i] = { games: a.games, turtles: a.turtles };
    }
  }
  return { best: raw.best, games: raw.games, turtles: raw.turtles, muted: raw.muted === true, ai };
}

/** 把一局結果併入戰績。turtle：烏龜家索引（null＝無人中烏龜）。 */
export function applyRoundStats(stats, turtle, playerCount) {
  const base = emptyStats();
  const src = { ...base, ...stats };
  const ai = base.ai.map((z, i) => ({ ...(src.ai?.[i] || z) }));
  const next = {
    best: src.best,
    games: src.games + 1,
    turtles: src.turtles + (turtle === 0 ? 1 : 0),
    muted: src.muted,
    ai,
  };
  for (let p = 1; p < playerCount; p++) {
    next.ai[p - 1].games += 1;
    if (p === turtle) next.ai[p - 1].turtles += 1;
  }
  return next;
}

/** 從對局紀錄取「第 p 家曾被抽走哪些牌」，舊→新，最多 limit 張。 */
export function drawnFromHistory(state, p, limit = 3) {
  const out = [];
  for (let i = state.history.length - 1; i >= 0 && out.length < limit; i--) {
    const h = state.history[i];
    if (h && h.from === p && h.card) out.unshift(h.card);
  }
  return out;
}