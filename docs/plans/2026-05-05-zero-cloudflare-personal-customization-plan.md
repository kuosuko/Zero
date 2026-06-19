# Zero Personal Cloudflare Fork Implementation Plan

> For Hermes: Use subagent-driven-development only after reading this entire document. Do not start implementation from memory alone. Re-read this file before each major phase so no context is lost.

**Goal:** Turn the Zero fork into a personal, all-Cloudflare deployment that supports IMAP/SMTP accounts, configurable AI endpoints, D1 instead of PostgreSQL/Hyperdrive, and outbound S/MIME signing.

**Architecture:** Keep the existing Cloudflare-first application shape intact: React Router frontend on Cloudflare, Worker backend, Durable Objects, KV, Queues, R2, Workflows, Vectorize. Replace the remaining PostgreSQL/Hyperdrive dependency with D1, add a new IMAP/SMTP provider without removing existing provider abstractions, centralize AI provider/model creation behind a factory, and insert S/MIME signing into the outbound MIME generation path before provider send/createDraft/sendDraft calls.

**Tech Stack:** pnpm monorepo, React Router, Cloudflare Workers, Durable Objects with sqlite storage, D1, KV, R2, Queues, Workflows, Vectorize, Drizzle ORM, better-auth, TRPC, Gmail/Outlook mail drivers, mimetext raw MIME generation.

---

## 0. Non-negotiable context to preserve

This section exists so future implementation does not lose critical context.

1. This fork lives at `/home/ubuntu/zero`.
2. Git remotes are:
   - `origin`: `https://github.com/kuosuko/zero.git`
   - `upstream`: `https://github.com/mail-0/zero.git`
3. The project already runs locally:
   - frontend on `http://localhost:3001`
   - backend on `http://localhost:8787`
   - local PostgreSQL on `localhost:5432`
4. The user has Cloudflare Workers Paid.
5. This deployment is for personal single-user use, not 100-user scale.
6. Free-tier-style limits are effectively not the constraint here.
7. The user wants a very detailed written record first, and future implementation must follow it carefully without dropping context.
8. New requirements now include:
   - IMAP/SMTP account support
   - configurable AI endpoint support
   - PostgreSQL/Hyperdrive removal in favor of D1
   - S/MIME signing for outbound mail
9. Current codebase facts already verified:
   - backend is deeply coupled to Cloudflare Workers features
   - agent sub-system already uses sqlite via Durable Objects
   - primary app database still uses PostgreSQL via Hyperdrive
   - mail providers currently only support Google and Microsoft OAuth
   - AI calls are spread across multiple files and many are hardcoded to OpenAI/Groq/etc.
10. Do not propose moving away from Cloudflare as the default path for this fork unless a concrete blocker is discovered during implementation.

---

## 1. Current repository map relevant to this project

### Backend core
- `apps/server/src/main.ts`
- `apps/server/src/env.ts`
- `apps/server/wrangler.jsonc`
- `apps/server/src/db/index.ts`
- `apps/server/src/db/schema.ts`
- `apps/server/drizzle.config.ts`
- `apps/server/src/types.ts`

### Mail provider abstraction
- `apps/server/src/lib/driver/index.ts`
- `apps/server/src/lib/driver/types.ts`
- `apps/server/src/lib/driver/google.ts`
- `apps/server/src/lib/driver/microsoft.ts`

### Auth and connection flow
- `apps/server/src/lib/auth.ts`
- `apps/server/src/lib/auth-providers.ts`
- `apps/server/src/trpc/routes/connections.ts`
- `apps/mail/components/connection/add.tsx`
- `apps/mail/app/(routes)/settings/connections/page.tsx`
- `apps/mail/lib/constants.tsx`

### User settings storage and UI
- `apps/server/src/lib/schemas.ts`
- `apps/server/src/trpc/routes/settings.ts`
- `apps/mail/hooks/use-settings.ts`
- `apps/mail/app/(routes)/settings/general/page.tsx`
- `apps/mail/app/(routes)/settings/security/page.tsx`
- `apps/mail/app/(routes)/settings/signatures` (route may exist or need creation depending on codebase state)
- `apps/mail/config/navigation.ts`
- `apps/mail/app/routes.ts`

