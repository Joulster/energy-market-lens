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
| Auth | WorkOS User Management — magic link email flow; session cookie via Redis |
| Dev proxy | Vite proxies `/api/*` and `/auth/*` → `http://localhost:3001` (dev only; disabled in production) |
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
# Auth (required — server exits with code 1 if any are missing)
WORKOS_API_KEY=sk_...
WORKOS_CLIENT_ID=client_...
APP_BASE_URL=http://localhost:5173   # dev; set to Railway URL in production
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
- Environment variables set in Railway dashboard: `ANTHROPIC_API_KEY`, `ENTSOE_API_KEY`, `TENNET_API_KEY`, `PORT=3001`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `APP_BASE_URL=https://<your-railway-domain>`
- `REDIS_URL` injected automatically by Railway's Redis service reference
- Do NOT bake `LANGCHAIN_TRACING_V2=true` into Dockerfile — inject via env only
- Healthcheck: `GET /health` → `{ ok: true }`

---

## Architecture

### Frontend (`src/`)

```
src/
  App.jsx                          # Root — loads market data, manages panel widths, Avatar component
  App.css                          # Single dark-theme stylesheet (includes auth + avatar styles)
  AppRouter.jsx                    # React Router: /auth/login, /auth/unauthorised, /* (AuthGate-wrapped App)
  main.jsx                         # Vite entry — BrowserRouter wrapper
  pages/
    Login.jsx                      # Magic link login page (idle → loading → sent / error states)
    Unauthorised.jsx               # "Access Restricted" page for un-provisioned accounts
  data/
    index.js                       # loadSourceData(), loadAllMarketData(), buildNarrativePayload(), fetchSectionNarrative()
    dateRange.js                   # RANGE_OPTIONS, computeDates(), computePrevDates()
  components/
    AuthGate.jsx                   # Checks /api/auth/me on mount; provides useUser() hook via AuthContext
    ChartsPanel/index.jsx          # Left panel — 3 market sections + compare feature + per-section AI summaries
    NarrativePanel.jsx             # Right panel — Regulatory Watch + Customer Signals
    RegulatoryWatch.jsx            # Self-contained; configurable sources + lookback
    CustomerSignals.jsx            # Self-contained; configurable sources, companies, topics, lookback
    charts/
      shared.jsx                   # COLORS, ChartWrap, SourceBadge, fmtDate, chartProps, CompareTooltip, useLegendToggle
      useZoom.js                   # Reusable drag-to-zoom hook for all time-series charts
      DayAheadSection.jsx          # 2 charts: price (resolution switcher) + negative hours per week
      BalancingSection.jsx         # 1 chart: imbalance midprice with 1h/1d resolution switcher
      AncillaryServicesSection.jsx # 3 charts: aFRR capacity (price+MW), FCR capacity (price+MW), aFRR energy up/down
```

**Layout:** Fixed header, then a resizable flex row — charts panel (left, default 75%, grows to full content height) + narrative panel (right, default 25%, sticky with max-height). A draggable 1px separator between them allows custom splits. The page itself scrolls; `.app-body` is no longer `overflow: hidden`.

**Data flow:**
1. `App.jsx` calls `loadSourceData()` independently for each of the 6 sources — no blocking `Promise.all`
   - Sources: `dayAhead`, `generation`, `imbalance`, `afrr`, `balanceDelta`, `frrActivations`
2. `dataLoading` state (`{ dayAhead, generation, imbalance, afrr, balanceDelta, frrActivations }`) is tracked per source and passed down
3. Each chart section renders immediately with a skeleton, flipping to live data as its source resolves
4. `loadAllMarketData()` is still used by the compare-period feature (needs all core sources together)
5. Cross-market data (`crossMarketData`) is fetched in `ChartsPanel` when zones are selected — one `fetchCrossMarketPrices(zone, startDate, endDate)` call per zone, independent
6. Merit order is fetched inside `MeritOrderChart` (self-contained component in AncillaryServicesSection) — one day at a time via `fetchMeritOrderDay(date)`
7. Each section has its own Generate button — `ChartsPanel` calls `buildNarrativePayload()` once, then `fetchSectionNarrative(section, fullPayload, ...)` for that section only
8. Regulatory Watch and Customer Signals call their own endpoints independently

**Two-control compare toolbar** (replaces single previous-period toggle):

