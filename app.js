/**
 * 抓烏龜 — 介面與互動。
 * 玩家（第 0 家）對 AI。翻對子、盲抽、烏龜判定。
 * 牌面＝CSS 向量繪製；牌背＝Kenney PNG。
 */
import {
  newRound,
  drawCard,
  nextTurn,
  tally,
  cardText,
  rankText,
  SUIT_CHAR,
  pickAiDrawTarget,
  emptyStats,
  parseStats,
  applyRoundStats,
  drawnFromHistory,
} from "./game.js";
import { ZhuaguiAudio } from "./audio.js";

const audio = new ZhuaguiAudio();

const els = {
  status: document.getElementById("status"),
  oppRow: document.getElementById("opp-row"),
  removed: document.getElementById("removed"),
  pileCount: document.getElementById("pile-count"),
  myFan: document.getElementById("my-fan"),
  meCount: document.getElementById("me-count"),
  scores: document.getElementById("scores"),
  reveal: document.getElementById("reveal"),
  result: document.getElementById("result"),
  setup: document.getElementById("setup"),
  log: document.getElementById("log"),
  btnNew: document.getElementById("btn-new"),
  btnMute: document.getElementById("btn-mute"),
  btnTrack: document.getElementById("btn-track"),
  streak: document.getElementById("streak-label"),
  best: document.getElementById("best-label"),
  careerGames: document.getElementById("career-games"),
  careerTurtles: document.getElementById("career-turtles"),
};

const STATS_KEY = "pg-zhuagui-stats";
const LEGACY_BEST_KEY = "pg-zhuagui-best";

const PLAYER = 0;
const NAMES = ["你", "阿明", "小美", "大熊"];
const COLORS = ["#e23d3d", "#2f8f4e", "#3b82f6", "#a855f7"];
const AVATARS = ["🙂", "🐰", "🦊", "🐻"];
const REVEAL_MS = 1600;
const LOG_MAX = 14;
const BADGE_MAX = 3;
const PILE_MAX = 10;
const TENSE_AT = 3;

let state = null;
let scores = [0, 0, 0, 0];
let lastScores = [];
let phase = "setup"; // setup | dealing | playing | settling
let reveal = null; // { by, from, card, paired, partner }
let revealKey = "";
let streak = 0;
let stats = emptyStats();
let settings = { playerCount: 4, difficulty: "standard" }; // difficulty: easy | standard | hard
let trackMemory = true;
let roundToken = 0; // 作廢過期的 setTimeout
let dismissTimer = null;
let tenseTotal = Infinity;

/* ---------- 牌元件（CSS 向量正面／PNG 背面） ---------- */

function cssCard(card, cls) {
  const el = document.createElement("div");
  el.className = "css-card" + (cls ? " " + cls : "");
  el.setAttribute("aria-label", cardText(card));
  el.setAttribute("role", "img");
  if (card.rank === 0) {
    el.classList.add("joker");
    el.innerHTML = `<b class="cc-tl">🐢</b><span class="cc-pip">🐢</span><b class="cc-br">🐢</b>`;
    return el;
  }
  const red = card.suit === 1 || card.suit === 2;
  if (red) el.classList.add("red");
  if (card.rank >= 11) el.classList.add("court");
  const r = rankText(card.rank);
  const g = SUIT_CHAR[card.suit];
  el.innerHTML =
    `<b class="cc-tl"><span>${r}</span><i class="cc-s">${g}</i></b>` +
    `<span class="cc-pip">${card.rank >= 11 ? r : g}</span>` +
    `<b class="cc-br"><span>${r}</span><i class="cc-s">${g}</i></b>`;
  return el;
}

function backEl(cls, clickable) {
  const el = clickable ? document.createElement("button") : document.createElement("div");
  if (clickable) el.type = "button";
  el.className = "css-back" + (cls ? " " + cls : "");
  const img = document.createElement("img");
  img.src = "assets/cards/card_back.png";
  img.alt = "";
  img.draggable = false;
  el.appendChild(img);
  return el;
}

function vib(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* 不支援 */
  }
}

/* ---------- 扇形幾何 ---------- */

function fanLayout(fanEl, n) {
  const cwRaw = getComputedStyle(fanEl).getPropertyValue("--cw").trim();
  const cw = /rem/.test(cwRaw) ? parseFloat(cwRaw) * 16 : parseFloat(cwRaw) || 36;
  const avail = Math.max(cw + 24, fanEl.clientWidth - 8);
  const usable = Math.min(avail, cw * (n <= 1 ? 1 : 0.62 * (n - 1) + 1));
  const step = n > 1 ? (usable - cw) / (n - 1) : 0;
  const mid = (n - 1) / 2;
  const rotMax = Math.max(1.6, Math.min(5.2, 9 - n * 0.45));
  return { cw, step, mid, rotMax };
}

