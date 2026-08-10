/**
 * 抓烏龜 — 介面與互動。
 * 玩家（第 0 家）對 AI。翻對子、盲抽、烏龜判定。
 */
import {
  newRound,
  drawCard,
  nextTurn,
  tally,
  rankText,
  cardText,
  SUIT_CHAR,
} from "./game.js";
import { ZhuaguiAudio } from "./audio.js";

const audio = new ZhuaguiAudio();

const els = {
  status: document.getElementById("status"),
  playersArea: document.getElementById("players"),
  removed: document.getElementById("removed"),
  myInfo: document.getElementById("my-info"),
  scores: document.getElementById("scores"),
  btnNew: document.getElementById("btn-new"),
  btnMute: document.getElementById("btn-mute"),
  game: document.getElementById("game"),
  best: document.getElementById("best-label"),
};

const BEST_KEY = "pg-zhuagui-best";

const PLAYER = 0;
const NAMES = ["你", "阿明", "小美", "大熊"];
const COLORS = ["#e23d3d", "#2f8f4e", "#3b82f6", "#a855f7"];

let state = null;
let scores = [0, 0, 0, 0];
let phase = "title"; // title | dealing | playing | settling
let lastResult = null;
let bestStreak = 0;
let myWins = 0;

let dealtNames = 0;
let reveal = null; // 抽牌揭示 { card, paired, opponent }

const cardFile = (c) => {
  if (c.rank === 0) return "card_joker_red.png";
  const s = c.suit;
  const rank =
    c.rank === 1 ? "A" : c.rank === 11 ? "J" : c.rank === 12 ? "Q" : c.rank === 13 ? "K" : String(c.rank).padStart(2, "0");
  const suit = s === 0 ? "spades" : s === 1 ? "hearts" : s === 2 ? "diamonds" : "clubs";
  return `card_${suit}_${rank}.png`;
};

function setStatus(msg, tone = "") {
  els.status.textContent = msg;
  els.status.dataset.tone = tone;
}

function nameOf(p) {
  return NAMES[p] || `玩家${p + 1}`;
}

/* ---------- 初始化對局 ---------- */
function humanCount() {
  return 4; // 固定 4 家：你＋3 AI
}

function startRound() {
  audio.unlock();
  phase = "dealing";
  reveal = null;
  state = newRound(humanCount());
  const n = state.playerCount;
  scores = scores.slice(0, n);
  dealtNames = 0;
  audio.deal();
  setStatus("洗牌發牌中…");
  render();
  // 處理可能的開局已經結束（幾乎不可能）
  if (state.done) finishRound();
}

/* ---------- 抽牌 ---------- */
function pickAiDrawTarget(ai) {
  const n = state.playerCount;
  const live = [];
  for (let p = 0; p < n; p++) {
    if (p !== ai && state.hands[p].length > 0) live.push(p);
  }
  if (!live.length) return -1;
  // 小聰明：挑牌數最多的對象，增加配對機會
  let best = live[0];
  for (const p of live) if (state.hands[p].length > state.hands[best].length) best = p;
  return best;
}

function humanDraw(fromPlayer) {
  if (phase !== "playing" || !state || state.done) return;
  const res = drawCard(state, fromPlayer, PLAYER);
  if (!res.ok) return;
  doDraw(res);
  advanceTurn();
}

function aiDraw(ai) {
  const target = pickAiDrawTarget(ai);
  if (target < 0) {
    finishRound();
    return;
  }
  const res = drawCard(state, target, ai);
  if (!res.ok) {
    advanceTurn();
    return;
  }
  doAiDraw(res, ai);
  advanceTurn();
}

function doDraw(res) {
  reveal = { by: PLAYER, from: res.from, card: res.drawn, paired: res.paired };
  const fromName = nameOf(res.from);
  setStatus(res.paired ? `🎉 你從 ${fromName} 抽到一張，配成對丟出！` : `你從 ${fromName} 抽了一張，沒配上。`, res.paired ? "win" : "warn");
  if (res.paired) audio.match();
  else audio.noMatch();
  render();
  scheduleRevealDismiss();
}

