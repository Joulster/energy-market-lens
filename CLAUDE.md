# Energy Market Lens — Project Context

## What This Is

A full-stack dashboard for monitoring Dutch energy markets, built for a **Head of Product at a VPP (Virtual Power Plant) software company**. The goal is to empathise with the company's user base — traders, asset managers, quants — by surfacing the key market signals they care about daily.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite 5, Recharts, plain CSS |
| Backend | Express (Node 18+, ESM), port via `$PORT` env var (default 3001) |
| AI | `@anthropic-ai/sdk` — Claude Haiku 4.5 (narrative) + Claude Sonnet 4.6 (regulatory/customer signals + web search) |
| Cache | Redis (ioredis) — monthly cache for research calls; falls back to in-memory Map when `REDIS_URL` is not set |
| Dev proxy | Vite proxies `/api/*` → `http://localhost:3001` (dev only; disabled in production) |
| Deployment | Docker (single container) on Railway — Express serves built React frontend from `dist/` |

### Running locally
```bash
# Terminal 1 — backend
node server/index.js

# Terminal 2 — frontend
npm run dev        # http://localhost:5173
```

### Environment variables (`.env` in project root)
```
ANTHROPIC_API_KEY=sk-ant-...
ENTSOE_API_KEY=<uuid>
# REDIS_URL is optional locally — omit it and the cache falls back to in-memory
```

### Production (Railway)
- Build: `npm run build` (Vite) → `dist/`, then `node server/index.js`
- Express serves `dist/` as static files and handles all `/api/*` routes on the same port
- Environment variables set in Railway dashboard: `ANTHROPIC_API_KEY`, `ENTSOE_API_KEY`, `PORT=3001`
- `REDIS_URL` injected automatically by Railway's Redis service reference
- Healthcheck: `GET /health` → `{ ok: true }`

---

## Architecture

### Frontend (`src/`)

```
src/
  App.jsx                          # Root — loads market data, manages panel widths, passes to panels
  App.css                          # Single dark-theme stylesheet
  main.jsx                         # Vite entry
  data/
    index.js                       # loadAllMarketData(), aggregateWeeklySummary(), fetchNarrative()
    dateRange.js                   # RANGE_OPTIONS, computeDates(), computePrevDates()
    defaultPrompts.js              # Client-side copies of all 3 system prompts (with placeholders) for Reset
  components/
    ChartsPanel/index.jsx          # Left panel — 3 market sections + compare feature + AI summary
    NarrativePanel.jsx             # Right panel — Regulatory Watch + Customer Signals + prompt editor
    RegulatoryWatch.jsx            # Self-contained; accepts regulatoryPrompt prop + configurable lookback
    CustomerSignals.jsx            # Self-contained; accepts customerSignalsPrompt prop + configurable lookback
    PromptEditorModal.jsx          # 3-tab modal for editing system prompts (narrative/regulatory/customerSignals)
    charts/
      shared.jsx                   # COLORS, ChartWrap, SourceBadge, fmtDate, chartProps, CompareTooltip
      DayAheadSection.jsx          # 4 charts: daily avg, hourly shape heatmap, spread, negative hours
      BalancingSection.jsx         # 2 charts: imbalance midprice, weekly std dev volatility
      AncillaryServicesSection.jsx # 3 charts: aFRR capacity, FCR clearing, aFRR energy up/down
```

**Layout:** Fixed header, then a resizable flex row — charts panel (left, default 50%, scrollable) + narrative panel (right, default 50%, sticky). A draggable 1px separator between them allows custom splits.

**Data flow:**
1. `App.jsx` calls `loadAllMarketData()` on mount — fires 4 parallel API calls
2. Passes `{ dayAhead, generation, imbalance, afrr, errors }` to both panels
3. Each chart section receives its slice + `errors` to show real vs mock badge
4. ChartsPanel's Generate Summary button calls `aggregateWeeklySummary()` then `POST /api/narrative`
5. Regulatory Watch and Customer Signals call their own endpoints independently