*Control 1 — Previous Period toggle:*
- Checkbox in the date range toolbar ("Prev. period")
- When enabled, `computePrevDates(rangeKey)` calculates the equivalent prior period
- `loadAllMarketData()` is called again for the previous period dates
- Previous series are overlaid as dashed/faded lines on all charts that support it
- `CompareTooltip` in `shared.jsx` shows current value + delta (coloured green/red) on hover
- Prev data keys follow `prev + capitalise(key)` convention (e.g. `avg` → `prevAvg`)
- DayAheadSection compare works across all resolutions (15m, 1h, 1d) — previous period is index-aligned

*Control 2 — Add Market multi-select:*
- Dropdown button ("Add Market") in the toolbar, next to the Previous Period toggle
- Options: DE, BE, FR — each independently toggleable, multiple can be active simultaneously
- Bidding zone codes: DE=`10Y1001A1001A82H`, BE=`10YBE----------2`, FR=`10YFR-RTE------C`
- Colours: DE amber `#fbbf24`, BE purple `#a78bfa`, FR rose `#fb7185`
- Fetches `/api/cross-market-prices?zone=XX&startDate=...&endDate=...` for each selected zone
- `crossMarketData` in ChartsPanel: `{ DE: {dailyAvg, hourlyAvg}, BE: {...}, FR: {...} }`
- **Overlaid on**: Day-Ahead price chart (all resolutions, as daily-avg lines) and FCR Capacity chart
- **Not shown on**: Balancing, aFRR capacity, aFRR energy — absence is natural, no indicator
- When no markets selected: button shows no selection state, no legend entries added to charts

### Backend (`server/`)

```
server/
  index.js         # Express app, all routes, static file serving; fail-fast on missing auth env vars
  auth.js          # WorkOS magic link flow: authRouter (5 routes) + requireAuth middleware + getSession helper
  entso-e.js       # ENTSO-E Transparency Platform API (A44, A75, A81/B95 for aFRR+FCR capacity + cross-market)
  tennet.js        # TenneT REST API — settlement-prices + balance-delta + frr-activations + merit-order
  claude.js        # generateDayAheadNarrative(), generateBalancingNarrative(), generateAncillaryNarrative(),
                   # generateRegulatoryWatch(), generateCustomerSignals(), callHaiku() shared helper
  prompts.js       # Central store for all 5 system prompts + PROMPT_VERSIONS for LangSmith filtering
  researchCache.js # Redis-backed cache (ioredis); in-memory fallback when REDIS_URL unset
  mockData.js      # Seeded mock data (kept for reference, no longer used as fallback)
```

**Routes:**
| Method | Path | Source | Cache TTL | Status |
|---|---|---|---|---|
| GET | `/health` | — | — | ✅ Healthcheck |
| POST | `/auth/magic-link` | WorkOS createMagicAuth | — | ✅ Live |
| GET | `/auth/callback` | WorkOS authenticateWithCode | — | ✅ Live |
| GET | `/auth/logout` | Session delete + cookie clear | — | ✅ Live |
| GET | `/api/auth/me` | Session lookup | — | ✅ Live |
| GET | `/api/day-ahead-prices` | ENTSO-E A44 NL | 1h/24h | ✅ Live |
| GET | `/api/actual-generation` | ENTSO-E A75 NL | 1h/24h | ✅ Live |
| GET | `/api/imbalance-prices` | TenneT settlement-prices | 1h/24h | ✅ Live |
| GET | `/api/afrr` | TenneT (energy) + ENTSO-E A81/B95 (capacity) | 1h/24h | ✅ Live |
| GET | `/api/balance-delta` | TenneT balance-delta | 1h/24h | ✅ Live |
| GET | `/api/frr-activations` | TenneT frr-activations | 1h/24h | ✅ Live |
| GET | `/api/merit-order?date=YYYY-MM-DD` | TenneT merit-order | 7 days | ✅ Live |
| GET | `/api/cross-market-prices?zone=DE\|BE\|FR` | ENTSO-E A44 (other zones) | 1h/24h | ✅ Live |
| POST | `/api/narrative` | Claude Haiku 4.5 | 24h | ✅ Live |
| POST | `/api/regulatory` | Claude Sonnet 4.6 + web_search | Monthly | ✅ Live |
| POST | `/api/customer-signals` | Claude Sonnet 4.6 + web_search | Monthly | ✅ Live |

