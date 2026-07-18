# Truckstop live load feed — setup

The Truckstop provider (`server/src/integrations/truckstop.provider.ts`) is a
real, credential-gated integration against Truckstop's documented carrier
**LoadSearch** SOAP service. It stays dormant until credentials are present. The
moment they are, it replaces the simulated feed automatically — no other code
changes. Every screen (Opportunity Center, Profitability Engine, Daily Plan)
then runs on live freight.

## Why there's no "just add an API key" option

No major load board (Truckstop, DAT, 123Loadboard) offers a self-serve or
sandbox API. All three gate credentials behind a signed agreement:

- **Truckstop** — requires a signed Systems Integration Agreement (SIA) before
  issuing credentials. Contact their Integrations Team.
- **123Loadboard** — partner program via partner-integrations@123loadboard.com;
  assigns you a tech lead.
- **DAT** — enterprise/partner only.

So going live is a business step (sign the SIA, get credentials) — the
engineering is already done and waiting.

## Environment variables

Once Truckstop issues credentials, set these on the backend (Railway):

| Var | Required | Notes |
|---|---|---|
| `TRUCKSTOP_USERNAME` | yes | Account username issued by Truckstop |
| `TRUCKSTOP_PASSWORD` | yes | Account password |
| `TRUCKSTOP_INTEGRATION_ID` | yes | Integration ID tied to the enabled web service |
| `TRUCKSTOP_SEARCH_STATES` | no | Comma list of origin states to scan, e.g. `TX,GA,FL,CA`. Defaults to a broad national set. |
| `TRUCKSTOP_SOAP_URL` | no | Override the service endpoint if Truckstop assigns a different host. |

With all three required vars set, `isEnabled()` flips true, the simulated feed
is dropped, and the 6-hour sync pulls live loads on boot and on schedule.

## One confirm step on first connect

The full SOAP `LoadSearchItem` schema isn't published outside the partner
portal, so the response parser is deliberately **alias-tolerant and
namespace-agnostic** — it tries several documented field names per value and
won't break on prefix differences. Once you have live credentials and can see a
real response, search the file for `CONFIRM:` and verify:

1. The `SOAPAction` header URI (from the account WSDL).
2. The request namespace URIs and credential element names.
3. The response field names (then you can trim the alias lists for clarity).

Two market signals are **derived from real data**, not planted:
`demandIndex` comes from rate-per-mile plus posting freshness; `reloadIndex`
starts neutral (50) and the learning loop calibrates it per carrier from actual
booking outcomes.
