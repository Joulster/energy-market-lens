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
| Cache | Redis (ioredis) — market data (1h/24h TTL) + research calls (monthly TTL); falls back to in-memory Map when `REDIS_URL` is not set |
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
    index.js                       # loadSourceData(), loadAllMarketData(), buildNarrativePayload(), fetchNarrative()
    dateRange.js                   # RANGE_OPTIONS, computeDates(), computePrevDates()
    defaultPrompts.js              # Client-side copies of all 3 system prompts (with placeholders) for Reset
  components/
    ChartsPanel/index.jsx          # Left panel — 3 market sections + compare feature + AI summary
    NarrativePanel.jsx             # Right panel — Regulatory Watch + Customer Signals + prompt editor
    RegulatoryWatch.jsx            # Self-contained; accepts regulatoryPrompt prop + configurable lookback
    CustomerSignals.jsx            # Self-contained; accepts customerSignalsPrompt prop + configurable lookback
    PromptEditorModal.jsx          # 3-tab modal for editing system prompts (narrative/regulatory/customerSignals)
    charts/
      shared.jsx                   # COLORS, ChartWrap (isMock + isLoading), SourceBadge, fmtDate, chartProps, CompareTooltip
      useZoom.js                   # Reusable drag-to-zoom hook for all time-series charts
      DayAheadSection.jsx          # 2 charts: price (resolution switcher) + negative hours per week
      BalancingSection.jsx         # 2 charts: imbalance midprice, weekly std dev volatility
      AncillaryServicesSection.jsx # 3 charts: aFRR capacity, FCR clearing, aFRR energy up/down
