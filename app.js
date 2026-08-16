/**
 * 抓烏龜 — 介面與互動。
 * 玩家（第 0 家）對 AI。翻對子、盲抽、烏龜判定。
 */
import {
  newRound,
  drawCard,
  nextTurn,
  tally,
  cardText,
} from "./game.js";
import { ZhuaguiAudio } from "./audio.js";

const audio = new ZhuaguiAudio();

const els = {
  status: document.getElementById("status"),
  playersArea: document.getElementById("players"),
  removed: document.getElementById("removed"),
  scores: document.getElementById("scores"),
  reveal: document.getElementById("reveal"),
  result: document.getElementById("result"),
  log: document.getElementById("log"),
  btnNew: document.getElementById("btn-new"),
  btnMute: document.getElementById("btn-mute"),
  streak: document.getElementById("streak-label"),
  best: document.getElementById("best-label"),
};

const BEST_KEY = "pg-zhuagui-best";

const PLAYER = 0;
const PLAYERS = 4;
const NAMES = ["你", "阿明", "小美", "大熊"];
const COLORS = ["#e23d3d", "#2f8f4e", "#3b82f6", "#a855f7"];
const REVEAL_MS = 1600;
const LOG_MAX = 14;

let state = null;
let scores = [0, 0, 0, 0];
let phase = "idle"; // idle | dealing | playing | settling
let reveal = null; // 抽牌揭示 { by, from, card, paired }
let streak = 0;
let best = 0;
let roundToken = 0; // 作廢過期的 setTimeout
let dismissTimer = null;

const cardFile = (c) => {
  if (c.rank === 0) return "card_joker_red.png";
  const rank =
    c.rank === 1 ? "A" : c.rank === 11 ? "J" : c.rank === 12 ? "Q" : c.rank === 13 ? "K" : String(c.rank).padStart(2, "0");
  const suit = c.suit === 0 ? "spades" : c.suit === 1 ? "hearts" : c.suit === 2 ? "diamonds" : "clubs";
  return `card_${suit}_${rank}.png`;
};

function cardImg(card, cls) {
  const img = document.createElement("img");
  img.src = `assets/cards/${cardFile(card)}`;
  img.alt = cardText(card);
  if (cls) img.className = cls;
  img.draggable = false;
  return img;
}

function setStatus(msg, tone = "") {
  els.status.textContent = msg;
  els.status.dataset.tone = tone;
}

function nameOf(p) {
  return NAMES[p] || `玩家${p + 1}`;
}

function paintStreak() {
  els.streak.textContent = String(streak);
  els.best.textContent = best > 0 ? String(best) : "—";
}

/* ---------- 對局流程 ---------- */
function startRound() {
  audio.unlock();
  const token = ++roundToken;
  phase = "dealing";
  reveal = null;
  clearTimeout(dismissTimer);
  state = newRound(PLAYERS);
  scores = scores.slice(0, state.playerCount);
  audio.deal();
  setStatus("洗牌發牌中…");
  render();
  setTimeout(() => {
    if (token !== roundToken) return;
    if (state.done) {
      finishRound();
      return;
    }
    phase = "playing";
    // 先讓 AI 出手，再輪到玩家
    const next = nextTurn(state, PLAYER);
    state.turn = next;
    render();
    if (next === PLAYER) {
      promptHuman();
      return;
    }
    aiStep(next, token);
  }, 900);
}

function promptHuman() {
  setStatus("輪到你：點一位對手的牌背盲抽一張。", "you");
  render();
}

function aiStep(ai, token) {
  setTimeout(() => {
    if (token !== roundToken || phase !== "playing" || !state || state.done) return;
    aiDraw(ai);
  }, 650);
}

/** 依序推進到下一步（每次抽完呼叫；AI 連續抽直到回到人）。 */
function advanceTurn() {
  if (!state || phase !== "playing") return;
  if (state.done) {
    finishRound();
    return;
  }
  const last = state.history[state.history.length - 1];
  const lastBy = last && last.by !== undefined ? last.by : state.turn;
  const next = nextTurn(state, lastBy);
  state.turn = next;
  render();
  if (next === PLAYER) {
    promptHuman();
    return;
  }
  setStatus(`${nameOf(next)} 正在抽牌…`);
  render();
  aiStep(next, roundToken);
}