**Compare previous period:**
- Checkbox in the date range toolbar ("Compare previous period")
- When enabled, `computePrevDates(rangeKey)` calculates the equivalent prior period
- `loadAllMarketData()` is called again for the previous period dates
- Previous series are overlaid as dashed/faded lines on all charts
- `CompareTooltip` in `shared.jsx` shows current value + delta (coloured green/red) on hover
- Prev data keys follow `prev + capitalise(key)` convention (e.g. `avg` → `prevAvg`)

### Backend (`server/`)

```
server/
  index.js         # Express app, all routes, static file serving
  entso-e.js       # ENTSO-E Transparency Platform API (A44, A75, A73, A85)
  tennet.js        # TenneT API (imbalance midprice only — currently 404, token pending)
  claude.js        # generateNarrative(), generateRegulatoryWatch(), generateCustomerSignals()
  prompts.js       # Central store for all 3 system prompts
  researchCache.js # Redis-backed monthly cache (ioredis); in-memory fallback when REDIS_URL unset
  mockData.js      # Seeded mock data (kept for reference, no longer used as fallback)
```

**Routes:**
| Method | Path | Source | Status |
|---|---|---|---|
| GET | `/health` | — | ✅ Healthcheck |
| GET | `/api/day-ahead-prices` | ENTSO-E A44 | ✅ Live |
| GET | `/api/actual-generation` | ENTSO-E A75 | ✅ Live |
| GET | `/api/imbalance-prices` | TenneT CSV | ❌ 404 — token pending |
| GET | `/api/afrr` | ENTSO-E A73/A85 | ❌ TenneT NL doesn't publish to ENTSO-E TP |
| POST | `/api/narrative` | Claude Haiku 4.5 | ✅ Live |
| POST | `/api/regulatory` | Claude Sonnet 4.6 + web_search | ✅ Live |
| POST | `/api/customer-signals` | Claude Sonnet 4.6 + web_search | ✅ Live |

All non-API `GET` routes serve `dist/index.html` (client-side routing support).

---

## AI Models

| Function | Model | Notes |
|---|---|---|
| `generateNarrative()` | `claude-haiku-4-5` | Fast, no web search needed |
| `generateRegulatoryWatch()` | `claude-sonnet-4-6` | Requires `web_search_20250305` tool — haiku doesn't support it |
| `generateCustomerSignals()` | `claude-sonnet-4-6` | Same — web search only works on Sonnet+ |

`web_search_20250305` is Anthropic's built-in server-side tool. `max_uses: 4` per call (reduced from 8 for cost).

---

## Research Cache (`server/researchCache.js`)

Monthly Redis cache shared across all users and deploys:
- **Key format:** `eml:{namespace}:{YYYY-MM}:{fingerprint}` — auto-expires at end of month via Redis TTL
- **Fingerprint:** JSON of `{ urls, days, prompt }` (regulatory) or `{ urls, companies, topics, days, prompt }` (customer signals) — different configs cache independently
- **Fallback:** in-memory `Map` when `REDIS_URL` is not set (local dev)
- **Effect:** one Sonnet call per month per unique config, regardless of how many users hit Refresh

---

## Charts (market-based grouping)

### Day-Ahead (`DayAheadSection`)
- **Daily average price** (EUR/MWh) — line chart, ENTSO-E live
- **Hourly price shape** — custom heatmap showing avg price by hour of day (green→red gradient)
- **Peak/offpeak spread** — bar chart with zero reference line, signals battery charge/discharge windows
- **Negative price hours per week** — bar chart, solar curtailment risk signal

### Balancing (`BalancingSection`)
- **Imbalance midprice** — line chart, TenneT only (pending token)
- **Imbalance price volatility** — weekly std dev bar chart, wind exposure signal

### Ancillary Services (`AncillaryServicesSection`)
- **aFRR capacity price** (EUR/MW/h) — TenneT only (pending token)
- **FCR clearing price** (EUR/MW/h) — TenneT only (pending token)
- **aFRR energy up/down** (EUR/MWh) — TenneT only (pending token)

