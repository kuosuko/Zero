# Zero Email: Cloudflare Dependency Map & Cost Analysis

Generated: 2026-05-04

---

## 1. Complete Cloudflare Service Dependency Map

### Core Worker
| Service | Binding | Purpose |
|---------|---------|---------|
| **Workers** | `zero-server` | Main Hono HTTP server, queue consumer, cron handler |
| **Workers** | `zero` (mail app) | Frontend SPA hosting (Cloudflare Pages/Workers Assets) |

### Durable Objects (8 classes)
| Class | Type | ID Strategy | Purpose |
|-------|------|-------------|---------|
| `ZeroAgent` | SQLite-backed (v2/v4) | `idFromName(connectionId)` | Per-connection email agent. Holds thread data, handles WebSocket real-time chat, thread syncing, AI chat agent |
| `ZeroMCP` | SQLite-backed (v2) | `idFromName(connectionId)` | MCP (Model Context Protocol) server per connection. Exposes email tools to AI |
| `ZeroDB` | KV-backed (v3) | `idFromName(userId)` | Per-user PG database proxy. Wraps Hyperdrive PG queries for users, connections, notes, settings, templates, writing style matrix |
| `ZeroDriver` | SQLite-backed (v5) | Per-shard | Email driver (Google/Microsoft). Uses Transfer/Sharding for large mailboxes (>8GB shards) |
| `ThinkingMCP` | SQLite-backed (v6) | Unique ID | Sequential thinking MCP server for AI reasoning |
| `WorkflowRunner` | SQLite-backed (v7) | `newUniqueId()` (ephemeral) | Runs thread processing workflows per queue message |
| `ThreadSyncWorker` | SQLite-backed (v8) | `newUniqueId()` (ephemeral) | Syncs individual threads from provider to R2 |
| `ShardRegistry` | SQLite-backed (v9) | Per-connection | Tracks which shards hold which data for a connection |

### KV Namespaces (10)
| Binding | Purpose |
|---------|---------|
| `gmail_history_id` | Stores Gmail push notification history IDs per subscription |
| `gmail_processing_threads` | Tracks in-flight Gmail thread processing to avoid duplicates |
| `subscribed_accounts` | Tracks active pub/sub subscriptions for Gmail notifications |
| `connection_labels` | Caches Gmail labels per connection |
| `prompts_storage` | Stores AI prompt templates |
| `gmail_sub_age` | Tracks when Gmail subscriptions were last renewed (expires after 5 days) |
| `pending_emails_status` | Status of pending/scheduled emails (pending/cancelled) |
| `pending_emails_payload` | Payload data for scheduled emails |
| `scheduled_emails` | Scheduled email queue (sendAt + metadata) |
| `snoozed_emails` | Snoozed email metadata with wakeAt timestamps |

### R2 Buckets (1 bucket, 1 binding)
| Binding | Bucket | Purpose |
|---------|--------|---------|
| `THREADS_BUCKET` | `threads` / `threads-staging` | Stores full email thread JSON blobs (messages, headers, attachments metadata). ~1-50KB per thread. |

### Queues (3)
| Queue | Purpose |
|-------|---------|
| `thread-queue` | Processes Gmail push notifications (historyId -> sync threads) |
| `subscribe-queue` | Renews/creates Gmail pub/sub subscriptions + enables brain function |
| `send-email-queue` | Sends scheduled/draft emails with delay support |

### Workflows (2)
| Workflow | Purpose |
|----------|---------|
| `SyncThreadsWorkflow` | Per-thread sync workflow: fetch from provider, process, store |
| `SyncThreadsCoordinatorWorkflow` | Coordinates batch thread syncing |

### Vectorize Indexes (2)
| Binding | Index | Purpose |
|---------|-------|---------|
| `VECTORIZE` | `threads-vector` | Thread-level vector embeddings for semantic search |
| `VECTORIZE_MESSAGE` | `messages-vector-staging` | Message-level vector embeddings |

