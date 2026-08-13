# Deployment Runbook — Azure

Step-by-step runbook for shipping OpenCalendar to the Azure baseline described in
[AZURE_DEPLOYMENT_PLAN.md](AZURE_DEPLOYMENT_PLAN.md): Front Door Premium →
Container Apps (`client`, `server`) → PostgreSQL Flexible Server. The
provisioning itself is automated by [`infra/azure/deploy.sh`](../infra/azure/deploy.sh);
this doc is the surrounding checklist — what to verify before running it, what
it does step by step, and what's left for you to finish by hand afterward.

## 0. Prerequisites

- [ ] Azure CLI installed and logged in: `az login`
- [ ] Correct subscription selected: `az account show` (switch with `az account set -s <id>`)
- [ ] Subscription has quota for Container Apps, Front Door Premium, and PostgreSQL Flexible Server in your target region
- [ ] A resource group to deploy into — **either works**:
  - an existing one you already have (just set `RESOURCE_GROUP` to its name — `az group create` no-ops against an existing group and ignores `--location` in that case), or
  - a new one (the script creates it if the name doesn't exist yet)
- [ ] A domain you control, for the custom domain step later (e.g. `calendar.example.com`)
- [ ] `openssl` available locally (used to generate `JWT_SECRET`/`METRICS_TOKEN` if you don't supply your own)

## 1. Pre-deploy code checklist

Run these from the repo root before provisioning anything. All of these passed
as of the last check on this branch — re-run if you've made further changes:

```bash
npm install
npm run build
npm run lint
npm run test
npm audit --omit=dev   # review any new findings; see "Known accepted risk" below
docker compose config  # validates docker-compose.yml without building
```

**Known accepted risk:** a critical/high advisory in `tar`/`bcrypt`'s install-time
`node-pre-gyp` dependency remains unresolved — fixing it requires `bcrypt@6.0.0`
(breaking change). It's not reachable at runtime (it's only exercised during
`npm install`, not by live requests), so it was accepted rather than force-upgraded
same-day. Revisit when there's room to re-test a bcrypt major bump.

## 2. Configure deployment variables

Two equivalent versions of the provisioning script exist — pick one:

- **Bash**: [`infra/azure/deploy.sh`](../infra/azure/deploy.sh) + [`deploy.env.example`](../infra/azure/deploy.env.example)
- **PowerShell**: [`infra/azure/deploy.ps1`](../infra/azure/deploy.ps1) + [`deploy.env.ps1.example`](../infra/azure/deploy.env.ps1.example)

Bash:

```bash
cp infra/azure/deploy.env.example infra/azure/deploy.env
```

PowerShell:

```powershell
Copy-Item infra/azure/deploy.env.ps1.example infra/azure/deploy.env.ps1
```

Edit the copy and fill in real values — at minimum:

| Variable | Notes |
| --- | --- |
| `RESOURCE_GROUP` | Existing or new — see prerequisites above |
| `LOCATION` | e.g. `eastus` |
| `ACR_NAME` | Must be globally unique, alphanumeric only |
| `PG_SERVER_NAME` | Must be globally unique |
| `PG_ADMIN_PASSWORD` | Strong password — **not** the docker-compose dev default |
| `APP_DOMAIN` | No scheme, no trailing slash, e.g. `calendar.example.com` |

`RESEND_API_KEY` / `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` can stay
blank if you're not using real email delivery or Microsoft calendar sync yet.
`JWT_SECRET` / `METRICS_TOKEN` are auto-generated if left unset (via `openssl rand`
in Bash, via `RandomNumberGenerator` in PowerShell).

Then load the variables into your session:

```bash
source infra/azure/deploy.env
```

```powershell
. .\infra\azure\deploy.env.ps1
```

## 3. Run the provisioning script

```bash
bash infra/azure/deploy.sh
```

```powershell
.\infra\azure\deploy.ps1
```

Both scripts do the same thing step by step, using the same resource names, so
the manual/smoke-test steps below apply either way.

What it does, in order:

1. **Resource group** — creates it, or reuses it if it already exists.
2. **Azure Container Registry** (Basic SKU).
3. **Builds + pushes both images** via `az acr build` — no local Docker daemon required.
4. **Log Analytics workspace + Container Apps environment**.
5. **PostgreSQL Flexible Server** (`Standard_B1ms`, Postgres 16, public access with `require_secure_transport=on`). This is the fast-to-ship baseline from the decision matrix — revisit VNET-injected private access once the app outgrows a single region/replica.
6. **Runs the schema migration** (`npm run db:migrate -w @opencalendar/server`) directly from your machine against the new server, using a temporary firewall rule scoped to your current IP that it removes immediately after.
7. **Deploys the `server` container app** (internal ingress only) from [`infra/azure/container-apps/server.containerapp.yaml`](../infra/azure/container-apps/server.containerapp.yaml), with secrets and `APP_DOMAIN` substituted in.
8. **Deploys the `client` container app** (external ingress) from [`infra/azure/container-apps/client.containerapp.yaml`](../infra/azure/container-apps/client.containerapp.yaml), wired to the server's internal origin.
9. **Front Door Premium** — profile, endpoint, origin group with a health probe, origin pointed at the client app, and an HTTPS-redirecting route on the default Front Door domain.

At the end it prints the default `*.azurefd.net` hostname — use that for the
smoke test in step 5 before any DNS changes are needed.

## 4. Manual steps the script doesn't do

- [ ] **Custom domain**: `az afd custom-domain create` for `APP_DOMAIN`, add the TXT validation record + CNAME it gives you at your DNS provider, then `az afd route update ... --custom-domains` to attach it.
- [ ] **WAF**: Front Door Premium supports a managed WAF policy — attach one via `az afd security-policy create` before treating this as long-term internet-facing.
- [ ] **Secrets durability**: `JWT_SECRET`, `METRICS_TOKEN`, and `PG_ADMIN_PASSWORD` only exist in your shell session right now (from `deploy.env`/generated values) — move them into Key Vault and reference them from the Container Apps secrets instead of plain values.
- [ ] **Double-check redirect URLs**: confirm `CORS_ORIGIN`, `BOOKING_PORTAL_BASE_URL`, `MICROSOFT_REDIRECT_URI`, and `SSO_OIDC_REDIRECT_URI` on the server app all resolve to `https://<APP_DOMAIN>` — the script substitutes these from the manifest's placeholder domain (`calendar.example.com`).

## 5. Smoke test

Against the Front Door hostname (`*.azurefd.net` first, then the custom domain
once DNS propagates):

- [ ] `GET /api/health/live` and `/api/health/ready` return 200
- [ ] Log in as an existing user (or run `db:seed` locally against the new DB first if you need seed accounts)
- [ ] Create a project, add a time block, copy the public booking link
- [ ] Complete a booking end-to-end and confirm the `.ics` download works
- [ ] Upload a branding image/logo — this exercises `multer` + `sharp`, both recently patched, and has no automated test coverage, so it's worth checking by hand
- [ ] Reschedule and cancel a booking

## 6. Rollback

Container Apps keeps prior revisions — `az containerapp revision list` and
`az containerapp ingress traffic set` can shift traffic back to a known-good
revision without re-running the whole script. Database migrations are
forward-only in this codebase; there is no down-migration path, so restore
from a `db-backup.sh` snapshot if a migration needs to be undone.