```

**Layout:** Fixed header, then a resizable flex row — charts panel (left, default 50%, scrollable) + narrative panel (right, default 50%, sticky). A draggable 1px separator between them allows custom splits.

**Data flow:**
1. `App.jsx` calls `loadSourceData()` independently for each of the 4 sources — no blocking `Promise.all`
2. `dataLoading` state (`{ dayAhead, generation, imbalance, afrr }`) is tracked per source and passed down
3. Each chart section renders immediately with a skeleton, flipping to live data as its source resolves
4. `loadAllMarketData()` is still used by the compare-period feature (needs all 4 sources together)
5. ChartsPanel's Generate Summary button calls `buildNarrativePayload()` then `POST /api/narrative`
6. Regulatory Watch and Customer Signals call their own endpoints independently

**Compare previous period:**
- Checkbox in the date range toolbar ("Compare previous period")
- When enabled, `computePrevDates(rangeKey)` calculates the equivalent prior period
- `loadAllMarketData()` is called again for the previous period dates
- Previous series are overlaid as dashed/faded lines on all charts
- `CompareTooltip` in `shared.jsx` shows current value + delta (coloured green/red) on hover
- Prev data keys follow `prev + capitalise(key)` convention (e.g. `avg` → `prevAvg`)
- DayAheadSection compare works across all resolutions (15m, 1h, 1d) — previous period is index-aligned

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

## Caching (`server/researchCache.js`)

Single Redis cache (`getCached` / `setCached`) used for both market data and research calls. Falls back to in-memory `Map` when `REDIS_URL` is not set.

**Market data routes** (`/api/day-ahead-prices`, `/api/actual-generation`):
- **Key:** `eml:market:{source}:{YYYY-MM}:{startDate|endDate}`
- **TTL:** 24h for historical ranges (endDate before today — data never changes); 1h for ranges including today
- **Imbalance + aFRR:** not cached yet — always error; TODO comments in `server/index.js` have the one-liner to enable once TenneT is live

**Research calls** (Regulatory Watch, Customer Signals):
- **Key:** `eml:{namespace}:{YYYY-MM}:{fingerprint}` — auto-expires at end of month
- **Fingerprint:** `{ urls, days, prompt }` (regulatory) or `{ urls, companies, topics, days, prompt }` (customer signals)
- **Effect:** one Sonnet call per month per unique config, regardless of how many users hit Refresh
- Shows "📦 Cached · Updated [date]" in the UI when serving from Redis

---

## Charts (market-based grouping)

### Day-Ahead (`DayAheadSection`)
- **Day-Ahead Price NL** — resolution switcher in chart header (left of title):
  - **15m** — line chart, raw 15-minute ENTSO-E price points (EUR/MWh)
  - **1h** — HLA (High/Low/Average) range bar chart, hourly aggregates
  - **1d** — HLA range bar chart, daily aggregates
  - HLA bars: dark spine showing high→low range; cyan tick for average; blue cap for high; slate cap for low
  - Compare previous period overlays a dashed average line + delta tooltips across all resolutions
- **Negative price hours per week** — bar chart, X-axis shows ISO week numbers (W20, W21, …), solar curtailment risk signal

**Removed charts** (were in earlier version, now removed):
- Daily average price line chart — superseded by the 1d resolution on the price chart
- Hourly price shape heatmap — redundant given the 1h resolution chart
- Peak/offpeak spread — hid information by averaging over large blocks; misleading for FCR/battery use cases

### Balancing (`BalancingSection`)
- **Imbalance midprice** — line chart, TenneT only (pending token) → shows empty state
- **Imbalance price volatility** — weekly std dev bar chart, wind exposure signal → shows empty state

### Ancillary Services (`AncillaryServicesSection`)
- **aFRR capacity price** (EUR/MW/h) — TenneT only (pending token) → shows empty state
- **FCR clearing price** (EUR/MW/h) — TenneT only (pending token) → shows empty state
- **aFRR energy up/down** (EUR/MWh) — TenneT only (pending token) → shows empty state

**Source:** All Ancillary Services data comes from TenneT (not ENTSO-E — TenneT NL does not publish to ENTSO-E TP).

---

## Zoom (drag-to-select)

All time-series charts support drag-to-zoom via `useZoom.js`:
- Click and drag horizontally on any chart to select a zoom region
- `↺ Reset` button appears in the chart header when zoomed
- Uses `useRef` for in-progress selection state (avoids stale closures), `useState` only for the committed zoom domain and visual `ReferenceArea` overlay
- `useZoom(data, xKey)` returns `{ displayData, handlers, refArea, isZoomed, reset }`
- Hook called unconditionally (React rules) — one instance per chart

---

## Loading & Empty States

**Skeleton loading** (`isLoading` prop on `ChartWrap`):
- While a source is fetching, charts show an animated pulsing bar skeleton instead of blank space
- `App.jsx` tracks `dataLoading` per source; passed through `ChartsPanel` → each section → `ChartWrap`
- Once data resolves, the skeleton is replaced by the live chart with no full-page flash

**TenneT-pending empty state** (`isMock` prop on `ChartWrap`):
- Charts that require a pending TenneT token show: hourglass icon + "Coming soon" + "Pending authorisation from TenneT"
- Source badge shows **"N/A"** (not the source name) when data is unavailable
- Controls (resolution switcher, zoom reset) are hidden when `isMock` is true
- Priority: `isLoading` renders skeleton first; once resolved, `isMock` shows empty state if the source errored

---

## Right Panel

### AI Market Summary
- Each chart section has its own AI Summary block directly below it
- One **Generate Summary** button triggers a single Claude Haiku call populating all three blocks
- Returns `{ dayAhead, balancing, ancillaryServices }` JSON
- `null` → "No data available"; `undefined` → block hidden (not yet generated)
- Stale warning shown when date range changes after generation
- 15-minute client-side session cache per `{ startDate, endDate }` pair
- Payload built by `buildNarrativePayload()` — sends only what Claude needs: daily HLA, period stats, neg-hours per week, best arbitrage window. `hourlyHLAForNegativeDays` is computed client-side for arbitrage but excluded from the POST body to keep payload small
- Express body limit set to `2mb` to support wide date ranges (e.g. full year)

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
- ENTSO-E day-ahead prices (A44) — NL bidding zone `10YNL----------L`; full price range including negatives
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

**No mock data fallbacks**: Failed sources surface as error states (empty state or N/A badge), not silently as fake numbers.

**HLA instead of OHLC for electricity prices**: Open/Close have no meaningful interpretation for power market prices. High/Low/Average correctly represents the price distribution within a time bucket.

**Resolution switcher on Day-Ahead chart**: Rather than separate charts for daily/hourly/raw, a single chart with a 15m/1h/1d switcher lets the user zoom in or out on the same price series. The chart type changes (line for 15m; HLA range bars for 1h and 1d) to match the appropriate level of detail.

**ISO week numbers on negative hours chart**: Week start dates (e.g. "05/14") are hard to parse quickly. W20/W21 notation matches how traders think about forward calendar weeks.

**Source badges on every chart**: Each chart shows the data source. When data is unavailable, the badge shows "N/A" — never the source name, since no data is actually being sourced.

**Errors propagate to Claude**: `buildNarrativePayload()` passes the `errors` object. Claude is instructed not to fabricate values for unavailable sources — returning `null` for those sections instead.

**Lazy Anthropic client**: SDK client created on first use so a missing API key doesn't crash the server on startup.

**Single-container deployment**: Vite builds to `dist/`, Express serves it as static files. Same process, same port, no Nginx. Vite dev proxy is conditional — disabled in production since frontend and backend share the same origin.

**Shared Redis cache**: Both market data and research results use the same Redis store. Market data is keyed by source + date range with a 1h/24h TTL; research results are keyed by month + config fingerprint. All users share the same cache — a team of 10 pays for one ENTSO-E fetch and one Sonnet call per cache window, not ten.

**Negative price fix**: ENTSO-E XML parser regex uses `[-\d.]+` (not `[\d.]+`) so negative prices are correctly captured. All CET bucketing uses `Europe/Amsterdam` locale formatters, not UTC, to correctly handle NL delivery days.