### AI entry points already identified
- `apps/server/src/routes/ai.ts`
- `apps/server/src/routes/chat.ts`
- `apps/server/src/routes/agent/index.ts`
- `apps/server/src/routes/agent/tools.ts`
- `apps/server/src/routes/agent/orchestrator.ts`
- `apps/server/src/trpc/routes/ai/compose.ts`
- `apps/server/src/trpc/routes/ai/search.ts`
- `apps/server/src/trpc/routes/ai/webSearch.ts`
- `apps/server/src/lib/analyze/interests.ts`
- `apps/server/src/services/writing-style-service.ts`

### Existing test surface
- `packages/testing/playwright.config.ts`
- `packages/testing/e2e/auth.setup.ts`
- `packages/testing/e2e/search-bar.spec.ts`
- `packages/testing/e2e/bulk-search.spec.ts`
- `packages/testing/e2e/mail-actions.spec.ts`
- `packages/testing/e2e/mail-inbox.spec.ts`
- `packages/testing/e2e/ai-summary.spec.ts`

---

## 2. Confirmed architectural conclusions

### 2.1 What should stay on Cloudflare
Keep these unless a hard blocker appears:
- Worker runtime
- Durable Objects
- KV
- R2
- Queues
- Workflows
- Vectorize
- frontend deployment on Cloudflare

### 2.2 What should change
- Replace `Hyperdrive + PostgreSQL` with `D1`
- Replace hardcoded AI model/provider calls with a central configurable provider factory
- Add IMAP/SMTP as a first-class provider path
- Add S/MIME signing in the outbound MIME build/send pipeline

### 2.3 Why D1 is acceptable here
For personal single-user use:
- D1 size/perf limits are not the practical bottleneck
- consistency tradeoffs are acceptable compared to the operational simplicity gained
- this project is already Cloudflare-native enough that removing PG simplifies the stack rather than complicating it

---

## 3. Ground rules for implementation

1. Strict TDD for code changes where practical.
2. Never change more than one major axis at a time.
3. Do not mix D1 migration with IMAP implementation in the same commit.
4. Preserve current Google flow until IMAP is proven.
5. Preserve current OpenAI-compatible path until configurable AI is proven.
6. Insert feature flags or compatibility defaults where necessary so unfinished phases do not brick the app.
7. Keep migration steps reversible.
8. Prefer additive schema changes before destructive cleanup.
9. Preserve user data shape when moving from PG JSONB to D1 text-backed JSON.
10. For S/MIME, start with signing only, not encryption.

---

## 4. Acceptance criteria

The work is not done until all items below are true.

### Platform
- The app deploys fully on Cloudflare without PostgreSQL or Hyperdrive.
- `wrangler.jsonc` contains D1 bindings instead of Hyperdrive for primary app data.
- local dev can run either with D1 local mode or documented Cloudflare local bindings.

### Email accounts
- User can add an IMAP/SMTP account from the UI.
- Credentials/config are stored securely enough for the chosen architecture.
- Inbox listing works for IMAP-backed accounts.
- Reading a thread works for IMAP-backed accounts.
- Draft creation works for IMAP-backed accounts.
- Sending mail through SMTP works for IMAP-backed accounts.

### AI config
- User can set AI provider settings in the UI.
- OpenAI-compatible base URL is configurable.
- API key is configurable.
- model names are configurable.
- existing AI features use the centralized provider factory.

### S/MIME
- User can upload or provide signing cert/key material.
- Outbound mail can be signed before send.
- Signed mail is sent as valid MIME with S/MIME signature attachment/structure.
- Signing can be toggled per account or globally.

### Quality
- Existing Google account behavior still works.
- Existing draft/send flows still work for non-S/MIME accounts.
- Existing AI routes still work with default config.
- Existing Playwright tests either still pass or are updated with documented reasons.

---

## 5. Revised implementation order: tree-first, core-first, highest-risk-first

