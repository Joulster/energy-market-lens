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
| Observability | LangSmith (`langsmith` SDK) — traces all Claude calls with token usage, latency, prompt version; silently no-ops when `LANGCHAIN_API_KEY` is absent |
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
TENNET_API_KEY=<key>
# REDIS_URL is optional locally — omit it and the cache falls back to in-memory
# LangSmith (optional — omit to disable tracing)
LANGCHAIN_API_KEY=ls__...
LANGCHAIN_TRACING_V2=true
LANGCHAIN_PROJECT=energy-market-lens
LANGCHAIN_ENDPOINT=https://api.smith.langchain.com
```

### Production (Railway)
- Build: `npm run build` (Vite) → `dist/`, then `node server/index.js`
- Express serves `dist/` as static files and handles all `/api/*` routes on the same port
- Environment variables set in Railway dashboard: `ANTHROPIC_API_KEY`, `ENTSOE_API_KEY`, `TENNET_API_KEY`, `PORT=3001`
- `REDIS_URL` injected automatically by Railway's Redis service reference
- Do NOT bake `LANGCHAIN_TRACING_V2=true` into Dockerfile — inject via env only
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
      shared.jsx                   # COLORS, ChartWrap, SourceBadge, fmtDate, chartProps, CompareTooltip, useLegendToggle
      useZoom.js                   # Reusable drag-to-zoom hook for all time-series charts
      DayAheadSection.jsx          # 2 charts: price (resolution switcher) + negative hours per week
      BalancingSection.jsx         # 2 charts: imbalance midprice, weekly std dev volatility
      AncillaryServicesSection.jsx # 3 charts: aFRR capacity (price+MW), FCR capacity (price+MW), aFRR energy up/down
```

**Layout:** Fixed header, then a resizable flex row — charts panel (left, default 75%, grows to full content height) + narrative panel (right, default 25%, sticky with max-height). A draggable 1px separator between them allows custom splits. The page itself scrolls; `.app-body` is no longer `overflow: hidden`.

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
  entso-e.js       # ENTSO-E Transparency Platform API (A44, A75, A81/B95 for aFRR+FCR capacity)
  tennet.js        # TenneT REST API — imbalance midprice + aFRR energy prices (settlement-prices endpoint)
  claude.js        # generateNarrative(), generateRegulatoryWatch(), generateCustomerSignals()
  prompts.js       # Central store for all 3 system prompts + PROMPT_VERSIONS for LangSmith filtering
  researchCache.js # Redis-backed cache (ioredis); in-memory fallback when REDIS_URL unset
  mockData.js      # Seeded mock data (kept for reference, no longer used as fallback)
```

**Routes:**
| Method | Path | Source | Status |
|---|---|---|---|
| GET | `/health` | — | ✅ Healthcheck |
| GET | `/api/day-ahead-prices` | ENTSO-E A44 | ✅ Live |
| GET | `/api/actual-generation` | ENTSO-E A75 | ✅ Live |
| GET | `/api/imbalance-prices` | TenneT settlement-prices | ✅ Live |
| GET | `/api/afrr` | TenneT (energy) + ENTSO-E A81/B95 (capacity) | ✅ Live |
| POST | `/api/narrative` | Claude Haiku 4.5 | ✅ Live |
| POST | `/api/regulatory` | Claude Sonnet 4.6 + web_search | ✅ Live |
| POST | `/api/customer-signals` | Claude Sonnet 4.6 + web_search | ✅ Live |

All non-API `GET` routes serve `dist/index.html` (client-side routing support).

---

## Data Sources

### ENTSO-E (`server/entso-e.js`)

- **Day-ahead prices** — document type A44, NL bidding zone `10YNL----------L`
- **Actual generation** — document type A75, NL area, B19 (solar), B16/B18 (wind)
- **Capacity prices** — document type A81/B95 (contracted reserves / procured capacity):
  - **aFRR** — `type_MarketAgreement.Type = A13` (4-hour block agreement). Returns a ZIP containing one XML per CET delivery day. Chunked in 8-day batches to stay under the 100-TimeSeries-per-request limit (12 series/day × 8 days = 96 < 100). Directions: `A01` = Up, `A02` = Down.
  - **FCR** — `type_MarketAgreement.Type = A01` (symmetric, 4-hour blocks). Chunked in 14-day batches (6 series/day × 14 days = 84 < 100).
  - Both return ZIP files containing multiple XMLs. `unzipAllXml()` parses every file in the archive to avoid missing delivery days (a common bug when only parsing the first file).
  - Capacity data includes both clearing price (EUR/MW/h) and procured quantity (MW) per 4-hour block.

### TenneT (`server/tennet.js`)

- **Endpoint:** `https://api.tennet.eu/publications/v1/settlement-prices`
- **Auth:** `apikey` header with `TENNET_API_KEY`
- **Date format:** API expects `DD-MM-YYYY 00:00:00`; uses exclusive end date (add 1 day to the inclusive endDate)
- **Rate limiting:** chunked into 1-month batches (API max range)
- **Retry logic:** 3 attempts with exponential backoff; retries on 429/500/502/503/504 and timeouts
- **Response:** 15-minute ISP resolution with CET local timestamps (`timeInterval_start`), fields `dispatch_up` and `dispatch_down`
- **`fetchImbalancePrices`** — aggregates 15-min points to daily average mid price `(dispatch_up + dispatch_down) / 2`
- **`fetchAFRRData`** — returns raw 15-min points with `{ timestamp, afrrUpEnergyPrice, afrrDownEnergyPrice }` so the frontend can aggregate at 15m / 1h / 1d

### `/api/afrr` route

Combines both sources and returns:
```js
{
  afrrEnergyRaw: [...],   // TenneT 15-min energy activation prices (Up/Down)
  afrrHourly:   [...],    // ENTSO-E 4h-block capacity prices + MW (Up/Down)
  fcrHourly:    [...],    // ENTSO-E 4h-block FCR clearing price + MW
}
```

Cache salt is versioned (currently `v10|`) — bump to bust Redis when the response shape changes.

---

## AI Models

| Function | Model | Notes |
|---|---|---|
| `generateNarrative()` | `claude-haiku-4-5` | Fast, no web search needed |
| `generateRegulatoryWatch()` | `claude-sonnet-4-6` | Requires `web_search_20250305` tool — haiku doesn't support it |
| `generateCustomerSignals()` | `claude-sonnet-4-6` | Same — web search only works on Sonnet+ |

`web_search_20250305` is Anthropic's built-in server-side tool. `max_uses: 4` per call (reduced from 8 for cost).

---

## Observability (LangSmith)

All three Claude functions in `server/claude.js` are wrapped with `traceable()` from the `langsmith` SDK. Route handlers in `server/index.js` have a parent `traceable()` wrapper that shows cache hits as zero-token traces.

**Prompt versions** are tracked in `server/prompts.js`:
```js
export const PROMPT_VERSIONS = {
  narrative:       'v2',   // bump when prompt changes — traces are filterable by version
  regulatory:      'v1',
  customerSignals: 'v1',
}
```

If `LANGCHAIN_API_KEY` is not set, `traceable()` silently no-ops — no errors, no performance impact.

---

## Caching (`server/researchCache.js`)

Single Redis cache (`getCached` / `setCached`) used for both market data and research calls. Falls back to in-memory `Map` when `REDIS_URL` is not set.

**Market data routes** (all four endpoints):
- **TTL:** 24h for historical ranges (endDate before today); 1h for ranges including today
- **Cache salt:** `/api/afrr` uses a versioned salt string (`v10|`) in the cache key — increment to force a cache bust when the response shape changes

**Research calls** (Regulatory Watch, Customer Signals):
- **Key:** `eml:{namespace}:{YYYY-MM}:{fingerprint}` — auto-expires at end of month
- **Fingerprint:** `{ urls, days, prompt }` (regulatory) or `{ urls, companies, topics, days, prompt }` (customer signals)
- **Effect:** one Sonnet call per month per unique config, regardless of how many users hit Refresh
- Shows "📦 Cached · Updated [date]" in the UI when serving from Redis

---

## Charts (market-based grouping)

### Day-Ahead (`DayAheadSection`)
- **Day-Ahead Price NL** — resolution switcher in chart header:
  - **15m** — line chart, raw 15-minute ENTSO-E price points (EUR/MWh)
  - **1h** — HLA (High/Low/Average) range bar chart, hourly aggregates
  - **1d** — HLA range bar chart, daily aggregates
  - HLA bars: dark spine showing high→low range; cyan tick for average; blue cap for high; slate cap for low
  - Compare previous period overlays a dashed average line + delta tooltips across all resolutions
- **Negative price hours per week** — bar chart, X-axis shows ISO week numbers (W20, W21, …), solar curtailment risk signal
- **Legend toggle:** click any legend item to hide/show that series (uses `useLegendToggle` from `shared.jsx`)

### Balancing (`BalancingSection`)
- **Imbalance Midprice NL** (EUR/MWh) — daily line chart from TenneT settlement-prices. Mid price = `(dispatch_up + dispatch_down) / 2` averaged over 15-min intervals per day.
- **Imbalance Price Volatility** — weekly std dev bar chart, wind exposure signal
- **Legend toggle** on both charts

### Ancillary Services (`AncillaryServicesSection`)

**aFRR Capacity NL — Price & Volume** (`ComposedChart`):
- Source: ENTSO-E A81/B95 with A13 agreement type
- Default resolution: **4h blocks** (can switch to **1d** daily average)
- Y-axes: two left-side axes — outer for MW (capacity bars), inner for EUR/MW/h (price lines)
- Series: Up Capacity (MW bar), Down Capacity (MW bar), aFRR Up Price (line), aFRR Down Price (line)
- Compare mode adds dashed Prev. Up / Prev. Down lines
- Legend toggle

**FCR Capacity NL — Price & Volume** (`ComposedChart`):
- Source: ENTSO-E A81/B95 with A01 agreement type
- Default resolution: **4h blocks** (can switch to **1d**)
- Same dual-left-axis layout: MW bars + EUR/MW/h price line
- Legend toggle

**aFRR Energy Price NL — Up / Down (EUR/MWh)** (`LineChart`):
- Source: TenneT settlement-prices (raw 15-min)
- Resolution switcher: **15m** / **1h** / **1d** (same pattern as Day-Ahead)
- Series: aFRR Up Energy, aFRR Down Energy; compare mode adds dashed Prev. Up / Prev. Down
- Legend toggle

---

## Legend Toggle (`shared.jsx` — `useLegendToggle`)

All 7 time-series charts use the `useLegendToggle` hook. Click a legend item to toggle that series on/off.

```js
const lgd = useLegendToggle()
// On the <Legend> element:
<Legend {...lgd.legendProps} />
// On each series:
<Line name="Series Name" hide={lgd.isHidden('Series Name')} ... />
```

Key is the display name (`data.value`) not the `dataKey`, which allows function-based dataKeys (e.g. HLA range bars `d => [d.low, d.high]`) to work correctly.

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

**Error empty state** (`isMock` prop on `ChartWrap`):
- Charts whose source returned an error show: hourglass icon + "Coming soon" + "Pending authorisation from TenneT"
- Source badge shows **"N/A"** (not the source name) when data is unavailable
- Controls (resolution switcher, zoom reset) are hidden when `isMock` is true
- Priority: `isLoading` renders skeleton first; once resolved, `isMock` shows empty state if the source errored

---

## Right Panel Layout

The right panel (`narrative-panel`) is `position: sticky; top: 53px` — it stays in the viewport as you scroll through the left panel's charts. Key CSS:
- `.app-body`: `align-items: flex-start` (not `overflow: hidden`) — the page itself scrolls
- `.charts-panel`: no `overflow-y: auto` — grows to full content height
- `.narrative-panel`: `max-height: calc(100vh - 53px); overflow-y: auto; padding-bottom: 32px` — shrinks to content height when content fits viewport; scrolls internally only when content exceeds viewport height; extra bottom padding prevents last item clipping

---

## AI Market Summary (narrative)

- Each chart section has its own AI Summary block directly below it
- One **Generate Summary** button triggers a single Claude Haiku call populating all three blocks
- Returns `{ dayAhead, balancing, ancillaryServices }` JSON — all three sections are now populated when data is available
- `null` → "No data available"; `undefined` → block hidden (not yet generated)
- Stale warning shown when date range changes after generation
- 15-minute client-side session cache per `{ startDate, endDate }` pair

**Payload (`buildNarrativePayload` in `src/data/index.js`):**

Sends period-summarised data for all three sections:
```js
{
  period: { from, to },
  dayAheadPrice: { avgEurMwh, highEurMwh, lowEurMwh, rangeEurMwh, negativeHours, dailyHLA, bestArbitrageWindow },
  negativeHoursPerWeek: [...],
  balancing: {                          // null if no imbalance data
    avgMidPriceEurMwh, highMidPriceEurMwh, lowMidPriceEurMwh, rangeEurMwh,
    daily: [{ date, midPrice }],
  },
  ancillaryServices: {                  // null if no aFRR/FCR data
    afrrEnergy:   { avgUpEurMwh, avgDownEurMwh },          // null if unavailable
    afrrCapacity: { avgUpPriceEurMwPerH, avgDownPriceEurMwPerH, avgUpMW, avgDownMW }, // null if unavailable
    fcr:          { avgPriceEurMwPerH, avgCapacityMW },    // null if unavailable
  },
}
```

`hourlyHLAForNegativeDays` is computed client-side to derive `bestArbitrageWindow` but excluded from the POST body to keep the payload small. Express body limit is `2mb` to support wide date ranges.

**Narrative prompt (v2):** Instructs Haiku to write 2–3 sentences per section grounded in the provided numbers, returning null for any section whose payload key is null. Never fabricates numbers. Prompt version tracked in `server/prompts.js` for LangSmith filtering.

---

## Regulatory Watch

- **Auto-loads on mount** — fetches immediately; cache hit is near-instant on repeat visits
- **Gear icon** opens settings — 7 NL-focused default sources (ACM, TenneT, ENTSO-E, Netbeheer NL, RVO, EU Commission Energy, ACER), each toggleable
- **Add source** appends new entries
- **Lookback** — 4 fixed options: 30d / 60d / 90d (default) / 180d, rendered as pill buttons
- **Regenerate button** at the bottom of the settings panel — dim by default, highlights indigo when any setting has changed (`dirty` flag); closes panel and fires a new fetch on click
- **Header button** only appears during fetch (`Searching…`) or on error with no results (`Retry`)
- `[LOOKBACK DAYS]` placeholder in the system prompt is substituted at call time alongside `[TODAY DATE]` and `[CUTOFF DATE]`
- Calls **Claude Sonnet 4.6 + `web_search_20250305`** (up to 4 searches)
- Response: JSON array of `{ change, implication, date, source }`
- Server-side `parseJsonArray()` handles truncated responses by salvaging complete objects
- Default view shows top 3 items; "Show all N" expands
- Shows "📦 Cached · Updated [date]" when serving from Redis

---

## Customer Signals

- **Auto-loads on mount** — same pattern as Regulatory Watch
- **Gear icon** opens settings with 4 sections: Sources, Companies to Watch, Topics, Lookback Window
- 8 default sources, 13 seeded companies, 8 seeded topics (NL energy market focused)
- **Lookback** — 4 fixed options: 30d / 60d / 90d (default) / 180d, pill buttons (same as Regulatory Watch)
- **Regenerate button** at bottom of settings panel — dirty-state highlighting, same behaviour as Regulatory Watch
- **Header button** same as Regulatory Watch: only `Searching…` or `Retry`
- Calls **Claude Sonnet 4.6 + `web_search_20250305`** (up to 4 searches, max_tokens 6000)
- Response: JSON array of `{ signal, context, implication, source }`
- Shows "📦 Cached · Updated [date]" when serving from Redis

---

## Configurable Prompts

- **Pencil button (✏)** opens a 3-tab modal (Market Outlook / Regulatory Watch / Customer Signals)
- Amber dot when prompt differs from default
- Each tab: textarea, Save, Reset (restores from `src/data/defaultPrompts.js`)
- `server/prompts.js` is the single source of truth; `src/data/defaultPrompts.js` mirrors for client Reset

---

## Key Design Decisions

**Market-based chart grouping** (not asset-type): Charts are grouped by market (Day-Ahead / Balancing / Ancillary Services) rather than by asset. This matches how traders and asset managers think.

**No mock data fallbacks**: Failed sources surface as error states (empty state or N/A badge), not silently as fake numbers.

**HLA instead of OHLC for electricity prices**: Open/Close have no meaningful interpretation for power market prices. High/Low/Average correctly represents the price distribution within a time bucket.

**Resolution switcher on charts**: Rather than separate charts for different granularities, a single chart with a switcher (15m/1h/1d for Day-Ahead and aFRR Energy; 4h/1d for aFRR and FCR Capacity) lets the user zoom in or out on the same price series.

**Dual left Y-axis for capacity charts**: aFRR and FCR capacity charts show price (EUR/MW/h) and volume (MW) on two separate left-side Y-axes. The outer axis shows MW (bars), the inner axis shows EUR/MW/h (lines). Both on the left avoids the visual confusion of right-side axes.

**ISO week numbers on negative hours chart**: Week start dates (e.g. "05/14") are hard to parse quickly. W20/W21 notation matches how traders think about forward calendar weeks.

**Source badges on every chart**: Each chart shows the data source. When data is unavailable, the badge shows "N/A" — never the source name, since no data is actually being sourced.

**Legend toggle on all charts**: All 7 time-series charts support click-to-hide via `useLegendToggle`. Keyed by display name (not `dataKey`) so function-based dataKeys on HLA bars work correctly.

**Sticky narrative sidebar with page scroll**: The right panel sticks in view as you scroll through charts. The page itself scrolls (not the charts panel), so the charts panel grows to its full content height. The sidebar uses `max-height` + `overflow-y: auto` so it never clips content — it scrolls internally only when the total content exceeds the viewport.

**Errors propagate to Claude**: `buildNarrativePayload()` passes null for any missing data section. The narrative prompt instructs Claude to return null for those keys — never fabricate.

**Lazy Anthropic client**: SDK client created on first use so a missing API key doesn't crash the server on startup.

**Single-container deployment**: Vite builds to `dist/`, Express serves it as static files. Same process, same port, no Nginx. Vite dev proxy is conditional — disabled in production since frontend and backend share the same origin.

**Shared Redis cache**: Both market data and research results use the same Redis store. Market data is keyed by source + date range with a 1h/24h TTL; research results are keyed by month + config fingerprint. All users share the same cache — a team of 10 pays for one ENTSO-E fetch and one Sonnet call per cache window, not ten.

**Negative price fix**: ENTSO-E XML parser regex uses `[-\d.]+` (not `[\d.]+`) so negative prices are correctly captured. All CET bucketing uses `Europe/Amsterdam` locale formatters, not UTC, to correctly handle NL delivery days.

**ENTSO-E ZIP multi-file parsing**: Each ENTSO-E capacity price response is a ZIP containing one XML per CET delivery day. `unzipAllXml()` iterates all entries — parsing only the first file (alphabetically the earliest day) was a bug that made FCR data appear to start on Jan 5 instead of Jan 1.

**aFRR capacity chunking**: ENTSO-E limits responses to 100 TimeSeries per request. aFRR A13 produces 12 series/day (6 blocks × 2 directions), so requests are chunked in 8-day batches (96 < 100). FCR A01 produces 6 series/day and is chunked in 14-day batches.
