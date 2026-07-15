# Deploying AI Freight Co-Pilot to GitHub + Railway

This app is a monorepo with three pieces that run as **three Railway services** in one project:

| Piece | Folder | Railway service |
|-------|--------|-----------------|
| Frontend (Next.js) | repo root `/` | web service |
| Backend API (NestJS) | `/server` | web service |
| Database (PostgreSQL) | — | Railway Postgres plugin |

Everything is already wired for this. You just push the code and click through Railway.

---

## Step 1 — Push to GitHub

The repo is already initialized and committed locally on the `main` branch. You just need to create an empty GitHub repo and push to it.

1. Go to https://github.com/new
2. Name it (e.g. `ai-freight-copilot`). **Do NOT** add a README, .gitignore, or license — leave it empty.
3. Click **Create repository**. Copy the URL it shows (e.g. `https://github.com/YOURNAME/ai-freight-copilot.git`).
4. In a terminal, from the project folder, run:

```bash
cd "/Users/christopherhawkins/Desktop/AI Freight Co-pilot"
git remote add origin https://github.com/YOURNAME/ai-freight-copilot.git
git push -u origin main
```

If it asks you to sign in, use your GitHub username and a **Personal Access Token** as the password (GitHub no longer accepts your account password on the command line — create a token at https://github.com/settings/tokens if you don't have one).

---

## Step 2 — Create the Railway project

1. Go to https://railway.app and sign in.
2. **New Project → Deploy from GitHub repo** → pick the repo you just pushed.
3. Railway will create one service from the repo. We'll shape it into three below.

### 2a. Add the database first

- In the project, click **New → Database → Add PostgreSQL**.
- That's it — Railway creates a `Postgres` service with a `DATABASE_URL` you'll reference.

### 2b. Configure the BACKEND service

Rename the auto-created service to `backend` (or add **New → GitHub Repo → same repo** if you need a second one), then in its **Settings**:

- **Root Directory:** `server`
- Railway auto-detects the build/start from `server/railway.json` (build `npm run build`, start `npm run start:railway`). No manual command needed.

In the backend service **Variables**, add:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}`  ← reference the Postgres service |
| `JWT_SECRET` | a long random string (run `openssl rand -base64 48`) |
| `JWT_EXPIRES_IN` | `7d` |
| `CORS_ORIGIN` | *(fill in after Step 2c — the frontend URL)* |

Under **Settings → Networking**, click **Generate Domain**. Copy the URL — e.g. `https://backend-production-xxxx.up.railway.app`. Your API base is that URL **plus `/api`**.

### 2c. Configure the FRONTEND service

Add **New → GitHub Repo → same repo** for the frontend, then in its **Settings**:

- **Root Directory:** `/` (repo root)
- Auto-detected from root `railway.json` (build `npm run build`, start `npm run start`).

In the frontend service **Variables**, add:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://backend-production-xxxx.up.railway.app/api` (from 2b, **with `/api`**) |

> ⚠️ `NEXT_PUBLIC_*` variables are baked in at **build time**. If you change this later you must **redeploy** the frontend for it to take effect.

Under **Settings → Networking**, **Generate Domain**. Copy the frontend URL.

### 2d. Close the loop (CORS)

Go back to the **backend** service Variables and set:

- `CORS_ORIGIN` = your frontend URL (no trailing slash), e.g. `https://frontend-production-yyyy.up.railway.app`

Redeploy the backend. Done.

**Order matters:** backend URL is needed to build the frontend; frontend URL is needed for backend CORS. So: deploy backend → get its URL → set frontend var + deploy frontend → get its URL → set backend `CORS_ORIGIN` → redeploy backend.

---

## What happens on each deploy

The backend start command (`npm run start:railway`) automatically:

1. `prisma db push` — syncs the schema to Postgres (creates tables on first deploy).
2. Seeds the demo carrier, demo user (`demo@aifreight.co` / `demo1234`), loads, and fuel stations. The seed is idempotent — it won't duplicate or wipe existing data.
3. Starts the API.

---

## Local development after the Postgres switch

Prisma is now locked to PostgreSQL, so the old local SQLite file no longer works. Easiest path (no local Postgres install):

1. In Railway, open the **Postgres** service → **Connect** → copy the **Public** connection URL.
2. Put it in `server/.env` as `DATABASE_URL`.
3. Run the backend as usual (`npm run dev` in `server/`).

Your local machine and production then share the same database. (If you'd rather keep them separate, install Postgres locally or run `docker run -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres` and point `DATABASE_URL` at it.)

---

## About the Play Store

Railway gets you a live, public web app — a real prerequisite — but it is **not** the Play Store step. The Play Store ships Android app bundles. To get there you'll wrap this web app as an Android app, most likely via a **Trusted Web Activity (TWA)** using Bubblewrap, or with **Capacitor**. You'll also need a one-time **Google Play Developer account ($25)**. That's a separate task we can tackle once the app is live on Railway.

---

## Troubleshooting

- **Frontend loads but every action fails / "Failed to fetch":** `NEXT_PUBLIC_API_URL` is wrong or missing the `/api` suffix, or the frontend wasn't redeployed after setting it.
- **CORS error in the browser console:** `CORS_ORIGIN` on the backend doesn't exactly match the frontend URL (check for a trailing slash or http vs https).
- **Backend crash-loops on deploy:** check the Postgres `DATABASE_URL` is set and referenced correctly; view the deploy logs in Railway.
- **`prisma db push` fails asking to accept data loss:** a schema change is destructive. Don't force it against real data — that's the signal to move to proper migrations (`prisma migrate`).