This order intentionally starts from the root of the system, not the leaves.
Because this fork currently has no production users to protect, the goal is to change the deepest architectural constraints first, surface breakage early, and only then extend outward into UI and convenience layers.

### Root-first execution order

1. Planning checkpoint and branch setup
2. Migrate primary app DB from PG/Hyperdrive to D1
3. Replace runtime DB access patterns so the Worker core no longer depends on PostgreSQL semantics
4. Introduce typed connection config/storage primitives for non-OAuth mail accounts
5. Implement IMAP/SMTP driver and sync strategy at the backend core
6. Extract and centralize outbound MIME construction
7. Add S/MIME signing into the core outbound mail pipeline
8. Centralize AI provider/model creation behind one server-side factory
9. Extend settings schema/storage for AI, IMAP/SMTP metadata, and S/MIME material
10. Add/adjust UI pages and forms for connections, AI config, and security settings
11. Final end-to-end verification, cleanup, and docs update

### Tree view of the intended change order

- Core platform root
  - D1 replaces PG/Hyperdrive
  - DB access abstraction updated everywhere
- Mail transport trunk
  - typed connection config for IMAP/SMTP
  - IMAP/SMTP driver implementation
  - sync/polling behavior for IMAP accounts
- Mail security branch
  - outbound MIME builder extraction
  - S/MIME signing integration
- AI services branch
  - centralized provider factory
  - user-configurable endpoint/model selection
- UI leaves
  - settings screens
  - connection creation forms
  - status indicators and validations

Rationale:
- D1 migration is the deepest architectural dependency and should be proven first.
- IMAP/SMTP is the next major core capability and should be built before polishing settings/UI.
- S/MIME belongs near the outbound mail core, not as a late cosmetic feature.
- AI settings are important, but they sit above the data/runtime foundation and do not determine whether the fork can replace the original stack.
- UI should follow the backend core once the underlying contracts are stable.

---

## 6. Branch strategy

Create branches in this order:

1. `docs/zero-cloudflare-plan`
2. `feat/zero-ai-provider-config`
3. `feat/zero-imap-smtp`
4. `feat/zero-smime-signing`
5. `feat/zero-d1-migration`
6. `feat/zero-cloudflare-final-integration`

If implementation is done in a single branch anyway, still preserve commit boundaries matching these phases.

---

## 7. Detailed implementation phases

## Phase A: Establish safety rails and inventory

### Task A1: Snapshot current working behavior

**Objective:** Record exactly what works before changes.

**Files:**
- Create: `docs/plans/verification-baseline-zero.md`

**Steps:**
1. Start local services.
2. Confirm backend health endpoint returns success.
3. Confirm frontend loads.
4. Record exact commands used.
5. Record current auth/account assumptions.
6. Record any known failing tests.

**Commands:**
- `source /home/ubuntu/.nvm/nvm.sh && cd /home/ubuntu/zero && pnpm docker:db:up`
- `source /home/ubuntu/.nvm/nvm.sh && cd /home/ubuntu/zero && pnpm db:push`
- `source /home/ubuntu/.nvm/nvm.sh && cd /home/ubuntu/zero && pnpm dev`
- `curl http://localhost:8787/health`
- `curl -I http://localhost:3001`

**Verification:**
- backend returns `{"message":"Zero Server is Up!"}`
- frontend returns HTML

### Task A2: Inventory every DB touchpoint

**Objective:** Prevent missing a PG/Hyperdrive reference during D1 migration.

**Files:**
- Create: `docs/plans/d1-migration-inventory.md`

**Steps:**
1. Enumerate every file calling `createDb(`.
2. Enumerate every file importing `drizzle-orm/postgres-js` or `postgres`.
3. Enumerate every schema field that uses PG-specific helpers.
4. Enumerate every raw SQL usage.
5. Enumerate every location depending on connection string env values.