---

## Right Panel

### AI Market Summary
- Each chart section has its own AI Summary block directly below it
- One **Generate Summary** button triggers a single Claude Haiku call populating all three blocks
- Returns `{ dayAhead, balancing, ancillaryServices }` JSON
- `null` → "No data available"; `undefined` → block hidden (not yet generated)
- Stale warning shown when date range changes after generation
- 15-minute client-side session cache per `{ startDate, endDate }` pair

### Regulatory Watch
- **Gear icon** opens settings — 7 NL-focused default sources (ACM, TenneT, ENTSO-E, Netbeheer NL, RVO, EU Commission Energy, ACER), each toggleable
- **Configurable lookback** — default 90 days, min 30, max 180 (same as Customer Signals)
- **Add source** appends new entries
- Calls **Claude Sonnet 4.6 + `web_search_20250305`** (up to 4 searches)
- Response: JSON array of `{ change, implication, date, source }`
- Server-side `parseJsonArray()` handles truncated responses by salvaging complete objects
- Default view shows top 3 items; "Show all N" expands
- Shows "📦 Cached · Updated [date]" when serving from Redis

### Customer Signals
- **Gear icon** opens settings with 4 sections: Sources, Companies to Watch, Topics, Lookback Window
- 8 default sources, 13 seeded companies, 8 seeded topics (NL energy market focused)
- Lookback: default 90 days, min 30, max 180
- Calls **Claude Sonnet 4.6 + `web_search_20250305`** (up to 4 searches, max_tokens 6000)
- Response: JSON array of `{ signal, context, implication, source }`
- Shows "📦 Cached · Updated [date]" when serving from Redis

### Configurable Prompts
- **Pencil button (✏)** opens a 3-tab modal (Market Outlook / Regulatory Watch / Customer Signals)
- Amber dot when prompt differs from default
- Each tab: textarea, Save, Reset (restores from `src/data/defaultPrompts.js`)
- `server/prompts.js` is the single source of truth; `src/data/defaultPrompts.js` mirrors for client Reset

---

## Data Source Status & Roadmap

### Working now
- ENTSO-E day-ahead prices (A44) — NL bidding zone `10YNL----------L`
- ENTSO-E actual generation (A75) — solar (B19), wind (B16/B18)

### Pending TenneT developer API token
TenneT migrated from file-based CSVs to a new authenticated REST API. Once token arrives, wire up in `server/tennet.js`:
- **Imbalance midprice** — currently 404 on old CSV path
- **aFRR capacity prices** — TenneT-only, not on ENTSO-E TP (confirmed: ENTSO-E returns error 999)
- **FCR clearing prices** — TenneT-only
- **aFRR energy up/down prices** — TenneT-only

### Known non-issue
ENTSO-E A73/A85 returns error code 999 ("no matching data") for NL — this is expected. TenneT NL does not submit balancing capacity/energy procurement data to ENTSO-E Transparency Platform.

---

## Key Design Decisions

**Market-based chart grouping** (not asset-type): Charts are grouped by market (Day-Ahead / Balancing / Ancillary Services) rather than by asset. This matches how traders and asset managers think.

**No mock data fallbacks**: Failed sources surface as error states with amber badges, not silently as fake numbers.

**Source badges on every chart**: Each chart shows a green "ENTSO-E · real" or amber "TenneT · error" badge.

**Errors propagate to Claude**: `aggregateWeeklySummary()` passes the `errors` object. Claude is instructed not to fabricate values for unavailable sources — returning `null` for those sections instead.

**Lazy Anthropic client**: SDK client created on first use so a missing API key doesn't crash the server on startup.

**Single-container deployment**: Vite builds to `dist/`, Express serves it as static files. Same process, same port, no Nginx. Vite dev proxy is conditional — disabled in production since frontend and backend share the same origin.

**Shared Redis cache**: Research results cached in Redis keyed by month + config fingerprint. All users share the same cache, so a team of 10 pays for one Sonnet call per month, not ten.