function placeCard(fanEl, el, i, geo) {
  el.style.zIndex = String(i + 1);
  el.style.setProperty("--tx", `${((i - geo.mid) * geo.step).toFixed(1)}px`);
  const d = Math.abs(i - geo.mid);
  el.style.setProperty("--ty", `${(d * d * 0.7).toFixed(1)}px`);
  el.style.setProperty("--rot", `${((i - geo.mid) * (geo.rotMax / Math.max(1, geo.mid))).toFixed(2)}deg`);
  fanEl.appendChild(el);
}

/* ---------- 基本工具 ---------- */

function setStatus(msg, tone = "") {
  els.status.textContent = msg;
  els.status.dataset.tone = tone;
}

function nameOf(p) {
  return NAMES[p] || `玩家${p + 1}`;
}

function totalCards() {
  if (!state) return 0;
  return state.hands.reduce((a, h) => a + h.length, 0);
}

function paintStreak() {
  els.streak.textContent = String(streak);
  els.best.textContent = stats.best > 0 ? String(stats.best) : "—";
  els.careerGames.textContent = String(stats.games);
  els.careerTurtles.textContent = String(stats.turtles);
}

/** 依最近事件給 AI 表情。 */
function exprOf(p) {
  if (!state) return AVATARS[p] || "🙂";
  if (state.hands[p].length === 0 && phase !== "settling") return "😮‍💨";
  for (let i = state.history.length - 1; i >= 0; i--) {
    const h = state.history[i];
    if (h.by === undefined) continue;
    if (h.card?.rank === 0 && h.by === p) return "😱";
    if (h.card?.rank === 0 && h.from === p) return "😮‍💨";
    if (h.by === p) return h.paired ? "😎" : "🙂";
    if (h.from === p) return h.paired ? "😖" : "😬";
  }
  return AVATARS[p] || "🙂";
}

/* ---------- 開局設定 ---------- */

function paintSetup() {
  els.setup.querySelectorAll(".seg-btn[data-count]").forEach((b) => {
    const on = Number(b.dataset.count) === settings.playerCount;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  });
  els.setup.querySelectorAll(".seg-btn[data-diff]").forEach((b) => {
    const on = b.dataset.diff === settings.difficulty;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  });
}

function showSetup() {
  phase = "setup";
  state = null;
  reveal = null;
  revealKey = "";
  tenseTotal = Infinity;
  document.body.dataset.tense = "0";
  clearTimeout(dismissTimer);
  els.setup.classList.remove("hidden");
  els.reveal.classList.add("hidden");
  els.result.classList.add("hidden");
  setStatus("先設定人數與難度，再開始發牌。");
  render();
  els.setup.querySelector("#btn-start").focus({ preventScroll: true });
}

/* ---------- 對局流程 ---------- */

function startRound() {
  audio.unlock();
  const token = ++roundToken;
  phase = "dealing";
  reveal = null;
  revealKey = "";
  tenseTotal = Infinity;
  document.body.dataset.tense = "0";
  clearTimeout(dismissTimer);
  els.setup.classList.add("hidden");
  state = newRound(settings.playerCount);
  scores = scores.slice(0, state.playerCount);
  while (scores.length < state.playerCount) scores.push(0);
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
  const total = totalCards();
  if (total <= TENSE_AT && total < tenseTotal) {
    audio.heartbeat();
    vib(40);
  }
  tenseTotal = total;
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
  revealKey = "";
  document.body.dataset.tense = "0";
  clearTimeout(dismissTimer);
  const turtle = state.done?.turtle ?? null;
  scores = tally(state, scores);
  stats = applyRoundStats(stats, turtle, state.playerCount);
  if (turtle === PLAYER) {
    streak = 0;
    setStatus("🐢 啊…烏龜是你！", "lose");
    audio.turtle();
    vib([80, 60, 120]);
  } else if (turtle === null) {
    streak = 0;
    setStatus("🤝 全部配完了，這局沒有烏龜！");
    audio.win();
  } else {
    streak += 1;
    setStatus(`🎉 ${nameOf(turtle)} 是烏龜！你逃過一劫 +1 分`, "win");
    audio.win();
    vib(60);
  }
  if (streak > stats.best) stats.best = streak;
  saveStats();
  render();
}

/* ---------- 抽牌 ---------- */

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
  const target = pickAiDrawTarget(state, ai, settings.difficulty);
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