### Workers AI (1 binding)
| Binding | Models Used | Purpose |
|---------|-------------|---------|
| `AI` | `@cf/baai/bge-large-en-v1.5` (embeddings) | Generate embeddings for Vectorize upserts |
| | `@cf/meta/llama-4-scout-17b-16e-instruct` | Thread summarization, label classification, category detection |
| | `@cf/facebook/bart-large-cnn` | Summarization/condensation of thread summaries |

### Hyperdrive (1 binding)
| Binding | Purpose |
|---------|---------|
| `HYPERDRIVE` | PG connection proxy. Used by `ZeroDB` DO for all user data (auth, connections, notes, settings, templates, writing style). The actual database is external PostgreSQL. |

### Cron Triggers (2)
| Schedule | Purpose |
|----------|---------|
| `0 0 * * *` (daily) | Process scheduled emails + renew expired Gmail subscriptions |
| `0 * * * *` (hourly) | Same: scheduled emails + subscription renewal |

### Other External Services (not CF)
| Service | Purpose |
|---------|---------|
| PostgreSQL (via Hyperdrive) | Primary database: users, sessions, connections, notes, settings, threads metadata |
| Google OAuth / Gmail API | Email provider |
| Microsoft OAuth | Email provider |
| OpenAI API | Primary AI for chat/reply (via `openai` SDK) |
| Anthropic API | Secondary AI (via `anthropic` SDK) |
| Groq API | Fast inference (via `groq` SDK) |
| Resend | Transactional emails |
| ElevenLabs | Voice calls |
| Twilio | SMS/Voice |
| Autumn | Billing/subscription management |
| Composio/Arcade | Third-party integrations |
| Sentry | Error tracking (via proxy) |
| Axiom | Observability/traces |

---

## 2. Critical vs Nice-to-Have

### CRITICAL (app breaks without them)
| Service | Why Critical |
|---------|-------------|
| **Workers** | Core runtime. Everything runs on it. |
| **Durable Objects (all 8)** | ZeroAgent, ZeroDriver, ZeroDB, ShardRegistry, ThreadSyncWorker, WorkflowRunner are the core app. ZeroMCP and ThinkingMCP are the AI layer. |
| **Hyperdrive + PostgreSQL** | ALL user data (auth, connections, notes, settings, threads metadata) lives in PG. ZeroDB DO proxies to it. |
| **R2** | Full email thread content is stored here. Without it, no email data. |
| **Queues (all 3)** | Gmail push notification pipeline, email sending, subscription management. Core email flow. |
| **KV (10 namespaces)** | Gmail subscription tracking, scheduled/snoozed email state, processing dedup. Core email operations. |

### IMPORTANT but somewhat replaceable
| Service | Notes |
|---------|-------|
| **Vectorize (2 indexes)** | Used for semantic search over threads/messages. Could be replaced with PG `pgvector`. Currently stores embeddings from CF AI. |
| **Workers AI** | Used for embeddings + summarization + labels. The AI chat uses OpenAI/Anthropic/Groq externally. CF AI is used for pipeline processing (summaries, embeddings). Could route to external APIs. |
| **Workflows (2)** | Used for thread syncing orchestration. Could be replaced with queue-based orchestration (already partially is via queues). |

### NICE-TO-HAVE
| Service | Notes |
|---------|-------|
| **Cron Triggers** | Used for scheduled emails + subscription renewal. Could be replaced with external scheduler or PG-based cron. |

---

## 3. Can Any Services Be Replaced with PG-Based Alternatives?

### Already PG-backed (via Hyperdrive):
- **ZeroDB DO**: Already proxies to PostgreSQL via Hyperdrive. This is a weird pattern -- a DO that just wraps PG calls. It exists for RPC convenience.

### Could migrate to PG:

| Service | Feasibility | Effort |
|---------|-------------|--------|
| **All 10 KV namespaces** | HIGH. KV is used as a cache/queue, not a primary store. Could use PG tables. | Medium -- need to replace KV API calls with PG queries. KV list operations are the trickiest. |
| **Vectorize (2 indexes)** | HIGH. PG has `pgvector`. Already have PG in the stack. | Low -- just use `pgvector` extension, same embedding model. |
| **R2 (thread content)** | MEDIUM. Could store thread JSON in PG `jsonb` columns. | High -- threads can be large (many messages). PG storage costs would be higher than R2. |
| **ZeroDB DO** | The DO itself could be eliminated; route PG calls directly via Hyperdrive from the Worker. | Medium -- would need to refactor all RPC calls. |
| **Workflows** | MEDIUM. PG-based state machines with queue consumers. | High -- Workflows provide durability guarantees. |

### Should NOT migrate to PG:
| Service | Why |
|---------|-----|
| **ZeroAgent DO** | Per-connection WebSocket host with SQLite state. PG can't replace the real-time DO model. |
| **ZeroDriver DO** | Per-shard email driver with SQLite. Core architecture. |
| **ShardRegistry DO** | Manages sharding state. Tightly coupled to DO architecture. |
| **ZeroMCP DO** | MCP protocol server. Needs DO's persistent connection model. |
| **Queues** | Queues are the async backbone. PG-based queues exist but CF Queues are tightly integrated. |

---

## 4. Cost Projections

### Cloudflare Workers Paid Plan: $5/month base

Assumptions per user scale:
- Each user has ~1-2 email connections
- Average 50 emails/day received, 10 sent
- Thread sync: ~50 threads/day, each thread ~10KB in R2
- AI operations: ~5 summaries/day, 5 embeddings/day per user
- KV operations: ~200 reads/day, ~20 writes/day per user
- DO requests: ~200/day per user (Agent + Driver + DB calls)
- Queue operations: ~100/day per user
- PG queries: ~500/day per user (via Hyperdrive)

### 1 User / Month

| Service | Usage | Cost |
|---------|-------|------|
| Workers subscription | Base | $5.00 |
| Worker requests | ~15K/mo | $0 (within 10M free) |
| CPU time | ~105K ms | $0 (within 30M free) |
| **Durable Objects - requests** | ~6K/mo | $0 (within 1M free) |
| **Durable Objects - duration** | ~2 GB-s | $0 (within 400K GB-s free) |
| **Durable Objects - SQLite reads** | ~15K/mo | $0 (within 25B free) |
| **Durable Objects - SQLite writes** | ~3K/mo | $0 (within 50M free) |
| **KV reads** | ~6K/mo | $0 (within 10M free) |
| **KV writes** | ~600/mo | $0 (within 1M free) |
| **R2 storage** | ~15 MB | $0 (within 10GB free) |
| **R2 Class A ops** | ~1.5K/mo | $0 (within 1M free) |
| **R2 Class B ops** | ~3K/mo | $0 (within 10M free) |
| **Queues operations** | ~9K/mo | $0 (within 1M free) |
| **Vectorize queried dims** | ~150K dims | $0 (within 50M free) |
| **Workers AI - embeddings** | ~150 embeddings | ~$0.01 |
| **Workers AI - llama-4-scout** | ~5K tokens/day | ~$0.30/mo |
| **Workers AI - bart-large-cnn** | ~50 summaries | ~$0.05 |
| **Hyperdrive** | ~15K queries | $0 (unlimited on paid) |
| **TOTAL** | | **~$5.36/mo** |

### 10 Users / Month