All non-auth `GET` routes serve `dist/index.html`; the catch-all redirects to `/auth/login` if no valid session is found (except `/auth/*` paths which are passed through directly).

---

## Data Sources

### ENTSO-E (`server/entso-e.js`)

- **Day-ahead prices NL** — document type A44, NL bidding zone `10YNL----------L`
- **Cross-market day-ahead prices** — same A44 document type, different bidding zones:
  - DE: `10Y1001A1001A82H` | BE: `10YBE----------2` | FR: `10YFR-RTE------C`
  - `fetchDayAheadPricesForZone(zone, startDate, endDate)` → `{ dailyAvg, hourlyAvg }` (CET timestamps)
  - `MARKET_ZONES` export maps zone codes: `{ DE, BE, FR }`
- **Actual generation** — document type A75, NL area, B19 (solar), B16/B18 (wind)
  - Now returns hourly data alongside daily: `{ solar, wind, solarHourly, windHourly }`
  - `solarHourly`/`windHourly`: `[{ timestamp: 'YYYY-MM-DDTHH:00' (CET), mw }]`
  - Cache salt bumped to `v2|` to bust old daily-only cached responses
- **Capacity prices** — document type A81/B95 (contracted reserves / procured capacity):
  - **aFRR** — `type_MarketAgreement.Type = A13` (4-hour block agreement). Returns a ZIP containing one XML per CET delivery day. Chunked in 8-day batches to stay under the 100-TimeSeries-per-request limit (12 series/day × 8 days = 96 < 100). Directions: `A01` = Up, `A02` = Down.
  - **FCR** — `type_MarketAgreement.Type = A01` (symmetric, 4-hour blocks). Chunked in 14-day batches (6 series/day × 14 days = 84 < 100).
  - Both return ZIP files containing multiple XMLs. `unzipAllXml()` parses every file in the archive to avoid missing delivery days (a common bug when only parsing the first file).
  - Capacity data includes both clearing price (EUR/MW/h) and procured quantity (MW) per 4-hour block.

### TenneT (`server/tennet.js`)

- **Base URL:** `https://api.tennet.eu/publications/v1`
- **Auth:** `apikey` header with `TENNET_API_KEY`
- **Date format:** API expects `DD-MM-YYYY 00:00:00`; uses exclusive end date (add 1 day to the inclusive endDate)
- **Rate limiting:** chunked into 1-month batches (API max range)
- **Retry logic:** 3 attempts with exponential backoff; retries on 429/500/502/503/504 and timeouts
- **Response:** 15-minute ISP resolution with CET local timestamps (`timeInterval_start`)

**Fetchers:**
- **`fetchImbalancePrices`** — settlement-prices → `{ daily, rawPoints }`. daily = daily avg mid price; rawPoints = 15-min `{ timestamp, midPrice }`. Cache salt `v2|`.
- **`fetchAFRRData`** — settlement-prices → raw 15-min `{ timestamp, afrrUpEnergyPrice, afrrDownEnergyPrice }` (dispatch_up / dispatch_down)
- **`fetchBalanceDelta`** — balance-delta endpoint → `[{ timestamp, balanceDelta (MW) }]`. Positive = system long, negative = system short. 15-min resolution. Cache: 1h/24h TTL.
- **`fetchFRRActivations`** — frr-activations endpoint → `[{ timestamp, activatedUpMw, activatedDownMw, settledReserveMw, emergencyEnergyMw }]`. 15-min resolution. Cache: 1h/24h TTL.
- **`fetchMeritOrderForDate(date)`** — merit-order endpoint (single day) → `{ date, ptus: [{ ptu: 1-96, curve: [{ cumVolume, price }] }] }`. Bids sorted ascending by price (supply curve). PTU 1 = 00:00, PTU 96 = 23:45. Cache: Redis key `merit-order:{YYYY-MM-DD}`, 7-day TTL.

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

### `/api/balance-delta` route

Returns: `[{ timestamp: 'YYYY-MM-DDTHH:MM:SS' (CET), balanceDelta: number (MW) }]`

Cache namespace: `market:balance-delta`. TTL: 1h for ranges including today, 24h for historical.

### `/api/frr-activations` route

