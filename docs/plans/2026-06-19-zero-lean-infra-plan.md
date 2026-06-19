I'll write the report directly. I have all the audit findings needed.

# Zero/0.email 個人自託管精簡基礎設施計畫

## 1. 一句話結論

原始設定共 **28 個 bindings**（4 Queue 相關 + 9 KV + 1 R2 + 2 Vectorize + 8 DO + 2 Workflow + 1 Workers AI + ZERO_DB），精簡到「最小可跑」只需 **6 個核心 bindings**（D1 + R2 + 1 個必留 KV + 4 個核心 DO），其餘 22 個全部可丟或延後 — 而且全部三個 Queue 都丟掉就能**留在 Cloudflare 免費方案**。

---

## 2. 精簡後要建的資源清單（Personal 帳號）

> 以「最小可跑、單人 IMAP」為目標。AI 搜尋 / snooze / 排程寄信全部延後。

### D1（資料庫）
- ✅ `zero-personal`（`efecb00b-be55-444e-b338-b05336eba10e`）— **已建好**，唯一必要資料庫。

### R2（信件本文 blob 儲存）
- `THREADS_BUCKET` — **必建**。D1 只存 thread metadata，信件本文只存在 R2，IMAP 同步寫入路徑硬依賴它。

### KV（必留最小集）
- `gmail_processing_threads` — **必留**（名字誤導）。它同時是 `listThreads` 的 resync-cooldown（`src/trpc/routes/mail.ts:172/177`），IMAP 路徑會用到且**未被任何 flag 擋住**，移除會 throw。

### Durable Objects（核心四＋一，全部必建）
- `ZERO_DB` — 所有 user/connection/settings CRUD（`src/main.ts:206`）。
- `ZERO_DRIVER` — 每連線信箱 shard，掛載 IMAP driver（`src/routes/agent/index.ts:322`）。
- `SHARD_REGISTRY` — shard 查找，`getZeroAgent()` 每次請求都讀（`src/lib/server-utils.ts:40`）。
- `THREAD_SYNC_WORKER` — driver.get + 寫 R2 的同步原語，請求路徑會用（`src/routes/agent/sync-worker.ts:9`）。
- `ZERO_AGENT` — WebSocket 即時廣播（同步進度、新信），`ZeroDriver.setupAuth` 一定會抓它（`src/lib/server-utils.ts:543`）。**即使不要 AI 聊天，binding 也必須留**。

### Queue
- **無**（全部丟掉 → 留在免費方案）。

### Vectorize
- **無**（延後，屬 AI 語意搜尋）。

### Workflow
- **無**（延後，scale-out 批次回填）。

### Workers AI
- **無**（延後，需先 gate 所有 `env.AI.run` 呼叫點）。

---

## 3. 可以丟掉的東西

