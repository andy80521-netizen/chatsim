# ChatSim

自用的 AI 角色文字聊天框架，整合 FLAI（AI 角色陪伴）與 Fuwa（文字戀愛模擬）的功能。
React + TypeScript + Vite，資料存 localStorage，LLM 為 Gemini。

## 執行

```bash
npm install
npm run dev
```

首頁「設定」填入 Gemini API Key → 「模板」加入角色（或「角色」自己建）→「對話」按「＋ 新對話」。

## 功能對照

| 來源 | 功能 | 位置 |
| --- | --- | --- |
| FLAI | 自訂角色（暱稱/稱呼/設定/前書） | 角色編輯 |
| FLAI | 角色模板、匯入匯出分享 | 模板分頁、角色分頁 |
| FLAI | 長期記憶 | 自動摘要 + 手動「請記住」 |
| FLAI | 群組對話（多個 AI 同場） | 新對話選 2 個以上角色 |
| FLAI | 語音朗讀 / 語音輸入 / 通話 | 瀏覽器 Web Speech API |
| FLAI | 主動問候 | 設定「隔多久回來主動打招呼」 |
| Fuwa | 分支世界線（回到任一節點重來） | 訊息選單、劇情樹 |
| Fuwa | 每條分支記憶獨立 | 記憶掛在節點上 |
| Fuwa | 好感度、關係階段、狀態列 | 聊天畫面上方 |
| Fuwa | 回憶碎片（好感解鎖） | 角色編輯、側邊面板「狀態」 |
| Fuwa | 內心戲 | 角色編輯勾選 |
| Fuwa | 成就系統 | 設定分頁 |
| Fuwa | 重新生成、編輯訊息、搜尋、記憶編輯、草稿儲存 | 聊天/側邊面板/角色編輯 |
| 額外 | 一句話想法 → AI 產生完整角色卡 | 角色編輯 |

## 沒做的（需要後端或專屬服務）

- 聲音複製、影片生成、真正的背景推播（App 關掉也會傳訊息）
- 跨裝置同步（可之後接 Firebase）

## 檔案結構

- `src/tree.ts`：對話樹（分支、路徑、記憶、好感）
- `src/llm.ts`：prompt 組裝、Gemini 串流、META 解析、摘要、AI 產生角色（換模型只改這個）
- `src/speech.ts`：語音
- `src/achievements.ts`、`src/templates.ts`、`src/characters.ts`
- `src/components/`：Home、Chat、Panel、CharacterEditor、SettingsPanel

## 注意

API Key 存在瀏覽器 localStorage，請求直接從瀏覽器送出，只適合自用。公開部署請改走後端轉送。
