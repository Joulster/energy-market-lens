# Energy Market Lens — Project Context

## What This Is

A full-stack dashboard for monitoring Dutch energy markets, built for a **Head of Product at a VPP (Virtual Power Plant) software company**. The goal is to empathise with the company's user base — traders, asset managers, quants — by surfacing the key market signals they care about daily.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite 5, Recharts, plain CSS |
| Backend | Express (Node 18+, ESM), port 3001 |
| AI | `@anthropic-ai/sdk` — Claude Opus 4.7 (narrative) + Claude Sonnet 4.6 (regulatory/customer signals search) |
| Dev proxy | Vite proxies `/api/*` → `http://localhost:3001` |

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
```

---

## Architecture

### Frontend (`src/`)

```
src/
  App.jsx                          # Root — loads all market data, passes to panels
  App.css                          # Single dark-theme stylesheet
  main.jsx                         # Vite entry
  data/
    index.js                       # loadAllMarketData(), aggregateWeeklySummary(), fetchNarrative()
    defaultPrompts.js              # Client-side copies of all 3 system prompts (with placeholders) for Reset
  components/
    ChartsPanel/index.jsx          # Left panel (75%) — renders the 3 market sections
    NarrativePanel.jsx             # Right panel (25%) — Regulatory Watch + Customer Signals + prompt editor
    RegulatoryWatch.jsx            # Regulatory Watch component (self-contained, accepts regulatoryPrompt prop)
    CustomerSignals.jsx            # Customer Signals component (self-contained, accepts customerSignalsPrompt prop)
    PromptEditorModal.jsx          # 3-tab modal for editing system prompts (narrative/regulatory/customerSignals)
    charts/
      shared.jsx                   # COLORS, ChartWrap, SourceBadge, fmtDate, chartProps
      DayAheadSection.jsx          # 4 charts: daily avg, hourly shape heatmap, spread, negative hours
      BalancingSection.jsx         # 2 charts: imbalance midprice, weekly std dev volatility
      AncillaryServicesSection.jsx # 3 charts: aFRR capacity, FCR clearing, aFRR energy up/down
```

**Layout:** Fixed header, then a flex row — charts panel (left 75%, scrollable) + narrative panel (right 25%, sticky).

**Data flow:**
1. `App.jsx` calls `loadAllMarketData()` on mount — fires 4 parallel API calls
2. Passes `{ dayAhead, generation, imbalance, afrr, errors }` to both panels
3. Each chart section receives its slice + `errors` to show real vs mock badge
4. ChartsPanel's Generate Summary button calls `aggregateWeeklySummary()` then `POST /api/narrative` for the AI Market Summary
5. Regulatory Watch calls `POST /api/regulatory` independently

### Backend (`server/`)

```
server/
  index.js      # Express app, all routes
  entso-e.js    # ENTSO-E Transparency Platform API (A44, A75, A73, A85)
  tennet.js     # TenneT API (imbalance midprice only — currently 404, token pending)
  claude.js     # generateNarrative(), generateRegulatoryWatch(), generateCustomerSignals()
  prompts.js    # Central store for all 3 system prompts (NARRATIVE_PROMPT, REGULATORY_PROMPT, CUSTOMER_SIGNALS_PROMPT)
  mockData.js   # Seeded mock data (kept for reference, no longer used as fallback)