| binding | 類型 | 原因 | 拆除難度 |
|---|---|---|---|
| `gmail_history_id` (KV) | Gmail 專用 | Gmail 增量同步 cursor，只在 WorkflowRunner 內被碰，已被 `DISABLE_WORKFLOWS='true'` + `providerId===google` 雙重擋住 | 易（IMAP 路徑完全不碰，直接刪） |
| `gmail_sub_age` (KV) | Gmail 專用 | Gmail watch 續訂計時器；但 cron `processExpiredSubscriptions` 在 key 缺失時會**錯誤地對每個 IMAP 帳號排程續訂** | 中（須先移除 `main.ts:1231-1257` 區塊） |
| `subscribed_accounts` (KV) | 選用（AI brain 訂閱） | brain 自動標籤訂閱狀態；`getState`/`enableBrain` 是 provider-agnostic 未被 flag 擋 | 中（須先 guard `brain.ts:54-58`、`utils.ts:32-44`） |
| `connection_labels` (KV) | 選用（AI 標籤） | AI 自動分類標籤集，workflow 已自動 fallback 到內建 defaults | 中（guard `brain.ts:60-78`） |
| `prompts_storage` (KV) | 選用（AI prompt 編輯） | 使用者覆寫的 AI system prompts，自帶 fallback | 中（改 `brain.ts:30-37`、`pipelines.effect.ts:85-90` 直接回 fallback） |
| `snoozed_emails` (KV) | 選用（snooze UX） | thread snooze 功能，provider-agnostic 但非必要 | 中（guard `mail.ts:139/157/764/788`、`main.ts:1191-1218`） |
| `pending_emails_status` (KV) | 選用（排程/收回寄信） | send-later 生命週期狀態 | 中（與下兩個綁一起拆） |
| `pending_emails_payload` (KV) | 選用（排程寄信） | 延遲寄信的 payload 暫存 | 中（同上 trio） |
| `scheduled_emails` (KV) | 選用（長期排程寄信） | >12h 的長期排程，cron 驅動 | 中（須移 `main.ts:1119-1171` processScheduledEmails） |
| `thread_queue` (Queue) | Gmail 專用 + **付費** | Gmail Pub/Sub push 通知佇列，已被 `DISABLE_WORKFLOWS` 擋住 | 易（producer 在 `main.ts:921`，已 early-return） |
| `subscribe_queue` (Queue) | Gmail 專用 + **付費** | Gmail watch 訂閱管理；IMAP 用 polling 不需要 | 中（3 個 producer 要先 guard：`auth.ts:154`、`brain.ts:19`、`main.ts:1254`） |
| `send_email_queue` (Queue) | 選用 + **付費** | 排程寄信 + 收回寄信（非 Gmail 專用，但需付費方案） | 中（與 send-later trio 一起拆，force inline send） |
| `VECTORIZE` (Vectorize) | 選用（AI 摘要/語意搜尋） | 每 thread 一個 embedding；寫入全在 workflow（被 `DISABLE_WORKFLOWS` 擋），但讀取點未擋 | 中（guard `brain.ts:39`、`chat.ts:1345`、`mcp.ts:87`、`tools.ts:135`） |
| `VECTORIZE_MESSAGE` (Vectorize) | 選用（AI 訊息摘要） | 每 message 一個 embedding，**無 workflow 外的 consumer** | 易（`DISABLE_WORKFLOWS` 一擋就全死，直接刪） |
| `WORKFLOW_RUNNER` (DO) | Gmail 專用 | Gmail Pub/Sub 攝取 pipeline，唯一 feeder 已被 `DISABLE_WORKFLOWS` 擋 | 易（guard `main.ts:1068-1108` thread-queue case；保留 migration tag） |
| `SYNC_THREADS_COORDINATOR_WORKFLOW` (Workflow) | 選用（批次回填） | scale-out 分頁批次同步，inline syncThreads 已覆蓋小信箱 | 中（neutralize `index.ts:1669` triggerSyncWorkflow） |
| `SYNC_THREADS_WORKFLOW` (Workflow) | 選用（批次回填） | coordinator 的子 worker，唯一 caller 是 coordinator | 易（與 coordinator 成對拆） |
| `ZERO_MCP` (DO) | 選用（MCP 整合） | 對外曝露信箱給 MCP/AI client，不在收信路徑 | 中（移 `main.ts:797/828` mount；保留 migration） |
| `THINKING_MCP` (DO) | 選用（AI 工具） | sequential-thinking MCP，與 IMAP 無關 | 易（移 `main.ts:804` mount；保留 migration） |
| `AI` (Workers AI) | 選用（所有 AI 功能） | 摘要/embedding/標籤；`env.AI.run` 呼叫點**未被 flag 擋** | 難（須 gate 每個 `AI.run` 點，與 Vectorize 成組拆） |

---

## 4. 拆除步驟（按順序）

> 鐵律：**先改程式碼 guard → 再從 `src/env.ts` 移欄位 → 最後刪 `wrangler.jsonc` 三個 env 區塊的 binding → 部署**。Bindings 是 eager access，順序顛倒會在 runtime throw `undefined is not an object`。

### 階段 0 — 設定 flag（前置，零風險）
- [ ] 確認 `wrangler.jsonc` vars 內 `DISABLE_WORKFLOWS='true'`（local + production 已是）。這一個 flag 就讓整條 Gmail push pipeline、`gmail_history_id`、`gmail_processing_threads` 的 lock、兩個 Vectorize 的寫入全部變成 dead path（`src/main.ts:892` early-return）。

### 階段 1 — 程式碼 guard（先做，否則後面刪 binding 會 throw）
**Gmail / Queue 路徑：**
- [ ] `src/main.ts:1068-1108` — thread-queue consumer case：包 `if(env.DISABLE_WORKFLOWS!=='true')` 或刪除，避免解參考 `env.WORKFLOW_RUNNER`。
- [ ] `src/main.ts:1231-1257` — `processExpiredSubscriptions` 的 Google 續訂區塊：刪除 `gmail_sub_age.get`(:1233) 與 `subscribe_queue.send`(:1254)，或整個 `processExpiredSubscriptions()` 從 `scheduled()`（`main.ts:1116`）拿掉。
- [ ] `src/trpc/routes/brain.ts:19` — `enableBrain` 內的 `subscribe_queue.send`：改 no-op / return true。
- [ ] `src/lib/auth.ts:154` — 已自帶 `GOOGLE_S_ACCOUNT` 守門，保持 `GOOGLE_S_ACCOUNT` 未設即可。