/** 找揭示用的配對手：剛丟進removed、同點數的最新一張（不含自己）。 */
function findPartner(card) {
  for (let i = state.removed.length - 1; i >= 0; i--) {
    if (state.removed[i].rank === card.rank && state.removed[i] !== card) return state.removed[i];
  }
  return null;
}

function setReveal(res, by) {
  reveal = {
    by,
    from: res.from,
    card: res.drawn,
    paired: res.paired,
    partner: res.paired ? findPartner(res.drawn) : null,
  };
  audio.whoosh();
  if (res.paired) vib([20, 30, 20]);
}

function doDraw(res) {
  setReveal(res, PLAYER);
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
  setReveal(res, ai);
  render();
  scheduleRevealDismiss();
}

function scheduleRevealDismiss() {
  const token = roundToken;
  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    if (token !== roundToken) return;
    reveal = null;
    revealKey = "";
    render();
  }, REVEAL_MS);
}

/* ---------- 戰績持久化（KV：單一 JSON key） ---------- */

async function loadStats() {
  try {
    const res = await fetch(`/api/kv/${STATS_KEY}`);
    if (res.ok) {
      const parsed = parseStats(await res.text());
      if (parsed) stats = parsed;
    }
  } catch {
    /* 無 KV */
  }
  if (stats.games === 0 && stats.best === 0) {
    // 遷移：舊版只存最佳連勝的純數字 key
    try {
      const res = await fetch(`/api/kv/${LEGACY_BEST_KEY}`);
      if (res.ok) {
        const t = (await res.text()).trim();
        if (/^\d+$/.test(t)) stats.best = Number(t);
      }
    } catch {
      /* 無 KV */
    }
  }
  audio.setEnabled(!stats.muted);
  els.btnMute.setAttribute("aria-pressed", String(!stats.muted));
  els.btnMute.textContent = stats.muted ? "音效關" : "音效開";
  paintStreak();
}

function saveStats() {
  paintStreak();
  try {
    Promise.resolve(
      fetch(`/api/kv/${STATS_KEY}`, {
        method: "PUT",
        body: JSON.stringify(stats),
      })
    ).catch(() => {});
  } catch {
    /* 無 KV */
  }
}

/* ---------- 渲染 ---------- */

function render() {
  renderSetup();
  if (!state) {
    els.scores.innerHTML = "";
    els.oppRow.innerHTML = "";
    els.myFan.innerHTML = "";
    els.removed.innerHTML = "";
    els.pileCount.textContent = "已丟 0";
    els.meCount.textContent = "0 張";
    paintStreak();
    renderButtons();
    return;
  }
  document.body.dataset.tense = phase === "playing" && totalCards() <= TENSE_AT ? "1" : "0";
  renderScores();
  renderPile();
  renderOppRow();
  renderMe();
  renderReveal();
  renderResult();
  renderLog();
  renderButtons();
  paintStreak();
}

function renderSetup() {
  els.setup.classList.toggle("hidden", phase !== "setup");
}

function renderScores() {
  els.scores.innerHTML = "";
  for (let p = 0; p < state.playerCount; p++) {
    const chip = document.createElement("span");
    chip.className = "score-chip" + (p === PLAYER ? " me" : "");
    chip.style.setProperty("--pc", COLORS[p % COLORS.length]);
    chip.textContent = `${nameOf(p)} ${scores[p] ?? 0}`;
    if ((lastScores[p] ?? 0) !== (scores[p] ?? 0)) {
      chip.classList.add("bump");
    }
    lastScores[p] = scores[p] ?? 0;
    els.scores.appendChild(chip);
  }
}

function renderPile() {
  els.removed.innerHTML = "";
  els.pileCount.textContent = `已丟 ${state.removed.length}`;
  const cards = state.removed.slice(-PILE_MAX);
  const n = cards.length;
  const mid = (n - 1) / 2;
  cards.forEach((c, i) => {
    const el = cssCard(c);
    el.style.setProperty("--tx", `${((i - mid) * 7).toFixed(1)}px`);
    el.style.setProperty("--ty", `${(Math.abs(i - mid) * -1.2).toFixed(1)}px`);
    el.style.setProperty("--rot", `${((i - mid) * 2.4).toFixed(1)}deg`);
    el.style.zIndex = String(i + 1);
    els.removed.appendChild(el);
  });
}

