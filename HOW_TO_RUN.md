# AI Freight Co-Pilot — How to Run

A working full-stack app: a **NestJS + Prisma API** (real database, JWT auth, load
scoring, connector layer for load boards) and a **Next.js** front end wired to it.
Every button hits the real backend — sign up, log in, browse scored loads, book,
bid, save your carrier profile, and ask the dispatcher.

Everything runs locally with **zero cloud setup** — the database is SQLite by default.

---

## Prerequisites

- **Node.js 18+** and npm (check with `node -v`)
- macOS, Linux, or Windows

---

## First-time setup (once)

Open a terminal in this project folder.

### 1. Backend

```bash
cd server
npm install
npm run setup        # generates the Prisma client, creates the SQLite DB, seeds demo data
```

`npm run setup` does three things:
- `prisma generate` — builds the typed database client
- `prisma db push` — creates `server/dev.db` with all tables
- seeds a demo carrier, a demo login, ~20 loads, and fuel stations

> If `prisma generate` can't reach the internet the first time, just run
> `npm run setup` again once you're online — it needs to download the query
> engine only once.

### 2. Front end

```bash
cd ..          # back to the project root
npm install
```

---

## Running the app (every time)

You need **two terminals** — one for the API, one for the web app.

**Terminal 1 — API (port 4000):**
```bash
cd server
npm run dev
```
Wait for: `AI Freight Co-Pilot API running on http://localhost:4000/api`

**Terminal 2 — Web app (port 3000):**
```bash
npm run dev
```
Open **http://localhost:3000**

---

## Logging in

A demo account is seeded and pre-filled on the login screen:

- **Email:** `demo@aifreight.co`
- **Password:** `demo1234`

Or click **Create an account** to register a brand-new carrier — each signup gets
its own carrier profile and its own data.

---

## What actually works

- **Auth** — real registration + login, JWT tokens, protected routes.
- **Opportunity Center** — loads pulled from the API, scored server-side, filter by
  equipment, sort by profit / RPM / deadhead.
- **Profitability Engine** — true-cost breakdown (fuel + fixed cost) per load, using
  your carrier's MPG and cost-per-mile.
- **Book / Bid** — the buttons on every load card POST to the API and persist.
- **Deadhead Prevention** — reload pool filtered by radius.
- **Fuel Intelligence** — station prices from the API + savings calculator.
- **AI Dispatcher** — natural-language queries answered against your live data.
- **Company Profile** — edit MPG, cost-per-mile, insurance, service areas → **Save**
  writes back to the database and re-scores your loads.

---

## Connecting real load boards later

The backend is built around a **connector layer** (`server/src/integrations`). Today
it runs a `SimulatedProvider` so everything works offline. To go live, drop your keys
into `server/.env` (see `server/.env.example`):

```
DAT_API_KEY=...
TRUCKSTOP_API_KEY=...
UBER_FREIGHT_API_KEY=...
MAPBOX_TOKEN=...
```

When a key is present, its provider activates automatically and the simulated feed
steps aside — no code changes needed.

---

## Going to production (Postgres)

For thousands of drivers, switch from SQLite to PostgreSQL:

1. In `server/prisma/schema.prisma`, change the datasource:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
2. Set `DATABASE_URL` in `server/.env` to your Postgres connection string.
3. Run `npm run setup` again.

Nothing else changes — the app code is database-agnostic.

---

## Ports & config

| Service   | URL                          | Change it in            |
|-----------|------------------------------|-------------------------|
| Web app   | http://localhost:3000        | `npm run dev` (Next.js) |
| API       | http://localhost:4000/api    | `server/.env` → `PORT`  |

The front end calls the API at `http://localhost:4000/api` by default. To point it
elsewhere, set `NEXT_PUBLIC_API_URL` before `npm run dev`.