**Send-later trio + send_email_queue（一起拆）：**
- [ ] `src/trpc/routes/mail.ts:~493-597` — 移除 `if(scheduleAt||isLongTerm)` 排程分支（含 statusKV/payloadKV/scheduledKV 寫入），強制走 inline send。
- [ ] `src/trpc/routes/mail.ts:619-664` — 移除 unsend mutation。
- [ ] `src/main.ts:999-1067` — 刪 send-email-queue consumer case。
- [ ] `src/main.ts:1119-1171` — 刪 `processScheduledEmails` 及其在 `main.ts:1114` 的呼叫。

**AI brain 群（選用，要丟才做）：**
- [ ] `src/trpc/routes/brain.ts:54-58` — `getState` 改回 `{enabled:false}`，不碰 `subscribed_accounts`。
- [ ] `src/trpc/routes/brain.ts:60-78` — `getLabels` 改回 `defaultLabels`，不碰 `connection_labels`。
- [ ] `src/trpc/routes/brain.ts:30-37` / `pipelines.effect.ts:85-90` — `getPrompt` 直接回 fallback，不碰 `prompts_storage`。
- [ ] `src/lib/utils.ts:32-44` — `setSubscribedState`/`cleanupOnFailure` no-op。

**Vectorize 讀取點（要丟才做）：**
- [ ] guard `src/trpc/routes/brain.ts:39`、`src/routes/chat.ts:1345`、`src/routes/agent/mcp.ts:87`、`src/routes/agent/tools.ts:135` 的 `env.VECTORIZE.getByIds(...)` → binding 不存在時回 null/空。

**Snooze（選用，要丟才做）：**
- [ ] guard/移除 `src/trpc/routes/mail.ts:764/788/139/157`、`src/main.ts:1191-1218`、`src/routes/agent/index.ts:1465-1483`。

**Workflow / MCP mount（選用）：**
- [ ] `src/routes/agent/index.ts:1669` — `triggerSyncWorkflow` 改 no-op（或讓 `syncFolders` 直接呼 `this.syncThreads('inbox')`）。
- [ ] `src/main.ts:797/828` 移除 `/mcp`、`/sse` mount；`src/main.ts:804` 移除 `/mcp/thinking/sse` mount。
- [ ] AI binding 要丟：先 gate 所有 `env.AI.run`（`brain.ts:43`、`chat.ts:1348`、`tools.ts:27/149`、`mcp.ts:101`、`pipelines.effect.ts:109`、`workflow-functions.ts:246/500/670/687`）。

### 階段 2 — 移除 type 欄位
- [ ] `src/env.ts` 刪：`gmail_history_id`(:28)、`gmail_sub_age`(:25)、`subscribed_accounts`(:30)、`connection_labels`(:31)、`prompts_storage`(:32)、`snoozed_emails`(:24)、`pending_emails_status`(:20)、`pending_emails_payload`(:21)、`scheduled_emails`(:22)、`thread_queue`(:92)、`subscribe_queue`(:26)、`send_email_queue`(:23)、`VECTORIZE`(:93)、`VECTORIZE_MESSAGE`(:94)、`WORKFLOW_RUNNER`(:14)、`SYNC_THREADS_*`(:17/:18)、`ZERO_MCP`(:12)、`THINKING_MCP`(:13)、`AI`(:27)。
- [ ] `worker-configuration.d.ts` 同步刪對應的 generated type（:8/:9/:11/:12/:13/:14/:19/:20/:21 等）。

### 階段 3 — 刪 `wrangler.jsonc` binding（每個都在三個 env 區塊各一份，全刪）
- [ ] KV：刪上述 8 個 KV 的 `kv_namespaces` 條目（dev ~188/192…、staging ~409…、prod ~627… 區段）。**保留 `gmail_processing_threads`**。
- [ ] Queue：刪 `thread-queue`/`subscribe-queue`/`send-email-queue` 的 producer + consumer 條目（dev ~86-108、staging ~313-334、prod ~541-562）。
- [ ] Vectorize：刪 `VECTORIZE`(~21/245/472)、`VECTORIZE_MESSAGE`(~25/249/476)。
- [ ] DO bindings：從 `durable_objects.bindings` 刪 `WORKFLOW_RUNNER`、`ZERO_MCP`、`THINKING_MCP`。
- [ ] Workflows：刪 `SYNC_THREADS_COORDINATOR_WORKFLOW`、`SYNC_THREADS_WORKFLOW`（`workflows[]`，無 migration 牽連，最乾淨）。
- [ ] AI：刪 `"ai": { "binding": "AI" }`（三 env）。

### ⚠️ 風險警告 — DO migration
- DO（`WORKFLOW_RUNNER`、`ZERO_MCP`、`THINKING_MCP`）有 `new_sqlite_classes` migration tags（v2–v10）。**只刪 `durable_objects.bindings` 條目，不要去動或重寫歷史 migration tag**。全新部署刪掉一個由 migration 建立、但沒有對應 `deleted_classes` migration 的 class 是 OK 的；但對既有部署不要改 migration 歷史。
- Workflows 沒有 migration 條目，刪除最安全。
- `SHARD_REGISTRY` 雖然是 scale-out 機制，但 `getZeroAgent()` 每次請求都讀它定位 shard → **不可刪**，除非重寫 `getShardClient/getActiveShardId`（高風險，不建議）。

