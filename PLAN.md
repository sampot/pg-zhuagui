# 抓烏龜（`pg-zhuagui`）— 遊戲規劃文檔

> **用途：** 本 repo 的遊戲權威規格——coding agent 改動前必讀：這個遊戲是什麼、規則、設計限制、優化方向。
> **整理方式：** 從本 repo 實作反向整理（2026-08-23）。**改玩法先改此檔再改碼**；本檔與程式碼衝突時，以「規則（§3）」描述的設計意圖為準回報差異。
> **上游契約：** [PG-GAME-AGENT-GUIDE.md](https://github.com/sampot/playgrounds/blob/main/docs/PG-GAME-AGENT-GUIDE.md)（唯一必讀；本檔不重複其全文）· 型錄條目 `playgrounds/catalog/entries/pg-zhuagui.yaml`

## 1. 一句話

你＋三名 AI 的抓烏龜（Old Maid）：開局先丟對子、輪流從別家盲抽配對，最後手握唯一烏龜牌（鬼牌）的人輸、其餘各家 +1 分；台灣童玩規則的數位版，非任一商業作品復刻。

## 2. 定案速覽

| 項 | 值 |
| --- | --- |
| catalog id / kind / series | `pg-zhuagui` / `game` / `桌遊` |
| status | `unlisted`（待上架驗收） |
| 模式 | 單局連環制、人數可選 2–4（你＝第 0 家 vs 阿明/小美/大熊 1–3 名 AI）；安裝面板選擇、變更設定可回選 |
| 牌組 | 52 張撲克＋1 張鬼牌＝53 張；同點數跨花色成對，鬼牌永不配對 |
| 勝負 | 每局找出烏龜：非烏龜者 +1 分；你的「連勝」＝連續非烏龜局數；生涯（場次/烏龜數/最佳連勝/對各 AI 成績）存單一 JSON KV key |
| 對手 AI | 三檔難度：easy＝隨機目標；standard＝抽手牌最多者；hard＝計分制（愛抽你＋避開只剩一張的家） |
| 素材 | Kenney Playing Cards Pack PNG（CC0）；音效全 WebAudio 合成 |
| 交付形 | 純 HTML＋CSS＋ESM JS；無 build；`npx --yes vitest run` 測試 |

## 3. 完整規則（現行實作）

### 3.1 發牌與初始去對

- `makeDeck` 產生 52 張（rank 1–13 × 四花色）＋鬼牌 `{rank:0,suit:4}`，洗牌後依 `i % n` 輪發（4 家約 13/13/13/14）。
- 各家立即執行 `removePairs`：同一 rank 有 n 張就丟掉 `n − (n%2)` 張（三張丟二留一、四張全丟），**鬼牌一律保留**。被丟的牌進公開牌堆 `removed`，並寫入對局紀錄。
- 初始去對後總張數必為奇數（53 起、每次 −2），保證終局必然有人拿到烏龜。

### 3.2 回合與盲抽

- 首個動作者＝玩家（第 0 家）的**下一位**有牌者（設計上每局由 AI 先手）；之後 `nextTurn` 從最後抽牌者的下家找第一個有牌者，空手者跳過。
- 輪到你時點任一對手的任一張牌背→從該家**隨機**抽一張（點哪張牌背結果相同，`pick=-1` 走 `Math.random`）；不能自抽、不能向空手家抽。
- 抽到的牌入手後立刻結算：若該 rank 在手中共 n 張，丟掉最大的偶數 `n − (n%2)` 張（例：湊成三條丟二留一）。成對丟出即時顯示於揭示浮層。
- **AI 抽牌全程公開**：誰從誰抽到什麼牌都以揭示卡呈現 1600ms（`REVEAL_MS`）——玩家可據此推理 AI 手牌，這是有意的資訊設計。

### 3.3 終局判定（`checkDone`）

- 全場只剩 1 張牌→持有者是烏龜；0 張→無烏龜（全部配完的罕見平局）。
- 只剩一家有牌→該家是烏龜（奇數張必含鬼牌）；此規則避免「其他家空手、無人可抽」卡死。
- 結算 `tally`：有烏龜時非烏龜各家 +1 分；你是烏龜或無烏龜局都把連勝歸零，否則連勝 +1 並在破紀錄時寫 KV。

### 3.4 AI 行為與節奏

- AI 抽牌對象由 `pickAiDrawTarget(state, ai, level, rand)`（`game.js` 純函式）決定，無合法對象回傳 −1 直接結算：
  - **easy**：有牌對手中均勻隨機。
  - **standard**：手牌最多者（並列取先）。
  - **hard**：計分制——基礎分＝手牌張數、玩家（第 0 家）＋5（優先抽玩家）、只剩 1 張且場上另有 2 張以上家時 −6（避開剛被清到只剩一張的家）；最高分並列以隨機決定。
- 難度在安裝面板選（`settings.difficulty`），「來下一局」沿用、「變更設定」可換。
- 節奏常數：發牌停留 900ms；AI 每步延遲 650ms；揭示卡 1600ms 後自動收起。回合令牌（`roundToken`）作廢重開後殘留的排程。

## 4. 操作與畫面

| 輸入 | 動作 |
| --- | --- |
| 安裝面板「人數／難度」＋「開始發牌」 | 開局前選 2–4 人與 easy/standard/hard，開始本局 |
| 點對手的牌背 | 盲抽一張（隨機） |
| 來下一局 | 結算面板內開新一局（分數累計，沿用人數與難度） |
| 變更設定 | 結算面板回安裝面板（分數與戰績保留） |
| 重開這局 | 進行中重發（該局分數不計） |
| 對局紀錄 | 展開最近 14 筆抽牌/事件 |
| 👁 追蹤開／關 | 切換各家牌背下「曾被抽走」徽章（不持久化） |
| 音效開／關 | 靜音切換（持久化於戰績 JSON） |

- 版面：上方比分徽章＋連勝/最佳/場次/烏龜；中央各家的手牌攤開亮牌、AI 全牌背扇形疊放並標張數、開追蹤後 AI 下方秀最近 3 張被抽走牌的小徽章；左側公開牌堆顯示最近 8 張；抽牌結果以置中揭示卡演出（翻面飛入；成對時雙卡並列）。
- 結算面板：烏龜宣告＋該牌大圖＋各家 +1 明細＋連勝/生涯摘要（場次・烏龜數・對各 AI 成績）＋「來下一局」（自動聚焦）＋「變更設定」。
- Mobile-first 單欄、桌面 grid 遞增；狀態列帶 tone；禁 `alert`/`confirm`/`prompt`。

## 5. 持久化（KV 權威）

| key | 內容 | 讀寫時機 |
| --- | --- | --- |
| `pg-zhuagui-stats`（`/api/kv`） | 單一 JSON：`{best, games, turtles, muted, ai:[{games,turtles}×3]}`（ai[i]＝第 i+1 家 AI 的對戰局數/中烏龜次數；`parseStats` 嚴格驗證、缺角補零） | 啟動 GET（無效回退 emptyStats）；每局結算 PUT；靜音切換立即 PUT |
| `pg-zhuagui-best`（legacy） | 舊版純數字最佳連勝 | 僅啟動時、新 key 尚無資料時 GET 一次性遷移進 `best`，之後不再寫入 |
| （無）localStorage | — | 本 repo 完全未用 localStorage |

- 自訂 functions.js：空 stub（`export default {}`），無自訂 API；KV 由前端直接 fetch。跨局分數陣列僅存記憶體；人數/難度設定僅存記憶體。

## 6. 美術／音效／署名

- `assets/cards/`：Kenney Playing Cards Pack（Kenney Vleugels，CC0）52 張＋鬼牌（以紅鬼牌圖充任烏龜牌）＋card_back，64×64 PNG；授權副本 `assets/cards/Kenney-PlayingCards-License.txt`，詳 `ATTRIBUTION.md`（CC0 也照專案慣例署名）。
- 音效全部 WebAudio 合成（`audio.js`，master 0.22）：click/draw/match（523→784 上揚）/noMatch/deal/shout/win/turtle（下行四音）/error；首次互動 `unlock()` 解鎖 AudioContext，無第三方取樣。
- 新增素材規則：拷進 `assets/`、更新 `ATTRIBUTION.md`、同步 `sam-manifest.json` files 清單。

## 7. 測試（`npx --yes vitest run`）

現有覆蓋（`game.test.js`，37 例）：牌組 53 張且四花色 1–13 齊全；shuffle 保張數保唯一；isPair 跨花色成對/鬼牌永不配對；removePairs 的偶數丟棄規則（一對/四張/三條丟二留一/鬼牌保留）；newRound 全 53 張守恆、turn 起始、各家餘牌皆無對、2 人發牌守恆與人數夾限 2–4；drawCard 流程（移牌、成對即丟、三條補完成丟二留一、拒絕自抽）；checkDone 兩種終局（單張／單一持牌家）與 nextTurn 跳過空手；tally 非烏龜 +1；cardText 點數花色文案；pickAiDrawTarget 三難度（easy 隨機分佈／standard 最多牌／hard 玩家偏好、避開準空手、並列隨機、無目標 −1）；stats 助手（emptyStats 形狀、parseStats 驗證與補齊、applyRoundStats 場次/烏龜/對各 AI 計數、無烏龜局只計場次）；drawnFromHistory 取曾被抽走牌（舊→新、上限、無記錄回空）。

改動規則/AI 必補對應邊界測試；`app.js` DOM 不在測試範圍。

## 8. 硬約束（不可違反）

1. 僅 HTML＋CSS＋JS（ESM）；**無 build**、不入庫 `node_modules`、不安套件；工具一律 `npx <pkg>` 臨時執行。
2. 禁瀏覽器原生 `alert`／`confirm`／`prompt`；提示一律狀態列與頁內面板。
3. Mobile-first；主操作不可 hover-only。
4. 分數/進度以 `fetch('/api/kv/…')` 為權威；禁止裸 `localStorage` 當權威（本作現完全未用）。
5. 不自行載入 `sdk.js`；宿主注入 `window.PG`（本作未用 PG，直接 fetch `/api/kv`）。
6. 改動可執行邏輯前先寫失敗測試（TDD）。
7. 檔案清單變動須同步 `sam-manifest.json`（下載契約，含全套牌 PNG）。
8. 核心不變量不得破壞：53 張守恆、鬼牌永不離場也不配對、去對只丟偶數張、終局奇數性（烏龜必有主或全配完）、AI 抽牌資訊公開。

## 9. 優化建議（可玩性與樂趣）

依優先級；實作前先在此登記並補測試。原則：強化推理與記憶樂趣、拉長目標線，不改變「盲抽配對躲烏龜」的核心認同。

**高優先**

1. ✅ **難度分段**：已實作 `pickAiDrawTarget(state, ai, level, rand)`（`game.js`；easy 隨機／standard 最多牌／hard 計分制），UI 安裝面板可選，測試 6 例。
2. ✅ **人數 2–4 選擇**：已實作安裝面板人數選擇（`settings.playerCount`→`newRound`），渲染全依 `state.playerCount`，補 2 人守恆／夾限測試。
3. ✅ **戰績持久化升級**：已改單一 JSON key `pg-zhuagui-stats`（`emptyStats`/`parseStats`/`applyRoundStats` 純函式＋測試），結算面板秀生涯摘要與對各 AI 成績；舊 `pg-zhuagui-best` 一次性遷移。

**中優先**

4. ✅ **盲抽手感**：已補揭示卡翻面飛入動畫（`card-flip`）；成對時抽出牌與配對手牌並列、Partner 卡第二波翻入（`card-flip-pair`）；尊重 `prefers-reduced-motion`。
5. ✅ **記憶輔助**：AI 各家下方「曾被抽走」小徽章（`drawnFromHistory`＋測試），👁 追蹤鈕可開關（預設開，僅存記憶體）。
6. ✅ **音效偏好持久化**：靜音狀態存進 `pg-zhuagui-stats.muted`，切換立即 PUT、啟動時套用。

**低優先**

7. ⬜ **牌面清晰度**：未動——64×64 的 Kenney PNG 在手機放大偏糊；評估改用向量繪製牌面或取得 2× 資產（需外部素材授權，尚無 2× 來源）。
8. ⬜ **變體規則**：未動——「雙烏龜（兩張鬼牌）」會破壞 §8.8 奇數守恆核心不變量，需重新設計終局判定才可列入；「烏龜免死金牌（持有者可再抽一次）」屬回合規則變動，實作前須先補測試再改碼。