| Service | Usage | Cost |
|---------|-------|------|
| Workers subscription | Base | $5.00 |
| Worker requests | ~150K/mo | $0 (within 10M) |
| CPU time | ~1.05M ms | $0 (within 30M) |
| **DO requests** | ~60K/mo | $0 (within 1M) |
| **DO duration** | ~20 GB-s | $0 (within 400K) |
| **DO SQLite reads** | ~150K/mo | $0 (within 25B) |
| **DO SQLite writes** | ~30K/mo | $0 (within 50M) |
| **KV reads** | ~60K/mo | $0 |
| **KV writes** | ~6K/mo | $0 |
| **R2 storage** | ~150 MB | $0 |
| **R2 ops** | ~30K A / 30K B | $0 |
| **Queues** | ~90K ops | $0 |
| **Vectorize** | ~1.5M dims queried | $0 |
| **Workers AI** | 10x above | ~$3.60 |
| **Hyperdrive** | ~150K queries | $0 |
| **TOTAL** | | **~$8.60/mo** |

### 100 Users / Month

| Service | Usage | Cost |
|---------|-------|------|
| Workers subscription | Base | $5.00 |
| Worker requests | ~1.5M/mo | $0 |
| CPU time | ~10.5M ms | $0 |
| **DO requests** | ~600K/mo | $0 (within 1M) |
| **DO duration** | ~200 GB-s | $0 |
| **DO SQLite reads** | ~1.5M/mo | $0 |
| **DO SQLite writes** | ~300K/mo | $0 |
| **KV reads** | ~600K/mo | $0 |
| **KV writes** | ~60K/mo | $0 |
| **R2 storage** | ~1.5 GB | $0 (within 10GB free) |
| **R2 ops** | ~300K A / 300K B | $0 |
| **Queues** | ~900K ops | $0 |
| **Vectorize** | ~15M dims | $0 |
| **Workers AI** | 100x above | ~$36.00 |
| **Hyperdrive** | ~1.5M queries | $0 |
| **TOTAL** | | **~$41.00/mo** |

### Cost Breakdown Summary

| Scale | Cloudflare Cost | External PG (~$20/mo small) | External AI (OpenAI etc.) | Total Est. |
|-------|----------------|-----------------------------|--------------------------|------------|
| 1 user | ~$5.36 | ~$0 (free tier PG) | ~$5-20 | ~$10-25 |
| 10 users | ~$8.60 | ~$20 | ~$50-100 | ~$80-130 |
| 100 users | ~$41 | ~$20-50 | ~$300-800 | ~$360-890 |

**Key insight**: Cloudflare costs scale extremely well. At 100 users, you're still only paying ~$41/mo for CF infrastructure. The external AI (OpenAI/Anthropic) and PG costs will dominate.

---

## 5. Free Tier Limits & When You'd Hit Them

| Service | Free/Paid Included | When You Hit It |
|---------|-------------------|-----------------|
| Worker requests | 10M/mo included | ~700 users (15K req/user/mo) |
| CPU time | 30M ms/mo included | ~3,000 users (10.5K ms/user/mo) |
| DO requests | 1M/mo included | ~1,600 users (600 req/user/mo) |
| DO duration | 400K GB-s/mo included | ~20,000 users (20 GB-s/user/mo) |
| DO SQLite reads | 25B/mo included | Essentially unlimited at this scale |
| DO SQLite writes | 50M/mo included | ~165,000 users |
| KV reads | 10M/mo included | ~16,600 users |
| KV writes | 1M/mo included | ~16,600 users |
| R2 storage | 10 GB free | ~6,600 users (1.5MB/user) |
| R2 Class A | 1M/mo free | ~3,300 users |
| R2 Class B | 10M/mo free | ~33,000 users |
| Queue ops | 1M/mo included | ~1,100 users |
| Vectorize queried | 50M dims/mo | ~3,300 users |
| Workers AI neurons | 10K/day free | ~20 users (after that, paid) |
| Hyperdrive queries | Unlimited (paid) | Never (paid plan) |

**First limit hit**: Queue operations at ~1,100 users.
**Second limit hit**: DO requests at ~1,600 users.
**Third limit hit**: Worker requests at ~700 users (varies by usage pattern).

---

## 6. Overall Feasibility of Going All-Cloudflare: 6/10

