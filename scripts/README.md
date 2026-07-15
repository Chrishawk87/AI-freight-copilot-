# Railway deploy scripts

Three small scripts to push AI Freight Co-Pilot to Railway. Run them from the
project root (they `cd` themselves correctly either way).

| Script | What it does | When to use |
|--------|--------------|-------------|
| `push.sh` | Commits everything and `git push`es `main`. Railway auto-deploys both services. | Your normal deploy. |
| `railway-up.sh` | Deploys straight from your machine with the Railway CLI, no GitHub round-trip. | Quick manual deploy / when GitHub is out of the loop. |
| `railway-set-env.sh` | Pushes env vars (keys, usage caps, URLs) to the services. Only sets what you've exported — no secrets in the repo. | First setup and any time keys/caps change. |

## First-time setup

```bash
npm i -g @railway/cli     # install CLI (for the last two scripts)
railway login
railway link              # pick your project once, in this folder

chmod +x scripts/*.sh     # make the scripts runnable (one time)
```

## Turn AI on for every subscriber

The whole point of the server-key model: set these two on the **backend** service
and every driver gets scanning + the Claude Co-Pilot with nothing to plug in.

```bash
export ANTHROPIC_API_KEY="sk-ant-…"   # company Claude key
export OCR_API_KEY="…"                # company Mindee key
export USAGE_OCR_MONTHLY_CAP="500"    # optional: cap company-paid scans / carrier / month
export USAGE_LLM_MONTHLY_CAP="2000"   # optional: cap company-paid Co-Pilot replies
./scripts/railway-set-env.sh
```

Then deploy:

```bash
./scripts/push.sh "enable server-side AI + usage metering"
```

See `../DEPLOY.md` for the full first-time Railway project walkthrough (services,
Postgres, CORS, domains).
