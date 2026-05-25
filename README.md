# Energy Market Lens

A full-stack dashboard for monitoring Dutch energy markets in real time. Built for product managers at VPP and energy software companies who want to stay close to the markets their customers operate in — covering day-ahead prices, balancing markets, and ancillary services, with AI-generated market summaries, regulatory monitoring, and customer signal tracking.

---

## Features

### Market Charts
- **Day-Ahead Price NL** — 15-minute, hourly, and daily resolution switcher; line chart for 15m, High/Low/Average range bars for 1h and 1d; drag-to-zoom on all charts
- **Negative Price Hours per Week** — ISO week-labelled bar chart for solar curtailment risk
- **Balancing & Ancillary Services** — imbalance midprice, price volatility, aFRR/FCR prices (live once TenneT token arrives)

### Compare Previous Period
Overlay the equivalent prior period on any chart with a single toggle. Tooltips show current value + delta for every metric.

### AI Market Summary
One-click Claude-generated narrative covering Day-Ahead, Balancing, and Ancillary Services based on the selected date range.

### Regulatory Watch
AI-powered monitoring of Dutch energy regulation (ACM, TenneT, ENTSO-E, Netbeheer NL, RVO, EU Commission). Returns structured change/implication pairs, cached monthly in Redis.

### Customer Signals
Tracks sentiment and news across VPP vendors, grid operators, and industrials. Configurable companies, topics, and lookback window. Also Redis-cached monthly.

### Configurable Prompts
Edit the system prompts for all three AI features directly in the UI via a modal editor. Changes persist per session; a Reset button restores defaults.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite 5, Recharts, plain CSS |
| Backend | Express (Node 18+, ESM) |
| AI | Anthropic SDK — Claude Haiku 4.5 + Claude Sonnet 4.6 |
| Data | ENTSO-E Transparency Platform API, TenneT REST API (pending) |
| Cache | Redis (ioredis) — monthly cache; in-memory fallback for local dev |
| Deployment | Docker on Railway — single container, Express serves built frontend |

---

## Getting Started

### Prerequisites
- Node.js 18+
- An [ENTSO-E API key](https://transparency.entsoe.eu/usrm/user/myAccountSettings) (free registration)
- An [Anthropic API key](https://console.anthropic.com/)

### Installation

```bash
git clone https://github.com/Joulster/energy-market-lens.git
cd energy-market-lens
npm install
```

### Environment variables

Create a `.env` file in the project root:

```env
ANTHROPIC_API_KEY=sk-ant-...
ENTSOE_API_KEY=<your-entsoe-uuid>
# REDIS_URL is optional — omit it locally and the cache falls back to in-memory
```

### Running locally

```bash
# Option A — single command (starts both server and Vite dev server)
npm run dev

# Option B — separate terminals
node server/index.js       # backend on :3001
npx vite                   # frontend on :5173
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies all `/api/*` calls to the Express backend.

---

## Deployment (Railway)

The project ships as a single Docker container — Express serves the built Vite frontend from `dist/` on the same port.

```bash
npm run build   # outputs to dist/
node server/index.js
```

Railway environment variables needed: `ANTHROPIC_API_KEY`, `ENTSOE_API_KEY`, `PORT` (Railway injects this). Add a Redis service and Railway will inject `REDIS_URL` automatically.

---

## Data Sources

| Source | What | Status |
|---|---|---|
| ENTSO-E A44 | Day-ahead prices (NL bidding zone) | ✅ Live |
| ENTSO-E A75 | Actual generation — solar, wind | ✅ Live |
| TenneT REST API | Imbalance midprice | ⏳ Token pending |
| TenneT REST API | aFRR & FCR capacity/energy prices | ⏳ Token pending |

> **Note:** ENTSO-E A73/A85 (balancing capacity/energy) returns no data for NL — TenneT NL does not publish to the ENTSO-E Transparency Platform. All balancing and ancillary services data requires a direct TenneT API token.

---

## Project Structure

```
├── server/
│   ├── index.js          # Express app and all API routes
│   ├── entso-e.js        # ENTSO-E API client and XML parsers
│   ├── tennet.js         # TenneT API client (pending)
│   ├── claude.js         # AI generation functions
│   ├── prompts.js        # System prompts (single source of truth)
│   └── researchCache.js  # Redis/in-memory cache
├── src/
│   ├── App.jsx           # Root component
│   ├── App.css           # Dark-theme stylesheet
│   ├── data/
│   │   ├── index.js      # Data loading and aggregation
│   │   ├── dateRange.js  # Date range options and helpers
│   │   └── defaultPrompts.js
│   └── components/
│       ├── ChartsPanel/
│       ├── NarrativePanel.jsx
│       ├── RegulatoryWatch.jsx
│       ├── CustomerSignals.jsx
│       └── charts/
│           ├── shared.jsx
│           ├── useZoom.js
│           ├── DayAheadSection.jsx
│           ├── BalancingSection.jsx
│           └── AncillaryServicesSection.jsx
├── Dockerfile
└── CLAUDE.md             # Architecture reference for AI-assisted development
```

---

## License

MIT