**Expected current examples:**
- `apps/server/src/db/index.ts`
- `apps/server/src/main.ts`
- `apps/server/src/routes/ai.ts`
- `apps/server/src/routes/chat.ts`
- `apps/server/src/lib/auth.ts`
- `apps/server/src/services/writing-style-service.ts`
- workflow files using `env.HYPERDRIVE.connectionString`

### Task A3: Inventory every outbound mail path

**Objective:** Ensure S/MIME and IMAP implementation covers all send paths.

**Files:**
- Create: `docs/plans/outbound-mail-paths.md`

**Steps:**
1. Trace `IOutgoingMessage` consumers.
2. Trace `createDraft`, `sendDraft`, `create` through chat/agent/main DO wrappers.
3. Identify where MIME is currently assembled.
4. Identify all provider-specific send methods.
5. Mark exact insertion point for signing.

**Expected current focus:**
- `apps/server/src/lib/driver/google.ts`
- `apps/server/src/lib/driver/microsoft.ts`
- `apps/server/src/routes/chat.ts`
- `apps/server/src/routes/agent/index.ts`

---

## Phase B: Centralize AI provider configuration

### Task B1: Define server-side AI settings shape

**Objective:** Add explicit typed settings for AI provider config.

**Files:**
- Modify: `apps/server/src/lib/schemas.ts`
- Modify: `apps/server/src/db/schema.ts` or future D1-equivalent schema storage contract
- Test: create server-side schema tests if repo has unit-test harness; otherwise document with route-level verification and add Playwright coverage later

**Add settings fields like:**
- `aiProviderType`: `'openai_compatible' | 'anthropic' | 'google' | 'groq' | 'perplexity' | 'workers_ai'`
- `aiBaseUrl?: string`
- `aiApiKey?: string`
- `aiModel?: string`
- `aiMiniModel?: string`
- `aiEmbeddingProviderType?: string`
- `aiEmbeddingModel?: string`
- `aiHeaders?: Record<string, string>` if needed later, but defer if YAGNI

**Important design choice:**
Start with `openai_compatible` first even if other providers remain supported internally. This covers OpenAI, OpenRouter, many gateways, and local-compatible endpoints with the least complexity.

### Task B2: Create a single AI factory module

**Objective:** Remove scattered direct provider construction.

**Files:**
- Create: `apps/server/src/lib/ai/provider-factory.ts`
- Potentially create: `apps/server/src/lib/ai/provider-settings.ts`

**Responsibilities:**
- read effective AI settings from user settings or environment fallback
- produce chat model handle
- produce mini model handle
- support safe defaults when user has not configured custom settings yet

**Pseudo-shape:**
- `getAiSettingsForUser(userId, env)`
- `createPrimaryTextModel(settings, env)`
- `createMiniTextModel(settings, env)`
- `assertAiSettingsAreUsable(settings)`

**Fallback order:**
1. per-user settings
2. env defaults
3. hardcoded safe compatibility fallback

### Task B3: Migrate AI routes to the factory

**Objective:** Make every AI entry point use one source of truth.

**Files:**
- Modify: `apps/server/src/routes/ai.ts`
- Modify: `apps/server/src/routes/chat.ts`
- Modify: `apps/server/src/routes/agent/index.ts`
- Modify: `apps/server/src/routes/agent/tools.ts`
- Modify: `apps/server/src/trpc/routes/ai/compose.ts`
- Modify: `apps/server/src/trpc/routes/ai/search.ts`
- Modify: `apps/server/src/lib/analyze/interests.ts`
- Review: `apps/server/src/services/writing-style-service.ts`

**Do not do in this phase:**
- remove support for current providers entirely
- add every exotic provider UI option immediately

### Task B4: Add AI settings UI

**Objective:** User can configure custom AI endpoints from settings.

**Files:**
- Create or modify route under `apps/mail/app/(routes)/settings/`
- Modify: `apps/mail/config/navigation.ts`
- Modify: `apps/mail/app/routes.ts`
- Modify: `apps/mail/hooks/use-settings.ts` if needed

**Minimum UI fields:**
- provider type
- base URL
- API key
- primary model
- mini model
- test connection button optional, defer if needed

