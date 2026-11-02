# Obot

A self-hosted, multi-user agentic chat platform. People work in **Threads** with an agent that can use tools (OpenAI's hosted web search for now). Tool use streams live and is shown as readable UI instead of raw JSON.

- **Agent threads**: streaming replies, reasoning summaries, web search steps (searches, opened pages, find-in-page) with sources, and inline clickable citations.
- **Background runs**: replies keep generating on the server if you close or switch tabs. Reopening the thread reattaches to the live stream. Stop works at any time.
- **Models from CLIProxyAPI**: loaded automatically from `GET /v1/models`. Admins choose which are enabled. Includes a model + reasoning-effort selector (efforts are capped at X-High; Luna also offers "Disabled").
- **Context indicator**: a ring in the composer with a hover card showing the context breakdown and thread spend.
- **Multi-user**: `USER` and `ADMIN` roles. The first account becomes admin; everyone else joins through single-use invite links.
- **Spend limits**: weekly (Monday 00:00 UTC) and monthly (1st 00:00 UTC) caps. Admins set defaults (an amount or unlimited) and per-user overrides.
- **Permanent usage ledger**: every request is recorded and never deleted (enforced by a database trigger). The usage page filters by any date range and exports CSV.
- Images (local disk), auto titles, rename/pin/search/delete, edit and regenerate, and dark/light themes.

Built with Next.js 16 (App Router), Prisma 7 + PostgreSQL, Better Auth, Tailwind v4 + shadcn/ui, Streamdown, Recharts, and TanStack Query.

---

## Quick start (local development)

Requirements: Node 20.19+/22.12+/24+, pnpm 10, PostgreSQL 15+ and a running [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).

```bash
pnpm install
cp .env.example .env            # fill in DATABASE_URL, BETTER_AUTH_SECRET, CLIPROXY_*
pnpm db:deploy                  # apply migrations
pnpm dev
```

Open http://localhost:3000. You'll be sent to **/register** to create the admin account. Then:

1. **Admin → Models**: click **Sync now**, enable the models people may use, and click **Edit** to set prices. Without a price, spend can't be counted (see *Pricing*).
2. **Admin → Settings**: set default spend limits, the web search default, and an optional system prompt.
3. **Admin → Users → Invite**: create invite links for other people.

### CLIProxyAPI

Obot only talks to CLIProxyAPI's OpenAI-compatible `GET /v1/models` and `POST /v1/responses` endpoints.

```yaml
# CLIProxyAPI config.yaml
port: 8317
access:
  api-keys:
    - "a-long-random-key-for-obot"
```

```bash
CLIPROXY_BASE_URL="http://localhost:8317"
CLIPROXY_API_KEY="a-long-random-key-for-obot"
```

## Docker

```bash
cp .env.example .env   # set BETTER_AUTH_SECRET, APP_URL, CLIPROXY_* (and POSTGRES_PASSWORD)
docker compose up -d --build
```

The image runs `prisma migrate deploy` on start, then the Next.js standalone server. Uploaded images and Postgres data live in named volumes. To run CLIProxyAPI in the same stack, see the commented `cliproxyapi` service in `docker-compose.yml`.

---

## How it works

### Agent runs

`POST /api/threads/:id/messages` validates the request, checks limits, and creates the user message, an empty assistant message, and a `Run`. It starts the run in the background and returns immediately.

- **Request**: the run calls `/v1/responses` with `stream: true, store: false`. Each turn replays the thread history statelessly: user text and images, plus each assistant turn's stored transcript (its text, function calls and their outputs; older rows fall back to final text). When reasoning is on, the request asks for `reasoning: { effort, summary: "auto" }`. When Search is on, it adds `tools: [{ type: "web_search", search_context_size, filters? }]` and `include: ["web_search_call.action.sources"]`.
- **Normalizing**: `src/server/llm/stream-normalizer.ts` turns raw Responses events into typed message parts: text with citations, reasoning, web search, a generic tool fallback, and errors. It emits small incremental operations, which the browser applies with the same reducer.
- **Agent loop**: a run is a multi-step loop that writes into one assistant message: model call → local tool calls → model call, until the model stops calling tools. Each model call records its own usage row, and spend limits are re-checked between steps. Admins cap steps per turn.
- **Steering**: messages sent while a run is active are queued and injected at the next step. **Interrupt** aborts only the current model call or tool batch; **Stop** ends the run and any sub-agents it started.
- **Live runs**: kept in memory with an event log (`src/server/agent/run-manager.ts`). `GET /api/runs/:id/stream?after=<seq>` (SSE) replays missed events, then streams live. This is how reload, resume, and reconnect work.
- **Saving**: partial output is flushed to Postgres at most once a second, so a server restart never loses a reply. On boot, runs left `RUNNING` are marked `INTERRUPTED`.

> **Single instance:** live runs are held in process memory, so run one app instance. Running several replicas behind a load balancer would need a shared event bus (for example Postgres `LISTEN/NOTIFY`), which isn't implemented.

### Agent capabilities

All are toggled in **Admin → Settings**.

- **Bash sandbox** (`src/server/sandbox`): a [just-bash](https://github.com/vercel-labs/just-bash) in-memory shell per top-level thread (no network or real processes; optional Python via WebAssembly). Files persist as gzipped snapshots under `UPLOAD_DIR/sandboxes` and can be downloaded from the thread's Files menu.
- **Inline UI**: the agent can put HTML in a ```` ```ui ```` fence. It's sanitized (DOMPurify allowlist; only `ui-*` classes) and styled by the kit in `src/app/inline-ui.css`.
- **Artifacts**: versioned markdown, HTML and React documents, created only when the user asks. HTML and React run in a sandboxed iframe (opaque origin, strict CSP, no network) using a vendored runtime bundled into `public/artifact-runtime/` by `scripts/build-artifact-runtime.mjs` (runs automatically before `dev` and `build`). The Artifacts page can also generate an artifact in a new background thread.
- **Sub-agents** (off by default): the agent can delegate tasks to child threads (`delegate_task`, `wait_tasks`, `task_status`, `task_cancel`, `subagent_capabilities`). Admins choose the allowed models and the descriptions the agent sees. While children run, the parent waits automatically, wakes to acknowledge each result, then keeps waiting. Children are nested under their parent in the sidebar and share its sandbox.

### Pricing and spend

The Responses API (and CLIProxyAPI) report **token counts only**, never dollars. Obot multiplies the API-reported usage by the **admin price table** (`ModelPrice`):

```
cost = (input - cached - cacheWrite) × input
     + cached × cachedInput
     + cacheWrite × cacheWrite   (only when a cache-write price is set; otherwise billed as input)
     + output × output           (reasoning tokens are already inside output tokens)
     + searchCalls × webSearchPer1k / 1000
```

- **Long-context multipliers**: optional. When set, they apply to the whole request once input exceeds the threshold.
- **Exact math**: everything uses integer micro-dollars (BigInt).
- **Append-only prices**: editing a price inserts a new row, so past usage keeps the price it was recorded with. A trigger blocks `UPDATE` and `DELETE` on `model_price`.
- **Web search billing**: only `web_search_call` items whose action is a `search` count as billable calls. Opening a page or finding text in a page doesn't count.
- **Unpriced models**: admins choose to block them for people who have a spend limit, or allow them at $0.
- **Metadata file**: `src/config/model-metadata.ts` stores OpenAI's list prices for reference only. They're never used for billing. The admin price dialog has a **Fill in** button that copies them into the form, but nothing is saved until you save it.

### Limits

Each user is **Inherit** (instance default), **Custom** (weekly and/or monthly cap; an empty field means no cap), or **Unlimited**. The instance default is either unlimited or limited with its own weekly/monthly amounts.

- **Enforcement**: limits are checked before every run. The monthly cap is checked first, so the error message shows when the limit resets.
- **Overshoot**: a run that's already in progress can push spend slightly past a cap.
- **Titles**: thread titles count toward the user's spend and appear as `TITLE` on the usage page.

### Usage ledger

`usage_record` is append-only. A database trigger rejects `UPDATE`, `DELETE` and `TRUNCATE`.

- **Deleting**: threads are soft-deleted, users are disabled rather than deleted, and edited or regenerated messages leave their usage rows in place.
- **Usage page**: presets (today, this week or month, last month, last 7/30/90 days, year to date, all time) or any custom range. Dates are shown in your local time zone. It includes a per-day chart by model, a by-model table, and a paginated request log with CSV export.
- **Admin view**: Admin → Usage shows the same view across all users, or for one user.

### Auth

- **Sign-in**: email and password through Better Auth, with sessions stored in the database. Public sign-up is disabled.
- **Accounts**: `/api/register` creates the first account (as admin) or redeems an invite. It runs inside a transaction that holds a Postgres advisory lock, so two "first" registrations can't both become admin.
- **Invites**: tokens are stored as SHA-256 hashes, and the raw link is shown only once.
- **Disabled accounts**: disabling a user revokes their sessions and blocks new ones.
- **Data access**: threads, messages, runs and uploads are owner-only (admins included). Admins can see everyone's usage.

### Images

PNG, JPEG, WebP and GIF up to 10 MB each, 5 per message.

- **Validation**: the file type is checked from the file's contents, not its extension.
- **Storage**: files go to `UPLOAD_DIR/<userId>/<uuid>.<ext>` and are served only to their owner.
- **Sending to the model**: images are sent as base64 data URLs.
- **When available**: uploads appear only for models with image input.

### Model metadata

`src/config/model-metadata.ts` has zod-validated metadata for **GPT-6.1 Sol**, **GPT-6 Astra** and **GPT-6 Luna** (source: OpenAI model pages, verified 2026-11-02): context window, max input and output, knowledge cutoff, modalities, reasoning efforts (capped at `xhigh`), web search support and reference prices. Models without metadata get generic defaults, and admins can override display names and context windows.

## Project layout

```
prisma/                      schema + migrations (incl. append-only triggers)
src/config/                  env validation, model metadata
src/server/llm/              CLIProxyAPI client, model catalog, request builder, stream normalizer
src/server/agent/            run manager, turns (send/edit/regenerate), threads, titles
src/server/billing/          pricing, limits (pure), usage ledger + reports
src/server/auth/             Better Auth, guards, policy (pure), registration, invites
src/app/api/                 route handlers
src/components/chat/         composer, model selector, context ring, messages, part renderers
src/components/usage|admin/  usage dashboard, admin screens
tests/                       Vitest unit tests (in-memory, no DB/network)
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server |
| `pnpm build` / `pnpm start` | Production build / server |
| `pnpm build:artifact-runtime` | Rebuild the sandboxed artifact runtime in `public/artifact-runtime/` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm db:migrate` | Create and apply a migration in development |
| `pnpm db:deploy` | Apply migrations (production) |

## Privacy note

Source favicons in web search cards load from DuckDuckGo's icon service (`icons.duckduckgo.com`) with no referrer. If that service fails, a generic globe icon is shown instead.