function finishRound() {
  if (phase === "settling") return;
  phase = "settling";
  reveal = null;
  clearTimeout(dismissTimer);
  const turtle = state.done?.turtle ?? null;
  scores = tally(state, scores);
  if (turtle === PLAYER) {
    streak = 0;
    setStatus("🐢 啊…烏龜是你！", "lose");
    audio.turtle();
  } else if (turtle === null) {
    streak = 0;
    setStatus("🤝 全部配完了，這局沒有烏龜！");
    audio.win();
  } else {
    streak += 1;
    if (streak > best) {
      best = streak;
      saveBest();
    }
    setStatus(`🎉 ${nameOf(turtle)} 是烏龜！你逃過一劫 +1 分`, "win");
    audio.win();
  }
  render();
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
  let target = live[0];
  for (const p of live) if (state.hands[p].length > state.hands[target].length) target = p;
  return target;
}

function humanDraw(fromPlayer) {
  if (phase !== "playing" || !state || state.done || state.turn !== PLAYER) return;
  audio.click();
  const res = drawCard(state, fromPlayer, PLAYER);
  if (!res.ok) {
    audio.error();
    return;
  }
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

function scheduleRevealDismiss() {
  const token = roundToken;
  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    if (token !== roundToken) return;
    reveal = null;
    render();
  }, REVEAL_MS);
}

/* ---------- 連勝紀錄（KV 可選） ---------- */
async function loadBest() {
  try {
    const res = await fetch(`/api/kv/${BEST_KEY}`);
    if (res.ok) {
      const t = (await res.text()).trim();
      if (/^\d+$/.test(t)) best = Number(t);
    }
  } catch {
    /* 無 KV */
  }
  paintStreak();
}

function saveBest() {
  paintStreak();
  try {
    Promise.resolve(fetch(`/api/kv/${BEST_KEY}`, { method: "PUT", body: String(best) })).catch(() => {});
  } catch {
    /* 無 KV */
  }
}

/* ---------- 渲染 ---------- */
function render() {
  if (!state) return;
  renderScores();
  renderRemoved();
  renderPlayers();
  renderReveal();
  renderResult();
  renderLog();
  renderButtons();
  paintStreak();
}

function renderScores() {
  els.scores.innerHTML = "";
  for (let p = 0; p < state.playerCount; p++) {
    const chip = document.createElement("span");
    chip.className = "score-chip" + (p === PLAYER ? " me" : "");
    chip.style.setProperty("--pc", COLORS[p % COLORS.length]);
    chip.textContent = `${nameOf(p)} ${scores[p] ?? 0}`;
    els.scores.appendChild(chip);
  }
}

function renderRemoved() {
  els.removed.innerHTML = "";
  state.removed.slice(-8).forEach((c) => {
    els.removed.appendChild(cardImg(c, "removed-card"));
  });
}

function fanAvailWidth() {
  const area = els.playersArea;
  const w = area.clientWidth || 320;
  let grid = false;
  if (typeof getComputedStyle === "function") {
    grid = getComputedStyle(area).display === "grid";
  }
  // 桌面 grid 時每格只有半寬；再扣掉 padding、頭部與間距
  const colW = grid ? w / 2 : w;
  return Math.max(140, colW - 110);
}

function placeCard(fan, el, i, step, offset) {
  el.style.zIndex = String(i + 1);
  el.style.translate = `${(offset + step * i).toFixed(1)}px 0`;
  fan.appendChild(el);
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
  const hand = state.hands[p];
  const showValues = p === PLAYER;
  const myTurn = phase === "playing" && state.turn === PLAYER && !state.done;

  if (hand.length === 0) {
    const chip = document.createElement("div");
    chip.className = "no-hand";
    chip.textContent = "沒牌了";
    fan.appendChild(chip);
  } else {
    const cardW = 36;
    const avail = fanAvailWidth();
    const step = hand.length > 1 ? Math.max(4, Math.min(20, (avail - cardW) / (hand.length - 1))) : 0;
    const offset = -step * (hand.length - 1) / 2;
    if (showValues) {
      hand.forEach((c, i) => {
        placeCard(fan, cardImg(c, "my-card"), i, step, offset);
      });
    } else {
      hand.forEach((c, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "back-card";
        btn.disabled = !myTurn;
        btn.setAttribute("aria-label", `從 ${nameOf(p)} 盲抽一張`);
        const img = document.createElement("img");
        img.src = "assets/cards/card_back.png";
        img.alt = "";
        img.draggable = false;
        btn.appendChild(img);
        btn.addEventListener("click", () => humanDraw(p));
        placeCard(fan, btn, i, step, offset);
      });
    }
  }
  wrap.appendChild(fan);
  return wrap;
}