function doAiDraw(res, ai) {
  const fromName = nameOf(res.from);
  const pairedTxt = res.paired ? "左右手各一張，成對丟出！" : "沒配上，收進牌裡。";
  setStatus(`🤖 ${nameOf(ai)} 從 ${fromName} 抽了一張：${pairedTxt}`, "");
  if (res.paired) audio.match();
  else audio.noMatch();
  reveal = { by: ai, from: res.from, card: res.drawn, paired: res.paired };
  render();
  scheduleRevealDismiss();
}

let dismissTimer = null;
function scheduleRevealDismiss() {
  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    reveal = null;
    render();
  }, 900);
}

/** 依序推進到下一步（每次抽完呼叫；AI 連續抽直到回到人）。 */
function advanceTurn() {
  if (!state || phase !== "playing") return;
  if (state.done) {
    finishRound();
    return;
  }
  // 找出當前的下一位應玩家
  const last = state.history[state.history.length - 1];
  const lastBy = last && last.by !== undefined ? last.by : state.turn;
  const next = nextTurn(state, lastBy);
  state.turn = next;
  render();
  if (next === PLAYER) {
    setStatus("輪到你：點一位對手的牌背抽牌。");
    return; // 等玩家點對手
  }
  // AI：延遲一小步後動作
  setTimeout(() => {
    if (phase === "playing" && state && !state.done) aiDraw(next);
  }, 450);
}

function finishRound() {
  if (phase !== "playing") return;
  phase = "settling";
  const turtle = state.done.turtle;
  const before = scores.slice();
  scores = tally(state, scores);
  lastResult = { turtle, delta: scores, before };
  if (turtle === null) {
    setStatus("🤔 全部配完了，沒有烏龜！");
    audio.win();
  } else if (turtle === PLAYER) {
    setStatus("🐢 啊…烏龜是你！", "lose");
    audio.turtle();
  } else {
    setStatus(`🎉 ${nameOf(turtle)} 是烏龜！你逃過一劫 +1 分`, "win");
    audio.win();
    myWins++;
    if (myWins > bestStreak) {
      bestStreak = myWins;
      saveBest();
    }
  }
  render();
}

async function loadBest() {
  try {
    const res = await fetch(`/api/kv/${BEST_KEY}`);
    if (res.ok) {
      const t = (await res.text()).trim();
      if (/^\d+$/.test(t)) {
        bestStreak = Number(t);
        myWins = bestStreak;
        els.best.textContent = `${bestStreak} 連勝`;
        return;
      }
    }
  } catch {
    /* 無 KV */
  }
  els.best.textContent = "—";
}

async function saveBest() {
  els.best.textContent = `${bestStreak} 連勝`;
  try {
    await fetch(`/api/kv/${BEST_KEY}`, { method: "PUT", body: String(bestStreak) });
  } catch {
    /* 無 KV */
  }
}

/* ---------- 渲染 ---------- */
function render() {
  // 分數列
  els.scores.innerHTML = "";
  for (let p = 0; p < state.playerCount; p++) {
    const chip = document.createElement("span");
    chip.className = "score-chip" + (p === PLAYER ? " me" : "");
    chip.style.setProperty("--pc", COLORS[p % COLORS.length]);
    chip.textContent = `${nameOf(p)} ${scores[p] ?? 0}`;
    els.scores.appendChild(chip);
  }

  // 中央我的資訊
  els.removed.innerHTML = "";
  state.removed.slice(-8).forEach((c) => {
    const img = document.createElement("img");
    img.src = `assets/cards/${cardFile(c)}`;
    img.className = "removed-card";
    img.alt = cardText(c);
    els.removed.appendChild(img);
  });

  // 玩家區
  els.playersArea.innerHTML = "";
  for (let p = 0; p < state.playerCount; p++) {
    els.playersArea.appendChild(renderPlayer(p));
  }

  // 抽牌揭示
  const re = document.getElementById("reveal");
  if (reveal && phase !== "title") {
    re.classList.remove("hidden");
    re.innerHTML = "";
    const box = document.createElement("div");
    box.className = "reveal-box";
    const tag = document.createElement("div");
    tag.className = "reveal-tag";
    tag.textContent = `${nameOf(reveal.by)} 抽了 ${nameOf(reveal.from)} 的牌`;
    const img = document.createElement("img");
    img.src = `assets/cards/${cardFile(reveal.card)}`;
    img.alt = cardText(reveal.card);
    const note = document.createElement("div");
    note.className = "reveal-note";
    note.textContent = reveal.paired ? "配成對，丟出！" : "未配上";
    note.dataset.ok = reveal.paired ? "1" : "0";
    box.append(tag, img, note);
    re.appendChild(box);
  } else {
    re.classList.add("hidden");
  }

  renderButtons();
}