### What works well:
- The architecture is ALREADY deeply integrated with Cloudflare. 8 DO classes, 10 KV namespaces, R2, Queues, Vectorize, Workflows, Workers AI, Hyperdrive. It's a showcase CF app.
- Cost scaling is excellent. CF free tiers are generous.
- DO SQLite provides per-user isolated state which is elegant for email.
- R2 is cheap for email thread storage (no egress fees).
- Workers AI can handle embeddings and light summarization locally.

### What doesn't work:
1. **PostgreSQL dependency is fundamental, not incidental.** The app uses `drizzle-orm/postgres-js`, `better-auth` (which requires PG), and the entire auth/user/session system is PG-native. You can't just swap PG for D1. ZeroDB DO literally wraps PG calls.

2. **D1 migration is blocked by better-auth** (as noted in previous evaluation, score 4/10). better-auth has no D1 adapter, and writing one is non-trivial. The auth tables use PG-specific features.

3. **The DO architecture is heavily tied to the per-connection model.** ZeroAgent and ZeroDriver are per-connection DOs with SQLite storage that handle real-time WebSocket connections. This can't run on PG.

4. **External AI dependency is large.** The AI chat uses OpenAI/Anthropic/Groq via their SDKs -- not Workers AI. Workers AI is only used for pipeline processing (summaries, embeddings, labels). Going all-CF for AI would mean replacing OpenAI with CF models, which are less capable.

### Honest Assessment: Going ALL-IN on Cloudflare + IMAP + Custom AI

**Combined viability score: 5/10**

| Initiative | Score | Timeline | Risk |
|------------|-------|----------|------|
| PG -> D1 migration | 4/10 | Blocked by better-auth | HIGH |
| IMAP driver | 6/10 | 8-12 weeks | MEDIUM |
| Custom AI endpoint | 8/10 | 3-4 weeks | LOW |

**The strategy of going ALL-IN Cloudflare has these issues:**

1. **D1 is NOT a drop-in PG replacement.** Even if better-auth added D1 support, you'd need to migrate 36+ migrations, rewrite queries, handle D1's SQLite limitations (no full-text search on jsonb, no array types, different SQL dialect). The thread data model relies on PG features.

2. **IMAP support is orthogonal to Cloudflare.** Adding IMAP means building a new email driver (like the existing Google driver). It runs in Workers via DOs. This is doable but significant work (8-12 weeks) because IMAP is a complex protocol and you'd need to handle:
   - IMAP connection management (long-lived in DOs)
   - Message parsing (MIME)
   - IDLE/NOTIFY for push
   - Folder management
   - Flag synchronization

3. **Custom AI endpoint is the easiest win.** You already use OpenAI SDK. Adding a custom endpoint (e.g., for local models, or CF Workers AI) is straightforward since the AI SDK is abstracted.

4. **The real blocker**: You're already heavily invested in CF. The question isn't "should we go all-CF?" -- you already are. The question is "should we replace PG with D1?" and the answer is **no, not unless you rewrite auth from scratch.**

### Recommended Strategy:
1. **Keep PostgreSQL.** It's the right tool. Use Hyperdrive to keep it fast.
2. **Keep the current CF architecture.** It's well-designed for the platform.
3. **Add IMAP driver** (6/10 viable, gives multi-provider support).
4. **Add custom AI endpoint** (8/10 viable, gives flexibility).
5. **Consider D1 ONLY for the DO-local data** (thread cache, agent state) -- not for the main user database. The DOs already use SQLite internally, which is essentially what D1 is.
6. **Migrate KV -> PG tables** if you want to reduce CF service count. This is lower risk than D1 migration.

### Cost-Efficiency Verdict:
Cloudflare is cost-efficient for this workload. The $5/mo base + usage model means you pay ~$5-41/mo for CF infra at 1-100 users. The real costs are PG hosting ($0-50/mo) and AI API calls ($5-800/mo). CF is not the bottleneck.