**Verification:**
- save settings via `trpc.settings.save`
- reload page and confirm persisted values
- run one AI-powered feature with configured endpoint

---

## Phase C: Extend settings for mail security and account metadata

### Task C1: Add S/MIME settings schema

**Objective:** Create typed storage for S/MIME preferences.

**Files:**
- Modify: `apps/server/src/lib/schemas.ts`

**Recommended fields:**
- `smimeEnabled: boolean`
- `smimeMode: 'disabled' | 'sign'`
- `smimeCertificatePem?: string`
- `smimePrivateKeyPem?: string`
- `smimePrivateKeyPassphrase?: string`
- `smimeSignerEmail?: string`
- `smimeApplyToAliases?: boolean`

**Security note:**
For personal use, storing encrypted key material in D1/KV is acceptable if documented clearly. Still encrypt at rest before storage if practical.

### Task C2: Decide where sensitive secrets live

**Objective:** Avoid casually mixing certs/keys into general user settings if it creates operational pain.

**Preferred approach:**
- keep non-sensitive toggles in `user_settings.settings`
- keep secret material in a dedicated table or KV namespace, keyed by user/account

**Recommended new storage object:**
- `mail_security_material`
  - `id`
  - `userId`
  - `connectionId` or nullable for global default
  - `kind` (`smime-signing`)
  - `certificatePem`
  - `privateKeyEncrypted`
  - `privateKeyEncryptionMeta`
  - `createdAt`
  - `updatedAt`

This is cleaner than bloating general settings JSON.

### Task C3: Add UI for S/MIME management

**Objective:** Let the user upload/enter signing materials and turn signing on/off.

**Files:**
- Create: `apps/mail/app/(routes)/settings/security/page.tsx` if current page is not sufficient
- Or modify existing security page
- Add form controls for cert/key upload or PEM paste

**Minimum UI:**
- enable signing toggle
- signer email / alias selector
- cert PEM upload/paste
- private key PEM upload/paste
- passphrase field if encrypted key used
- send signed messages toggle

---

## Phase D: Add IMAP/SMTP provider support

### Task D1: Extend provider enum and connection shape

**Objective:** Make provider type extensible beyond Google/Microsoft.

**Files:**
- Modify: `apps/server/src/types.ts`
- Modify: `apps/server/src/db/schema.ts` and future D1 schema equivalent
- Modify: `apps/mail/lib/constants.tsx`

**Changes:**
- add `imap` to provider enum
- widen `providerId` union in connection schema
- decide whether one `connection` row is enough for IMAP+SMTP combined config or if a secondary config table is cleaner

**Recommended:**
Keep `connection` as the logical mailbox/account identity, and store protocol configuration in a dedicated per-connection config table.

### Task D2: Add IMAP/SMTP connection config storage

**Objective:** Keep provider auth/config structured and future-proof.

**Recommended new table:**
- `connection_transport_config`
  - `connectionId`
  - `imapHost`
  - `imapPort`
  - `imapSecure`
  - `imapUsername`
  - `imapPasswordEncrypted`
  - `smtpHost`
  - `smtpPort`
  - `smtpSecure`
  - `smtpUsername`
  - `smtpPasswordEncrypted`
  - `authType` (`password` for now)
  - `createdAt`
  - `updatedAt`

This is better than forcing these fields into the existing OAuth-shaped connection row.

### Task D3: Implement IMAP/SMTP driver

**Objective:** Create a new driver implementing the existing `MailManager` interface.

**Files:**
- Create: `apps/server/src/lib/driver/imap.ts`
- Modify: `apps/server/src/lib/driver/index.ts`
- Modify: `apps/server/src/lib/driver/types.ts` only if the interface truly needs extension

**Likely libraries:**
- IMAP: `imapflow`
- SMTP: `nodemailer`

**Driver responsibilities:**
- list folders/mailbox mapping
- list messages/threads approximation
- get thread/message details
- create draft
- send draft or send directly
- fetch attachment
- mark read/unread
- delete/archive behavior mapping

**Important warning:**
Threading in IMAP is not identical to Gmail thread IDs. Expect an adaptation layer.