```

**Routes:**
| Method | Path | Source | Status |
|---|---|---|---|
| GET | `/api/day-ahead-prices` | ENTSO-E A44 | ✅ Live |
| GET | `/api/actual-generation` | ENTSO-E A75 | ✅ Live |
| GET | `/api/imbalance-prices` | TenneT CSV | ❌ 404 — token pending |
| GET | `/api/afrr` | ENTSO-E A73/A85 | ❌ TenneT NL doesn't publish to ENTSO-E TP |
| POST | `/api/narrative` | Claude Opus 4.7 | ✅ Live |
| POST | `/api/regulatory` | Claude Sonnet 4.6 + web_search | ✅ Live |
| POST | `/api/customer-signals` | Claude Sonnet 4.6 + web_search | ✅ Live |

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
- Lives in ChartsPanel — each of the three chart sections (Day-Ahead, Balancing, Ancillary Services) shows its own summary block directly below its charts
- One **Generate Summary** button in the ChartsPanel toolbar triggers a single Claude call that populates all three blocks simultaneously
- Toolbar also has a **date range picker** (From/To date inputs, default: last 7 days)
- Timestamp "Last generated: [time]" appears below the button after first generation
- `aggregateWeeklySummary(data, startDate, endDate)` slices data to the selected range
- Sends to **Claude Opus 4.7** with adaptive thinking; returns `{ dayAhead, balancing, ancillaryServices }`
- Persona: market analyst briefing a VPP software product team; hybrid plant focus; 300-word limit
- Summary blocks show "AI Summary" label in muted small caps, text below; `null` → "No data available for this section."; `undefined` → block hidden (not yet generated)
- `systemPrompt` passed from `App.jsx` `promptSettings.narrative` so PromptEditorModal edits are respected

### Regulatory Watch
- **Gear icon** opens a settings panel — 7 NL-focused default sources (ACM, TenneT, ENTSO-E, Netbeheer NL, RVO, EU Commission Energy, ACER), each with toggle
- **Add source** appends new entries to the list
- Calls **Claude Sonnet 4.6 + `web_search_20250305`** tool (up to 8 searches)
- 90-day lookback window; today's date + cutoff injected into prompt for accurate recency filtering
- Claude instructed to include year/month in queries and exclude undated items
- Response: JSON array of `{ change, implication, date, source }`
- Default view shows top 3 items; "Show all N" toggle expands
- JSON parse failure falls back to `<pre>` raw text display

### Customer Signals
- **Gear icon** opens a settings panel with 4 sections: Sources, Companies to Watch, Topics, Lookback Window
- 8 default sources (NL-focused): Recharge News, Energy Monitor, PV Tech, Energy Storage News, Enlit Europe, WindEurope, Energeia NL, New Energy Coalition
- 13 seeded companies: Statkraft, Engie, Axpo, RWE, Vattenfall, Orsted, Entrix, Flower, Sympower, EDF, E.ON, Alliander, Elia
- 8 seeded topics: battery storage, aFRR, flexibility markets, hybrid power plants, VPP software, ancillary services, grid flexibility, demand response
- Lookback: default 90 days, min 30, max 180
- Calls **Claude Sonnet 4.6 + `web_search_20250305`** (up to 8 searches, max_tokens 4000)
- Response: JSON array of `{ signal, context, implication, source }`
- Two-stage JSON parse: full array match first, then per-object regex recovery for truncated responses
- Default view shows top 3 items; "Show all N" toggle expands

### Configurable Prompts
- **Pencil button (✏)** in panel toolbar opens a 3-tab modal (Market Outlook / Regulatory Watch / Customer Signals)
- Amber dot on pencil button + modified tabs when prompt differs from default
- Each tab: 14-row textarea, Save button, Reset button (restores default from `src/data/defaultPrompts.js`)
- All three `generate*()` functions accept `systemPromptOverride` — custom prompt replaces default if set
- `server/prompts.js` is the single source of truth; `src/data/defaultPrompts.js` mirrors for client Reset

---

## Data Source Status & Roadmap

### Working now
- ENTSO-E day-ahead prices (A44) — NL bidding zone `10YNL----------L`
- ENTSO-E actual generation (A75) — solar (B19), wind (B16/B18)

### Pending TenneT developer API token
TenneT migrated from file-based CSVs to a new authenticated REST API. Registration submitted; token expected within 1–2 days of registration.

Once token arrives, wire up in `server/tennet.js`:
- **Imbalance midprice** — currently 404 on old CSV path
- **aFRR capacity prices** — TenneT-only, not on ENTSO-E TP (confirmed: ENTSO-E returns error 999)
- **FCR clearing prices** — TenneT-only
- **aFRR energy up/down prices** — TenneT-only

### Known non-issue
ENTSO-E A73/A85 returns error code 999 ("no matching data") for NL — this is expected. TenneT NL does not submit balancing capacity/energy procurement data to ENTSO-E Transparency Platform.

---

## Key Design Decisions

**Market-based chart grouping** (not asset-type): Charts are grouped by market (Day-Ahead / Balancing / Ancillary Services) rather than by asset (Battery / Solar / Wind). This matches how traders and asset managers think about the market.

**No mock data fallbacks**: Mock data was removed so the dashboard shows honest data availability. Failed sources surface as error states with amber badges, not silently as fake numbers.

**Source badges on every chart**: Each chart shows a green "ENTSO-E · real" or amber "TenneT · error" badge so the data provenance is always visible.

**Errors propagate to Claude**: `aggregateWeeklySummary()` passes the `errors` object alongside the data. Claude is told which sources are unavailable and instructed not to fabricate values for them — returning `null` for those sections instead.

**Lazy Anthropic client**: The SDK client is created on first use, not at import time, so a missing API key doesn't crash the server on startup.