Returns: `[{ timestamp, activatedUpMw, activatedDownMw, settledReserveMw, emergencyEnergyMw }]`

Cache namespace: `market:frr-activations`. TTL: 1h/24h.

### `/api/merit-order` route

Query param: `date=YYYY-MM-DD` (defaults to today).

Returns: `{ date, ptus: [{ ptu: 1-96, curve: [{ cumVolume: number, price: number }] }] }`

Cache: individual Redis keys `merit-order:{YYYY-MM-DD}`, 7-day TTL (historical merit order data never changes). The frontend requests one day at a time — no date range batching needed.

### `/api/cross-market-prices` route

Query params: `zone=DE|BE|FR`, `startDate`, `endDate`.

Returns: `{ dailyAvg: [{ date, avg }], hourlyAvg: [{ timestamp, avg }] }` (CET).

Cache namespace: `market:cross:{zone}`. TTL: 1h/24h.

---

## AI Models

| Function | Model | Notes |
|---|---|---|
| `generateDayAheadNarrative()` | `claude-haiku-4-5` | Per-section; plain string output |
| `generateBalancingNarrative()` | `claude-haiku-4-5` | Per-section; returns null if no imbalance data |
| `generateAncillaryNarrative()` | `claude-haiku-4-5` | Per-section; returns null if all sub-keys null |
| `generateRegulatoryWatch()` | `claude-sonnet-4-6` | Requires `web_search_20250305` tool — haiku doesn't support it |
| `generateCustomerSignals()` | `claude-sonnet-4-6` | Same — web search only works on Sonnet+ |

All three narrative functions share a `callHaiku()` helper in `claude.js` that handles the SDK call, strips code fences, and converts the literal string `"null"` to JS `null`.

`web_search_20250305` is Anthropic's built-in server-side tool. `max_uses: 4` per call (reduced from 8 for cost).

---

## Observability (LangSmith)

All three Claude functions in `server/claude.js` are wrapped with `traceable()` from the `langsmith` SDK. Route handlers in `server/index.js` have a parent `traceable()` wrapper that shows cache hits as zero-token traces.

**Prompt versions** are tracked in `server/prompts.js`:
```js
export const PROMPT_VERSIONS = {
  narrativeDayAhead:          'v1',  // bump when prompt changes — traces are filterable by version
  narrativeBalancing:         'v1',
  narrativeAncillaryServices: 'v1',
  regulatory:                 'v1',
  customerSignals:            'v1',
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
  - **Cross-market overlay**: when DE/BE/FR selected in toolbar, daily avg price lines overlaid on all resolutions (daily granularity, colour-coded per zone)
- **Negative price hours per week** — bar chart, X-axis shows ISO week numbers (W20, W21, …), solar curtailment risk signal
- **Generation Mix NL** — ComposedChart, stacked Areas + right-axis Line:
  - Solar (warm yellow `#f59e0b`) and wind (muted blue `#6b8db5`) stacked areas, MW on left Y-axis
  - DA average price line in cyan on right Y-axis (EUR/MWh)
  - Resolution: **1h** (uses solarHourly/windHourly from ENTSO-E A75) | **1d** (daily avg)
  - Drag-to-zoom via useZoom
- **Legend toggle on all three charts**

### Balancing (`BalancingSection`)
- **Imbalance Midprice NL** (EUR/MWh) — line chart from TenneT settlement-prices with **1h / 1d** resolution switcher (default 1d)
  - **1d** — pre-aggregated daily average mid price from `imbalance.daily`
  - **1h** — hourly average computed client-side from `imbalance.rawPoints` (15-min ISP data aggregated to 1h buckets by CET hour)
  - Mid price per ISP = `(dispatch_up + dispatch_down) / 2`; daily average = mean of all ISP mid prices that day
  - Red dashed zero reference line; legend toggle
- **System Balance Delta NL** (MW) — bar chart from TenneT balance-delta:
  - Bars colour-coded: green (`#4ade80`) for positive (system long), red (`#f87171`) for negative (system short)
  - Red dashed zero reference line
  - Resolution: **15m** (raw) | **1h** (hourly average)
  - Drag-to-zoom; legend toggle
  - Error state: N/A badge if TenneT endpoint unavailable

### Ancillary Services (`AncillaryServicesSection`)