**Recommended strategy:**
- use message-id, references, in-reply-to, subject normalization to synthesize thread grouping if needed
- do not try to perfectly emulate Gmail threading in first pass

### Task D4: Add connection creation flow for IMAP/SMTP

**Objective:** User can add a non-OAuth account.

**Files:**
- Modify: `apps/mail/components/connection/add.tsx`
- Modify: `apps/mail/app/(routes)/settings/connections/page.tsx`
- Create: IMAP connection form component(s)
- Create/modify backend mutations for creating a connection row + transport config

**Flow:**
1. open Add Connection dialog
2. choose IMAP/SMTP
3. enter display name, email, IMAP host/port/security, SMTP host/port/security, username/password
4. backend validates login
5. create connection row
6. save encrypted credentials
7. trigger initial sync if desired

### Task D5: Add sync behavior for IMAP

**Objective:** Make IMAP inbox usable in the existing app model.

**Files:**
- likely modify sync workflows, queue producers/consumers, or provider-specific factories
- inspect and adapt:
  - `apps/server/src/lib/factories/base-subscription.factory.ts`
  - provider-specific sync/subscription files
  - workflow files

**Important constraint:**
Gmail push/subscription concepts do not map directly to IMAP. First version may need polling.

**Recommended personal-use simplification:**
For IMAP accounts, implement periodic polling via cron/workflow instead of push.

---

## Phase E: Add S/MIME signing

### Task E1: Isolate MIME generation behind a reusable builder

**Objective:** Stop burying MIME creation inside one provider implementation.

**Files:**
- Extract from: `apps/server/src/lib/driver/google.ts`
- Create: `apps/server/src/lib/mail/build-raw-message.ts`
- Create: `apps/server/src/lib/mail/build-signed-message.ts`

**Current known fact:**
`google.ts` already uses `mimetext` and base64 encodes the raw MIME for Gmail API send.

**Desired architecture:**
1. build unsigned MIME message from `IOutgoingMessage`
2. optionally sign it with S/MIME
3. hand raw MIME to provider-specific send adapter

This keeps S/MIME orthogonal to provider choice.

### Task E2: Choose signing implementation

**Objective:** Use a pure-JS signing library that works in Worker runtime with node compatibility.

**Candidate approach:**
- evaluate `node-forge` for PKCS#7 detached signature generation

**Required output format:**
- `multipart/signed`
- protocol `application/pkcs7-signature` or `application/x-pkcs7-signature`
- detached signature over canonicalized MIME body

**Do not attempt first:**
- S/MIME encryption
- certificate chain validation UI
- enterprise trust store management

### Task E3: Add signing service module

**Objective:** Centralize S/MIME signing logic and error handling.

**Files:**
- Create: `apps/server/src/lib/mail/smime-sign.ts`
- Create: `apps/server/src/lib/mail/smime-types.ts`

**Service responsibilities:**
- load signer material
- canonicalize MIME body
- produce PKCS#7 detached signature
- assemble `multipart/signed` MIME
- return raw MIME string

### Task E4: Hook signing into outbound flows

**Objective:** Signed sending works for send and draft-send paths.

**Files:**
- Modify: `apps/server/src/lib/driver/google.ts`
- Modify: `apps/server/src/lib/driver/microsoft.ts`
- Modify future: `apps/server/src/lib/driver/imap.ts`
- Review wrappers in `apps/server/src/routes/chat.ts` and `apps/server/src/routes/agent/index.ts`

**Signing rule:**
If account/user S/MIME signing is enabled and valid material is present, sign before provider send.

**Draft rule:**
Decide one of two behaviors and document it clearly:
1. sign only at final send time
2. store signed raw draft

**Recommended:**
Sign at final send time only. Draft editing is simpler and avoids invalidating a prior signature on every edit.

### Task E5: UI/verification for S/MIME status

**Objective:** User can tell whether a message will be signed.

**Possible UI additions:**
- compose screen badge: `S/MIME signing on`
- settings validation status: cert loaded / key loaded / signer email matches alias
- send-time warning if enabled but unusable

