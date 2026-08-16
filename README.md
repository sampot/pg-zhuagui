# pg-zhuagui

瀏覽器**抓烏龜**：先丟對子、再從別家盲抽，最後手裡剩下唯一一張烏龜牌的輸家出局。四人（你＋3 AI）童玩桌遊。**mobile-first**，桌面加寬。

也可當作 [Playgrounds（遊樂場）](https://play.samkuo.me/) 的 **SAM**（`index.html` 入口）。

## 一鍵開 SAM 小

```
https://play.samkuo.me/?open=sampot/pg-zhuagui&name=抓烏龜&fresh=1
```

同源會重用本機已匯入的沙盒；要強制新建可加 `&fresh=1`。

## 試玩（本機）

```bash
npx --yes serve .
# 或
python3 -m http.server 8080
```

點一下頁面後音效才會出聲。

## 操作

| 操作 | 說明 |
| --- | --- |
| **點對手的牌背** | 從該家盲抽一張（隨機一張） |
| **來下一局** | 本局結束後，結算分數並繼續 |
| **重開這局** | 進行中重發一輪，本局分數不計 |
| **對局紀錄** | 展開查看每一次抽牌與配對結果 |
| **音效開／關** | 靜音 |

抽到能湊對的牌會立刻丟掉一對；手牌只剩下烏龜牌的人出局，其餘各家 +1 分。

## 規則

- 52 張撲克＋1 張烏龜牌（鬼牌），4 家盡量平分。
- 開局各家先丟「對子」（同數字、不限花色）。
- 輪到你時選一位對手盲抽；若能配對就丟出一對。
- 最後剩下唯一一張牌（烏龜牌）的持有者為輸家；連續勝利次數會用 KV 保存。

## 檔案

| 檔案 | 說明 |
| --- | --- |
| `index.html` | 結構（zh-Hant） |
| `styles.css` | 手機優先／桌面遞增、牌桌視覺 |
| `app.js` | UI、盲抽互動、AI 回合、KV 記錄 |
| `game.js` | 發牌、配對、抽牌順位、勝負（純函式） |
| `audio.js` | Web Audio 合成音效 |
| `game.test.js` | Vitest 規則／流程單元測試 |
| `assets/cards/` | 52 張＋鬼牌＋牌背 PNG（Kenney.nl CC0） |
| `functions.js` | Playgrounds 可選 stub |

## 連續勝利

- **連勝**：連續沒當烏龜的局數，自己拿到烏龜就歸零。
- **最佳**：歷史最高連勝，前端透過 `GET/PUT /api/kv/pg-zhuagui-best` 讀寫；沒有 KV 環境（純本機 serve）時也照玩，只是不跨場保存。

## License

MIT