function renderPlayer(p) {
  const wrap = document.createElement("section");
  wrap.className = "player" + (p === PLAYER ? " me" : "") + (p === state.turn && phase === "playing" && !state.done ? " active" : "");
  wrap.style.setProperty("--pc", COLORS[p % COLORS.length]);

  const head = document.createElement("div");
  head.className = "player-head";
  const name = document.createElement("strong");
  name.textContent = `${p === PLAYER ? "🙋" : "🤖"} ${nameOf(p)}`;
  const hold = document.createElement("span");
  hold.className = "hold";
  hold.textContent = `${state.hands[p].length} 張`;
  head.append(name, hold);
  wrap.appendChild(head);

  const fan = document.createElement("div");
  fan.className = "fan";
  const showValues = p === PLAYER;
  const hand = state.hands[p];
  const max = 26;
  const step = hand.length > 1 ? Math.min(2.2, 30 / hand.length) : 0;
  const offset = hand.length > 1 ? -step * (hand.length - 1) / 2 : 0;

  if (hand.length === 0) {
    const chip = document.createElement("div");
    chip.className = "no-hand";
    chip.textContent = "—";
    fan.appendChild(chip);
  } else if (showValues) {
    hand.forEach((c, i) => {
      const img = document.createElement("img");
      img.src = `assets/cards/${cardFile(c)}`;
      img.className = "my-card";
      img.alt = cardText(c);
      img.style.zIndex = i;
      img.style.translate = `${offset + step * i}px 0`;
      fan.appendChild(img);
    });
  } else {
    // 對手：只看張數，盲抽／點抽
    hand.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "back-card";
      btn.disabled = !(phase === "playing" && state.turn === PLAYER && !state.done);
      btn.setAttribute("aria-label", `從 ${nameOf(p)} 抽第 ${i + 1} 張`);
      const img = document.createElement("img");
      img.src = "assets/cards/card_back.png";
      img.alt = "牌背";
      img.draggable = false;
      btn.appendChild(img);
      btn.style.zIndex = i;
      btn.style.translate = `${offset + step * i}px 0`;
      btn.addEventListener("click", () => humanDraw(p));
      fan.appendChild(btn);
    });
  }
  wrap.appendChild(fan);
  return wrap;
}

function renderButtons() {
  if (phase === "title") {
    els.btnNew.textContent = "開局";
  } else if (phase === "playing" && state.turn === PLAYER && !state.done) {
    els.btnNew.textContent = "重新發牌";
  } else {
    els.btnNew.textContent = phase === "settling" ? "下一局" : "重新發牌";
  }
}

function newGameBtn() {
  if (phase === "playing" && state && !state.done && state.turn !== PLAYER) {
    // 仍可重發
  }
  startRound();
}

function bindEvents() {
  els.btnNew.addEventListener("click", newGameBtn);
  els.btnMute.addEventListener("click", () => {
    const on = audio.enabled;
    audio.setEnabled(!on);
    els.btnMute.setAttribute("aria-pressed", String(!on));
    els.btnMute.textContent = on ? "音效關" : "音效開";
  });
  // 起始：讓 AI 先跑一輪演化（AI1 開始）→ 快速進到玩家回合
}

function startAiFlow() {
  // 發牌動畫後，由 0 之後第一家開始（玩家可能不是先手）
  setTimeout(() => {
    if (!state || state.done) return;
    phase = "playing";
    const lastBy = state.turn;
    const next = nextTurn(state, lastBy);
    state.turn = next;
    render();
    if (next !== PLAYER) {
      setTimeout(() => {
        if (phase === "playing" && state && !state.done) aiDraw(next);
      }, 500);
    } else {
      setStatus("輪到你：點一位對手的牌背抽牌。");
      render();
    }
  }, 700);
}

/* ---------- 啟動 ---------- */
async function init() {
  bindEvents();
  await loadBest();
  startRound();
  startAiFlow();
}

init();