---

## Phase F: Migrate PostgreSQL to D1

### Task F1: Create D1 schema equivalent

**Objective:** Translate existing app schema cleanly.

**Files:**
- Create: `apps/server/src/db/d1-schema.ts` or replace current schema module after careful migration
- Modify: `apps/server/drizzle.config.ts`
- Modify: `apps/server/wrangler.jsonc`

**Schema translation rules:**
- `pgTableCreator` -> sqlite or d1 table creator
- `jsonb` -> `text(..., { mode: 'json' })` where supported, or `text` with typed serialization helper
- `timestamp` -> text ISO timestamps
- `defaultNow()` -> explicit application timestamps where necessary
- `.$onUpdate()` -> handled in write path

**High-risk tables:**
- `user_settings`
- `writing_style_matrix`
- `email_template`
- any table with jsonb or many timestamps

### Task F2: Add D1 connection factory

**Objective:** Replace `postgres-js` based db factory.

**Files:**
- Replace or create alongside current:
  - `apps/server/src/db/index.ts`
  - possibly `apps/server/src/db/d1.ts`

**Current factory to retire later:**
- `drizzle-orm/postgres-js`
- `postgres(url)`

**New shape:**
- `createDb(env.DB)` or equivalent D1 binding-based accessor
- no connection string use in primary app paths

### Task F3: Replace Hyperdrive references in all call sites

**Objective:** Remove runtime PG dependency.

**Known classes/files to update include:**
- `apps/server/src/main.ts`
- `apps/server/src/routes/ai.ts`
- `apps/server/src/routes/chat.ts`
- `apps/server/src/routes/agent/mcp.ts`
- `apps/server/src/lib/auth.ts`
- `apps/server/src/lib/server-utils.ts`
- `apps/server/src/lib/factories/base-subscription.factory.ts`
- `apps/server/src/pipelines.ts`
- `apps/server/src/services/writing-style-service.ts`
- `apps/server/src/workflows/sync-threads-workflow.ts`
- `apps/server/src/workflows/sync-threads-coordinator-workflow.ts`

**Implementation rule:**
Do not search-and-replace blindly. Some code currently expects `{ db, conn }`; D1 paths likely remove `conn`, so each caller must be adjusted intentionally.

### Task F4: Add D1 binding to Wrangler

**Objective:** Make D1 the primary app DB.

**Files:**
- Modify: `apps/server/wrangler.jsonc`

**Changes:**
- add D1 binding(s)
- remove Hyperdrive binding for the primary app database after migration completes
- update local and staging/prod env sections consistently

### Task F5: Data migration strategy

**Objective:** Move local PG data shape to D1 without guesswork.

**For personal single-user use:**
The simplest and safest migration may be reset-and-reseed rather than live migration, unless valuable existing data must be preserved.

**Decision checkpoint:**
- If no valuable existing app data: create fresh D1 DB and manually reconnect account(s)
- If valuable existing data exists: write export/import script

**Recommended default for this fork:**
Fresh D1 start unless the user explicitly says old app data must be preserved.

### Task F6: Remove PG/Hyperdrive leftovers

**Objective:** Finish cleanup only after D1 is proven.

**Cleanup targets:**
- `DATABASE_URL` dependency if no longer needed
- Hyperdrive bindings in `wrangler.jsonc`
- PG docker setup from docs if no longer part of dev path
- `drizzle-orm/postgres-js` import paths
- `postgres` dependency if unused

---

## Phase G: Testing and verification plan

## G1. Minimum verification matrix

### Local infrastructure
- backend starts with Worker + D1 bindings
- frontend starts
- settings save/reload works

### Google baseline
- existing Google account can still connect
- inbox loads
- message view loads
- draft send still works

### IMAP account
- can create IMAP connection
- can list inbox
- can open thread
- can create draft
- can send SMTP message

### AI config
- can save OpenAI-compatible base URL
- can save API key/model
- compose/search/summary use configured endpoint

### S/MIME
- can save signing materials
- can send signed message
- signed MIME structure validates when inspecting raw source