### 階段 4 — 部署
- [ ] `wrangler deploy`（用 wrangler skill 確認語法）。確認 boot 無 binding 缺失錯誤，連一個 IMAP 信箱、開 INBOX、開一封信驗證本文有出現（驗證 R2 寫讀正常）。

---

## 5. 成本 / 方案影響

| 資源 | 免費方案 | 影響 |
|---|---|---|
| **Cloudflare Queues** | ❌ 需付費 Workers 方案 | **這是留在免費方案的關鍵**。丟掉全部 3 個 Queue（thread/subscribe/send_email）即可免付費。代價：失去排程寄信 + 收回寄信。 |
| **Durable Objects** | ⚠️ 需 Workers Paid（DO 不在免費方案） | 核心 5 個 DO 無法避免 → 若要用本專案，**DO 本身就需要付費 Workers 方案（$5/月起）**。這點無法靠精簡規避，因為信箱骨幹全建在 DO 上。 |
| **R2** | ✅ 有免費額度（10GB 儲存 / 月） | 單人信箱遠在免費額度內。必留。 |
| **Vectorize** | ✅ 有免費額度 | 丟掉省去 embedding 寫入成本與 Workers AI 用量；延後即可。 |
| **Workers AI** | ✅ 有免費額度（每日 neuron 配額） | 丟掉避免 AI.run 用量；延後即可。 |
| **D1** | ✅ 免費額度充足 | 已建好。 |
| **KV** | ✅ 免費額度充足 | 只留 1 個。 |

> **結論**：Queue 丟掉 → 不必為了 Queue 升級。但 **DO 本身要求 Workers Paid 方案**，這是本專案架構的硬下限；精簡無法把它降到純免費 plan，只能把「額外付費觸發點（Queues）」消掉，把用量壓到最低。

---

## 6. 建議的最小可跑里程碑

**M0 — 開機並同步一個 IMAP 信箱（最小集）**

只 provision 這 6 個，其餘全部丟 / 延後：

1. ✅ D1 `zero-personal`（已完成）
2. R2 `THREADS_BUCKET`
3. KV `gmail_processing_threads`（唯一必留 KV）
4. DO `ZERO_DB`
5. DO `ZERO_DRIVER`
6. DO `SHARD_REGISTRY`
7. DO `THREAD_SYNC_WORKER`
8. DO `ZERO_AGENT`

（DO 算 5 個 + D1/R2/KV 各 1 = 8 條 binding；對比原始 28 條。）

**M0 必做的 code guard**（只要這些，先不碰 AI/snooze/排程）：
- `DISABLE_WORKFLOWS='true'`（讓 Gmail pipeline + 兩個 Vectorize 全死）。
- guard `main.ts:1068-1108`（thread-queue case）、`main.ts:1231-1257`（cron 續訂誤觸發）。
- `triggerSyncWorkflow`（`index.ts:1669`）改 no-op，改用 inline `syncThreads` 同步 INBOX。
- 移除 send-later 分支（`mail.ts:~493-597`）與其 consumer/cron，才能丟 `send_email_queue` 三 Queue。
- 移除 `/mcp`、`/sse`、`/mcp/thinking/sse` mount。

**M0 驗收**：worker boot 成功 → 連一個 IMAP 帳號 → INBOX 同步 → 開信看到本文（R2 讀寫 OK）→ WebSocket 即時更新有動（ZERO_AGENT OK）。

**之後可選的增量里程碑（延後，不影響 M0）：**
- **M1 — AI 摘要 / 語意搜尋**：加回 `AI` + `VECTORIZE`(+`VECTORIZE_MESSAGE`)，解開 brain/chat/tools/mcp 的讀取 guard。需 Workers AI 用量。
- **M2 — Snooze**：加回 `snoozed_emails`，恢復 `mail.ts`/cron guard。
- **M3 — 排程 / 收回寄信**：需升級付費方案，加回 `send_email_queue` + `pending_emails_status/payload` + `scheduled_emails` 三件套與其 cron。
- **M4 — 批次回填大信箱**：加回 `SYNC_THREADS_COORDINATOR_WORKFLOW` + `SYNC_THREADS_WORKFLOW`，恢復 `triggerSyncWorkflow`。
- **M5 — MCP 對外整合**：加回 `ZERO_MCP` / `THINKING_MCP` 與 mount。

> Gmail-only 的 `gmail_history_id`、`gmail_sub_age`、`thread_queue`、`subscribe_queue`、`WORKFLOW_RUNNER` 因為走 generic IMAP/SMTP，**永遠不需要加回來**。