**aFRR Capacity NL — Price & Volume** (`ComposedChart`):
- Source: ENTSO-E A81/B95 with A13 agreement type
- Default resolution: **4h blocks** (can switch to **1d** daily average)
- Y-axes: outer left for MW (capacity bars, width 52px), inner left for EUR/MW/h (price lines, width 65px — widened to prevent 4-digit label truncation)
- Left chart margin increased to 10px to accommodate wider axis
- Series: Up Capacity (MW bar), Down Capacity (MW bar), aFRR Up Price (line), aFRR Down Price (line)
- Compare mode adds dashed Prev. Up / Prev. Down lines; legend toggle

**FCR Capacity NL — Price & Volume** (`ComposedChart`):
- Source: ENTSO-E A81/B95 with A01 agreement type
- Default resolution: **4h blocks** (can switch to **1d**)
- Same dual-left-axis layout: MW bars + EUR/MW/h price line
- **Cross-market overlay**: when DE/BE/FR selected, daily avg price lines overlaid (colour-coded per zone)
- Legend toggle

**aFRR Energy Price NL — Up / Down (EUR/MWh)** (`ComposedChart`, was LineChart):
- Source: TenneT settlement-prices (energy) + TenneT frr-activations (volume)
- Resolution switcher: **15m** / **1h** / **1d** / **1w** (weekly aggregation added)
  - Weekly: energy prices averaged, activation volumes summed
- **FRR activation overlay**: activated up MW as muted green bars, activated down MW as muted red bars on a second left Y-axis. Only shown when frr-activations data is available.
- Source badge updates to "TenneT (energy + FRR)" when activation data present
- Compare mode adds dashed prev lines for energy prices only
- Legend toggle

**aFRR Merit Order NL — Bid Stack** (new, 4th chart):
- Source: TenneT merit-order (per-day fetch via `/api/merit-order?date=YYYY-MM-DD`)
- ComposedChart: X-axis = cumulative volume (MW), Y-axis = price (EUR/MW/h)
- **Primary curve**: bid stack for selected PTU on selected day — cyan step line
- **Average curve**: average bid stack for same PTU slot across sample days from selected range — muted dashed step line
- **Clearing price**: horizontal reference line at last bid price for selected PTU
- **Tightness indicator** in chart header: "Bid depth above clearing: X MW vs Y MW avg" — X in green if above avg, amber if below
- **Date selector**: back/forward arrows + date input; changing date reloads primary curve for PTU 1
- **PTU scrubber**: 96 clickable slots (15-min each), highlighted active slot, hour labels at 00:00/06:00/12:00/18:00/24:00
- **Tooltip**: at hovered volume — Today price, Period avg price, Delta
- Loading state: skeleton while fetching; N/A badge if TenneT unavailable

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

Multi-agent architecture: each chart section has its own independent Generate button, Haiku call, cache entry, and prompt. Generating one section never triggers or invalidates another.

**Trigger flow:**
1. User clicks Generate on a section → `ChartsPanel` calls `buildNarrativePayload(data, startDate, endDate)` to build the full payload
2. `fetchSectionNarrative(section, fullPayload, systemPrompt, startDate, endDate, forceRefresh)` is called for that section only
3. Client checks `sectionNarrativeCache`; on miss, POSTs to `/api/narrative` with `{ section, sectionData: fullPayload, ... }`
4. Server routes to the matching generator (`generateDayAheadNarrative` / `generateBalancingNarrative` / `generateAncillaryNarrative`) via `NARRATIVE_GENERATORS[section]`
5. Generator reads only its relevant keys from `sectionData`; calls `callHaiku()`
6. Returns a plain string, or the JS literal `null` if no data

**API contract (`POST /api/narrative`):**
```js
// Request body
{
  section:      'dayAhead' | 'balancing' | 'ancillaryServices',
  sectionData:  object,   // full buildNarrativePayload() output — server reads only what it needs
  systemPrompt: string?,  // overrides the default prompt for this section
  startDate:    string?,  // YYYY-MM-DD
  endDate:      string?,  // YYYY-MM-DD
  forceRefresh: boolean?, // bypasses both client and server cache
}

// Response
{ ok: true, narrative: string | null, fromCache: boolean, cachedAt: ISO-string }
```

**Return value per section:** a single plain string — the summary text. Not a JSON object. `callHaiku()` converts the literal model output `"null"` to JS `null`. `null` → "No data available for this section."; `undefined` → block not yet generated (hidden).