### D1
- no code path requires Hyperdrive/PG for primary app data
- settings, connections, templates, sessions all survive restart

## G2. Suggested Playwright additions

Create or extend tests under `packages/testing/e2e/`:
- `settings-ai-config.spec.ts`
- `settings-imap-connection.spec.ts`
- `settings-smime.spec.ts`
- `mail-send-signed.spec.ts`

If full automation is too heavy initially, still create a manual verification checklist file and mark exact gaps.

## G3. Commands to use repeatedly

- `source /home/ubuntu/.nvm/nvm.sh && cd /home/ubuntu/zero && pnpm install`
- `source /home/ubuntu/.nvm/nvm.sh && cd /home/ubuntu/zero && pnpm nizzy sync`
- `source /home/ubuntu/.nvm/nvm.sh && cd /home/ubuntu/zero && pnpm dev`
- `source /home/ubuntu/.nvm/nvm.sh && cd /home/ubuntu/zero && pnpm lint`
- `source /home/ubuntu/.nvm/nvm.sh && cd /home/ubuntu/zero && pnpm --filter=@zero/testing test:e2e`

Adjust D1-specific commands once the new DB path is implemented.

---

## 8. Security considerations

1. IMAP/SMTP passwords should not be stored in plain text if avoidable.
2. S/MIME private keys should not be stored raw in general user settings JSON.
3. For personal use, a pragmatic encrypted-at-rest approach is enough; enterprise HSM complexity is unnecessary.
4. AI API keys are sensitive and should not be leaked back to frontend except as masked values.
5. Settings endpoints must preserve auth checks.
6. If adding test connection endpoints, redact secrets from logs.

---

## 9. Known tricky areas

1. Gmail-style thread semantics do not map perfectly to IMAP.
2. Gmail drafts and IMAP drafts behave differently.
3. Microsoft send flow may not accept the exact same raw MIME path as Gmail.
4. S/MIME canonicalization is easy to get subtly wrong.
5. D1 timestamp/json behavior differs from PostgreSQL and may surface hidden assumptions.
6. Existing code may rely on PG connection object lifecycle (`conn.end()` etc.) in some paths.
7. Queue/workflow sync behavior may assume push/subscription semantics that IMAP lacks.

---

## 10. What not to do

- Do not rewrite the whole app into plain Node.
- Do not remove Google support before IMAP is stable.
- Do not implement S/MIME encryption in the first pass.
- Do not add a giant catch-all `providerConfig` blob without a typed shape.
- Do not store certs, passwords, AI keys, and random settings all in one unstructured JSON object if a cleaner dedicated table is practical.
- Do not migrate to D1 and IMAP in one unreviewable mega-commit.

---

## 11. First implementation slice to execute after this plan

If starting actual implementation under the revised core-first strategy, begin here:

1. Create D1 schema equivalent.
2. Create D1 database factory/binding path.
3. Replace one narrow but real server path from PG/Hyperdrive to D1.
4. Expand that replacement across all primary app DB call sites.
5. Verify the Worker core runs without primary PostgreSQL dependency.
6. Only after that, design the typed IMAP/SMTP connection config layer.

Reason: this is the root architectural constraint. If D1 migration feels wrong in practice, that must be discovered before building more branches on top of the old core. Once the data/runtime root is stable, IMAP/SMTP and S/MIME can be built on the correct foundation.

---

## 12. Definition of done for the whole project

The project is done when:
- the app can be deployed fully on Cloudflare for personal use
- a personal IMAP/SMTP account can be connected and used
- AI endpoint is configurable from the UI
- outbound email can be S/MIME signed
- primary app state no longer depends on PostgreSQL/Hyperdrive
- the repo contains updated documentation for local dev and deploy

---

## 13. Execution handoff note

Plan complete. Before each implementation phase, read:
1. this file
2. the phase-specific inventory/checklist files created during Phase A
3. the exact target source files before editing

Implementation must proceed task-by-task with small commits and verification after each phase. Do not rely on memory summaries alone.