function renderPlayers() {
  els.playersArea.innerHTML = "";
  for (let p = 0; p < state.playerCount; p++) {
    els.playersArea.appendChild(renderPlayer(p));
  }
}

function renderReveal() {
  if (reveal && phase === "playing") {
    els.reveal.classList.remove("hidden");
    els.reveal.innerHTML = "";
    const box = document.createElement("div");
    box.className = "reveal-box" + (reveal.paired ? " ok" : "");
    const tag = document.createElement("div");
    tag.className = "reveal-tag";
    tag.textContent = `${nameOf(reveal.by)} 抽了 ${nameOf(reveal.from)} 的牌`;
    box.appendChild(tag);
    box.appendChild(cardImg(reveal.card, "reveal-card"));
    const note = document.createElement("div");
    note.className = "reveal-note";
    note.textContent = reveal.paired ? "配成對，丟出！" : "未配上";
    note.dataset.ok = reveal.paired ? "1" : "0";
    box.appendChild(note);
    els.reveal.appendChild(box);
  } else {
    els.reveal.classList.add("hidden");
  }
}

function renderResult() {
  if (phase !== "settling") {
    els.result.classList.add("hidden");
    return;
  }
  els.result.classList.remove("hidden");
  els.result.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "result-card";

  const turtle = state.done?.turtle ?? null;
  const h2 = document.createElement("h2");
  h2.textContent =
    turtle === PLAYER ? "🐢 烏龜就是你…" : turtle === null ? "🤝 全部配完了！" : "🎉 你逃過一劫！";
  inner.appendChild(h2);

  const sub = document.createElement("p");
  sub.className = "result-sub";
  sub.textContent =
    turtle === null
      ? "這局沒有人拿到烏龜牌，大家都有分。"
      : `${nameOf(turtle)} 手裡留下了烏龜牌。`;
  inner.appendChild(sub);

  if (turtle !== null) {
    const holder = state.hands[turtle];
    if (holder && holder.length) {
      inner.appendChild(cardImg(holder[holder.length - 1], "result-turtle-card"));
    }
  }

  const list = document.createElement("ul");
  list.className = "result-scores";
  for (let i = 0; i < state.playerCount; i++) {
    const li = document.createElement("li");
    li.className = "result-score" + (i === PLAYER ? " me" : "") + (i === turtle ? " turtle" : "");
    li.style.setProperty("--pc", COLORS[i % COLORS.length]);
    const delta = turtle === null ? "0" : i === turtle ? "🐢" : "+1";
    li.textContent = `${nameOf(i)}（${delta}）  ${scores[i] ?? 0}`;
    list.appendChild(li);
  }
  inner.appendChild(list);

  const streakLine = document.createElement("p");
  streakLine.className = "result-streak";
  streakLine.textContent = `你的連勝：${streak}｜最佳：${best > 0 ? best : "—"}`;
  inner.appendChild(streakLine);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "來下一局";
  btn.addEventListener("click", () => {
    audio.click();
    startRound();
  });
  inner.appendChild(btn);

  els.result.appendChild(inner);
  btn.focus({ preventScroll: true });
}

function renderLog() {
  if (!els.log) return;
  els.log.innerHTML = "";
  const items = state.history.slice(-LOG_MAX).reverse();
  for (const h of items) {
    const li = document.createElement("li");
    if (h.by !== undefined) {
      li.textContent = `${nameOf(h.by)} 抽了 ${nameOf(h.from)} 的`;
      li.appendChild(cardImg(h.card, "log-card"));
      li.appendChild(document.createTextNode(h.paired ? " → 成對丟出！" : " → 未配上"));
    } else {
      li.textContent = h.text;
    }
    els.log.appendChild(li);
  }
}

function renderButtons() {
  if (phase === "dealing") {
    els.btnNew.disabled = true;
    els.btnNew.textContent = "發牌中…";
  } else if (phase === "playing") {
    els.btnNew.disabled = false;
    els.btnNew.textContent = "重開這局";
  } else {
    els.btnNew.disabled = true;
    els.btnNew.textContent = "本局結束";
  }
}

/* ---------- 啟動 ---------- */
function bindEvents() {
  els.btnNew.addEventListener("click", () => {
    if (phase !== "playing") return;
    audio.click();
    startRound();
  });
  els.btnMute.addEventListener("click", () => {
    const on = audio.enabled;
    audio.setEnabled(!on);
    els.btnMute.setAttribute("aria-pressed", String(!on));
    els.btnMute.textContent = on ? "音效關" : "音效開";
  });
}

async function init() {
  bindEvents();
  await loadBest();
  startRound();
}

init();