function renderOppRow() {
  els.oppRow.innerHTML = "";
  const myTurn = phase === "playing" && state.turn === PLAYER && !state.done;
  for (let p = 1; p < state.playerCount; p++) {
    const wrap = document.createElement("section");
    wrap.className =
      "opp" + (p === state.turn && phase === "playing" && !state.done ? " active" : "");
    wrap.style.setProperty("--pc", COLORS[p % COLORS.length]);

    const id = document.createElement("div");
    id.className = "opp-id";
    const av = document.createElement("div");
    av.className = "avatar";
    av.innerHTML = `<span class="expr">${exprOf(p)}</span>`;
    const meta = document.createElement("div");
    meta.className = "opp-meta";
    const nm = document.createElement("strong");
    nm.textContent = nameOf(p);
    const hold = document.createElement("span");
    hold.className = "hold";
    hold.textContent = `${state.hands[p].length} 張`;
    meta.append(nm, hold);
    id.append(av, meta);
    wrap.appendChild(id);

    const fan = document.createElement("div");
    fan.className = "fan backfan";
    const hand = state.hands[p];
    if (!hand.length) {
      const chip = document.createElement("div");
      chip.className = "no-hand";
      chip.textContent = "沒牌了";
      fan.appendChild(chip);
    } else {
      const geo = fanLayout(fan, hand.length);
      hand.forEach((c, i) => {
        const btn = backEl("", true);
        btn.disabled = !myTurn;
        btn.setAttribute("aria-label", `從 ${nameOf(p)} 盲抽一張`);
        btn.addEventListener("click", () => humanDraw(p));
        placeCard(fan, btn, i, geo);
      });
    }
    wrap.appendChild(fan);

    if (trackMemory) {
      const taken = drawnFromHistory(state, p, BADGE_MAX);
      if (taken.length) {
        const badges = document.createElement("div");
        badges.className = "badges";
        badges.setAttribute("aria-label", `${nameOf(p)} 曾被抽走`);
        taken.forEach((c) => badges.appendChild(cssCard(c)));
        wrap.appendChild(badges);
      }
    }
    els.oppRow.appendChild(wrap);
  }
}

function renderMe() {
  els.myFan.innerHTML = "";
  const hand = state.hands[PLAYER];
  els.meCount.textContent = `${hand.length} 張`;
  if (!hand.length) {
    const chip = document.createElement("div");
    chip.className = "no-hand";
    chip.textContent = "沒牌了";
    els.myFan.appendChild(chip);
    return;
  }
  const geo = fanLayout(els.myFan, hand.length);
  hand.forEach((c, i) => {
    const el = cssCard(c, "my-card");
    el.addEventListener("pointerdown", () => el.classList.add("lift"));
    el.addEventListener("pointerup", () => el.classList.remove("lift"));
    el.addEventListener("pointerleave", () => el.classList.remove("lift"));
    placeCard(els.myFan, el, i, geo);
  });
}

function renderReveal() {
  if (!reveal || phase !== "playing") {
    els.reveal.classList.add("hidden");
    revealKey = "";
    return;
  }
  const key = `${reveal.by}-${reveal.from}-${reveal.card.rank}-${reveal.card.suit}-${reveal.paired ? 1 : 0}-${reveal.partner ? reveal.partner.suit : ""}`;
  if (key === revealKey) return; // 同一次揭示不重建，保留翻面動畫
  revealKey = key;
  els.reveal.classList.remove("hidden");
  els.reveal.innerHTML = "";
  const box = document.createElement("div");
  box.className = "reveal-box" + (reveal.paired ? " ok" : "");
  const tag = document.createElement("div");
  tag.className = "reveal-tag";
  tag.textContent = `${nameOf(reveal.by)} 抽了 ${nameOf(reveal.from)} 的牌`;
  box.appendChild(tag);

  const row = document.createElement("div");
  row.className = "reveal-row";
  const flip = document.createElement("div");
  flip.className = "flip";
  const inner = document.createElement("div");
  inner.className = "flip-inner";
  const back = backEl("fface");
  const face = cssCard(reveal.card, "fface");
  inner.append(back, face);
  flip.appendChild(inner);
  row.appendChild(flip);
  if (reveal.paired && reveal.partner) {
    const partner = cssCard(reveal.partner);
    partner.style.setProperty("--cw", "clamp(3rem, 9vw, 4rem)");
    row.appendChild(partner);
  }
  box.appendChild(row);

  const note = document.createElement("div");
  note.className = "reveal-note";
  note.textContent = reveal.paired ? "配成對，丟出！" : "未配上";
  note.dataset.ok = reveal.paired ? "1" : "0";
  box.appendChild(note);
  els.reveal.appendChild(box);
  requestAnimationFrame(() => requestAnimationFrame(() => flip.classList.add("show")));
}