**`buildNarrativePayload()` output — exact shape sent as `sectionData`:**
```js
{
  period: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' },

  // ── Day-Ahead section accesses these keys ─────────────────────────────────
  dayAheadPrice: {
    avgEurMwh:    number | null,   // period mean of daily averages
    highEurMwh:   number | null,   // period max of daily highs
    lowEurMwh:    number | null,   // period min of daily lows
    rangeEurMwh:  number | null,   // highEurMwh − lowEurMwh
    negativeHours: number,         // sum of all negative-price hours in period
    dailyHLA: [{ date: 'YYYY-MM-DD', avg: number, high: number, low: number, negativeHours: number }],
    bestArbitrageWindow: {         // null when no negative-price days in period
      date: 'YYYY-MM-DD',
      chargeWindow:    { startHour: number, endHour: number, avgPrice: number }, // EUR/MWh; contiguous block where avg < 0
      dischargeWindow: { startHour: number, endHour: number, avgPrice: number }, // EUR/MWh; highest-avg 3-h block after charge (falls back to 1 h)
      spread: number,              // dischargeWindow.avgPrice − chargeWindow.avgPrice (EUR/MWh)
    } | null,
  },
  negativeHoursPerWeek: [{ week: 'YYYY-MM-DD', count: number }],

  // ── Balancing section accesses these keys ─────────────────────────────────
  balancing: {                     // null when imbalance.daily is empty for the period
    avgMidPriceEurMwh:  number,    // mean of daily mid prices
    highMidPriceEurMwh: number,    // max daily mid price
    lowMidPriceEurMwh:  number,    // min daily mid price
    rangeEurMwh:        number,    // high − low
    daily: [{ date: 'YYYY-MM-DD', midPrice: number }],
  } | null,

  // ── Ancillary section accesses these keys ─────────────────────────────────
  ancillaryServices: {             // null when all three sub-arrays are empty for the period
    afrrEnergy: {                  // null when afrrEnergyRaw is empty for the period
      avgUpEurMwh:   number,       // mean of afrrUpEnergyPrice (15-min TenneT points)
      avgDownEurMwh: number,       // mean of afrrDownEnergyPrice
    } | null,
    afrrCapacity: {                // null when afrrHourly is empty for the period
      avgUpPriceEurMwPerH:   number,  // mean of afrrCapacityUpPrice (4-h ENTSO-E blocks)
      avgDownPriceEurMwPerH: number,  // mean of afrrCapacityDownPrice
      avgUpMW:               number,  // mean of afrrCapacityUpMW
      avgDownMW:             number,  // mean of afrrCapacityDownMW
    } | null,
    fcr: {                         // null when fcrHourly is empty for the period
      avgPriceEurMwPerH: number,   // mean of price (4-h ENTSO-E blocks)
      avgCapacityMW:     number,   // mean of capacityMW
    } | null,
  } | null,
}
```

`hourlyHLAForNegativeDays` is computed in `buildNarrativePayload()` to derive `bestArbitrageWindow` but is intentionally excluded from the returned object to keep the POST body small.

**Per-section prompts (`server/prompts.js`):**

| Prompt constant | Section | Output |
|---|---|---|
| `NARRATIVE_PROMPT_DAY_AHEAD` | Day-Ahead | 2–3 sentences; plain string |
| `NARRATIVE_PROMPT_BALANCING` | Balancing | 2 sentences; plain string; literal `"null"` if `balancing` is null |
| `NARRATIVE_PROMPT_ANCILLARY` | Ancillary | 1–2 sentences; plain string; literal `"null"` if all sub-keys are null |

Prompt versions tracked individually in `PROMPT_VERSIONS` in `server/prompts.js`.

**Client-side cache (`sectionNarrativeCache` in `src/data/index.js`):**
- Session-scoped — no TTL; persists until page reload
- Key format: `${section}|${startDate}|${endDate}|${systemPrompt}`
- Each section cached independently; generating Day-Ahead does not affect the Balancing or Ancillary entries
- `forceRefresh = (narratives[section] !== undefined)` in `ChartsPanel` — first Generate uses `false`; every subsequent click (Regenerate) uses `true`, bypassing both client and server caches

