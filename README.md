# AI Freight Co-Pilot

The AI Operating System for Commercial Transportation — Phase 1 MVP prototype.

Built with Next.js 14 (App Router), TypeScript, and Tailwind CSS, styled to the PRD
design system (Midnight Navy `#0B1020` / Electric Blue `#246BFD`, Inter typeface).

## Run it

You need [Node.js 18+](https://nodejs.org). From this folder:

```bash
npm install
npm run dev
```

Then open http://localhost:3000

To build for production:

```bash
npm run build && npm start
```

## What's included (all 7 Phase 1 MVP modules)

| Route | Module |
|-------|--------|
| `/` | Fleet Command Center — weekly P&L, quick actions, top-ranked loads |
| `/loads` | Unified Opportunity Center — all equipment categories, one ranked feed |
| `/profit` | Profitability Engine — 5-score breakdown + true-cost P&L + Accept/Consider/Avoid |
| `/dispatcher` | AI Dispatcher — chat that finds loads, reloads, fuel, drafts bids, reports earnings |
| `/reloads` | Deadhead Prevention — reload search by 25/50/100/150/200 mi radius |
| `/fuel` | Fuel Intelligence — cheapest on-route/nearby diesel + savings calculator |
| `/navigation` | Profit Navigation — truck-legal route settings + trip P&L + reload probability |
| `/profile` | Company Profile Builder — carrier packet, compliance, drivers, equipment |

## How it works

Everything runs on **realistic mock data** (`src/lib/data.ts`) and a real
**profitability scoring engine** (`src/lib/scoring.ts`) that computes Profit,
Deadhead, Reload, Market Demand, and Fuel Impact scores from load economics
(rate, miles, deadhead, MPG, diesel price, fixed cost/mile).

This is the front-end foundation. The next steps toward the full PRD are wiring the
scoring engine to live load-board APIs (DAT, Truckstop, Uber Freight), a NestJS +
PostgreSQL backend, and the voice + automation engines.