function renderResult() {
  if (phase !== "settling") {
    els.result.classList.add("hidden");
    return;
  }
  els.result.classList.remove("hidden");
  els.result.innerHTML = "";
  const turtle = state.done?.turtle ?? null;
  const escaped = turtle !== PLAYER;
  if (escaped) els.result.classList.remove("turtled");
  else els.result.classList.add("turtled");

  if (escaped) {
    const conf = document.createElement("div");
    conf.className = "confetti";
    const palette = ["#fbbf24", "#f87171", "#34d399", "#60a5fa", "#f472b6", "#a78bfa"];
    for (let i = 0; i < 26; i++) {
      const s = document.createElement("i");
      s.style.setProperty("--x", `${Math.round(Math.random() * 100)}%`);
      s.style.setProperty("--clr", palette[i % palette.length]);
      s.style.setProperty("--d", `${(1.4 + Math.random() * 1.4).toFixed(2)}s`);
      s.style.setProperty("--dl", `${(Math.random() * 1.2).toFixed(2)}s`);
      s.style.setProperty("--r", `${Math.round(Math.random() * 360)}deg`);
      conf.appendChild(s);
    }
    els.result.appendChild(conf);
  } else {
    const turtleEl = document.createElement("span");
    turtleEl.className = "turtle-crawl";
    turtleEl.textContent = "🐢";
    els.result.appendChild(turtleEl);
  }

  const inner = document.createElement("div");
  inner.className = "result-card";

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
      inner.appendChild(cssCard(holder[holder.length - 1], "result-turtle-card"));
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
  streakLine.textContent = `你的連勝：${streak}｜生涯：${stats.games} 場・當過 ${stats.turtles} 次烏龜｜最佳：${stats.best > 0 ? stats.best : "—"}`;
  inner.appendChild(streakLine);

  const aiLine = document.createElement("p");
  aiLine.className = "result-career";
  for (let p = 1; p < state.playerCount; p++) {
    const rec = stats.ai[p - 1];
    const chip = document.createElement("span");
    chip.className = "ai-chip";
    chip.style.setProperty("--pc", COLORS[p % COLORS.length]);
    chip.textContent = `對 ${nameOf(p)}：${rec.games} 局・🐢 ${rec.turtles}`;
    aiLine.appendChild(chip);
  }
  inner.appendChild(aiLine);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "來下一局";
  btn.addEventListener("click", () => {
    audio.click();
    startRound();
  });
  inner.appendChild(btn);

  const setupBtn = document.createElement("button");
  setupBtn.type = "button";
  setupBtn.className = "secondary";
  setupBtn.textContent = "變更設定";
  setupBtn.addEventListener("click", () => {
    audio.click();
    showSetup();
  });
  inner.appendChild(setupBtn);

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
      li.dataset.ok = h.paired ? "1" : "0";
      li.style.setProperty("--pc", COLORS[(h.by ?? 0) % COLORS.length]);
      li.textContent = `${nameOf(h.by)} 抽了 ${nameOf(h.from)} 的`;
      li.appendChild(cssCard(h.card, "log-card"));
      li.appendChild(document.createTextNode(h.paired ? " → 成對丟出！" : " → 未配上"));
    } else {
      li.textContent = h.text;
    }
    els.log.appendChild(li);
  }
}

function renderButtons() {
  if (phase === "setup") {
    els.btnNew.disabled = true;
    els.btnNew.textContent = "尚未開局";
  } else if (phase === "dealing") {
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
    stats.muted = on; // 原本的開關狀態被關掉
    saveStats();
  });
  els.btnTrack.addEventListener("click", () => {
    trackMemory = !trackMemory;
    els.btnTrack.setAttribute("aria-pressed", String(trackMemory));
    audio.click();
    render();
  });
  els.setup.querySelectorAll(".seg-btn[data-count]").forEach((b) => {
    b.addEventListener("click", () => {
      audio.click();
      settings.playerCount = Number(b.dataset.count);
      paintSetup();
    });
  });
  els.setup.querySelectorAll(".seg-btn[data-diff]").forEach((b) => {
    b.addEventListener("click", () => {
      audio.click();
      settings.difficulty = b.dataset.diff;
      paintSetup();
    });
  });
  document.getElementById("btn-start").addEventListener("click", () => {
    audio.click();
    startRound();
  });
  window.addEventListener("resize", () => {
    if (state && phase === "playing") {
      renderOppRow();
      renderMe();
    }
  });
}

async function init() {
  bindEvents();
  paintSetup();
  await loadStats();
  showSetup();
}

init();