**Server-side cache (`researchCache.js`):**
- Namespace per section: `narrative:dayAhead`, `narrative:balancing`, `narrative:ancillaryServices`
- TTL: 24 hours (fixed — `NARRATIVE_TTL = 24 * 60 * 60`)
- Fingerprint: `JSON.stringify({ startDate, endDate, prompt: systemPrompt ?? '' })`

**Stale warning:** Each section tracks its own `generatedDatesMap[section]`. The "⚠ Date range changed" chip appears independently per section when `generatedDatesMap[section].startDate/endDate` diverges from the current date range.

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

## Authentication

WorkOS User Management with magic link email flow. No passwords.

**Flow:**
1. User visits any route → catch-all checks session cookie → redirects to `/auth/login` if missing
2. User enters email on Login page → POST `/auth/magic-link` → WorkOS sends email with link
3. User clicks link → WorkOS calls `APP_BASE_URL/auth/callback?code=...`
4. Server exchanges code for user object → writes session to Redis (key `session:{uuid}`, TTL 7 days) → sets `eml_session` cookie → redirects to `/`
5. `AuthGate.jsx` fetches `/api/auth/me` on mount → provides user via `AuthContext` → `useUser()` hook reads it

**Access control:** Un-provisioned users (not in the WorkOS dashboard) get a 403 from `/auth/magic-link` and are redirected to `/auth/unauthorised`. To grant access: add the user in the WorkOS dashboard.

**Session storage:** Redis at key `session:{sessionId}` with 7-day TTL. Falls back to in-memory Map when `REDIS_URL` is unset (development). Independent Redis connection in `auth.js` — does not share `researchCache.js`'s connection.

**Cookie:** `eml_session` — httpOnly, SameSite=Strict, Secure only in production (`NODE_ENV=production`).

**Profile avatar:** Cyan circle in the header showing the user's initial. Click → dropdown with email + Sign Out button. Sign Out hits `/auth/logout` which deletes the session and clears the cookie.

**Server setup (manual, one-time):**
1. Create a WorkOS account and organisation
2. Enable "Magic Auth" in User Management → Authentication Methods
3. Set Redirect URI to `{APP_BASE_URL}/auth/callback` (e.g. `https://energy-market-lens.up.railway.app/auth/callback`)
4. Add users in User Management → Users (only listed users can authenticate)
5. Copy `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` to env

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

**Per-section narrative agents**: Three independent Haiku calls (one per market section) replace a single combined call. Each section has its own cache namespace, stale indicator, and Generate button. Sections can be regenerated independently — generating Day-Ahead does not bust or block the Balancing cache.

**Errors propagate to Claude**: `buildNarrativePayload()` sets `balancing` and `ancillaryServices` to `null` when their source data is empty. Each narrative prompt instructs Haiku to return the literal string `"null"` in that case; `callHaiku()` converts it to JS `null`, which renders as "No data available for this section." Never fabricates.

**Lazy Anthropic client**: SDK client created on first use so a missing API key doesn't crash the server on startup.

**Single-container deployment**: Vite builds to `dist/`, Express serves it as static files. Same process, same port, no Nginx. Vite dev proxy is conditional — disabled in production since frontend and backend share the same origin.

**Shared Redis cache**: Both market data and research results use the same Redis store. Market data is keyed by source + date range with a 1h/24h TTL; research results are keyed by month + config fingerprint. All users share the same cache — a team of 10 pays for one ENTSO-E fetch and one Sonnet call per cache window, not ten.

**Negative price fix**: ENTSO-E XML parser regex uses `[-\d.]+` (not `[\d.]+`) so negative prices are correctly captured. All CET bucketing uses `Europe/Amsterdam` locale formatters, not UTC, to correctly handle NL delivery days.

**ENTSO-E ZIP multi-file parsing**: Each ENTSO-E capacity price response is a ZIP containing one XML per CET delivery day. `unzipAllXml()` iterates all entries — parsing only the first file (alphabetically the earliest day) was a bug that made FCR data appear to start on Jan 5 instead of Jan 1.

**aFRR capacity chunking**: ENTSO-E limits responses to 100 TimeSeries per request. aFRR A13 produces 12 series/day (6 blocks × 2 directions), so requests are chunked in 8-day batches (96 < 100). FCR A01 produces 6 series/day and is chunked in 14-day batches.
