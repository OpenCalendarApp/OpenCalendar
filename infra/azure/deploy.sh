#!/usr/bin/env bash
# Provisions the Azure baseline described in docs/AZURE_DEPLOYMENT_PLAN.md and
# infra/azure/README.md: Front Door Premium -> Container Apps (client, server)
# -> PostgreSQL Flexible Server, backed by ACR.
#
# Prereqs: az CLI logged in (`az login`), docker NOT required locally (uses
# `az acr build`), an Azure subscription with quota for Container Apps +
# Front Door Premium + Postgres Flexible Server.
#
# Usage:
#   cp infra/azure/deploy.env.example infra/azure/deploy.env   # fill in values
#   source infra/azure/deploy.env
#   bash infra/azure/deploy.sh
#
# Re-running is mostly safe (az ... create is idempotent for most resources)
# but Postgres server creation and Front Door domain validation are not
# instant - read the echoed output at each step before moving on.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

: "${RESOURCE_GROUP:?Set RESOURCE_GROUP, e.g. rg-opencalendar-prod}"
: "${LOCATION:?Set LOCATION, e.g. eastus}"
: "${ACR_NAME:?Set ACR_NAME, must be globally unique, alnum only, e.g. ocacrprod01}"
: "${ENV_NAME:?Set ENV_NAME, e.g. opencalendar-env}"
: "${LOG_ANALYTICS_NAME:?Set LOG_ANALYTICS_NAME, e.g. opencalendar-logs}"
: "${PG_SERVER_NAME:?Set PG_SERVER_NAME, must be globally unique, e.g. opencalendar-pg-prod}"
: "${PG_ADMIN_USER:?Set PG_ADMIN_USER, e.g. ocadmin}"
: "${PG_ADMIN_PASSWORD:?Set PG_ADMIN_PASSWORD, strong password, not the docker-compose default}"
: "${PG_DB_NAME:=opencalendar}"
: "${APP_DOMAIN:?Set APP_DOMAIN, e.g. calendar.example.com (no scheme)}"
: "${AFD_PROFILE_NAME:=opencalendar-fd}"
: "${AFD_ENDPOINT_NAME:=opencalendar}"
: "${JWT_SECRET:=$(openssl rand -hex 32)}"
: "${METRICS_TOKEN:=$(openssl rand -hex 24)}"
: "${EMAIL_FROM:=no-reply@${APP_DOMAIN}}"
: "${RESEND_API_KEY:=}"
: "${MICROSOFT_CLIENT_ID:=}"
: "${MICROSOFT_CLIENT_SECRET:=}"

echo "== 1. Resource group =="
az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o table

echo "== 2. Container registry =="
az acr create -g "$RESOURCE_GROUP" -n "$ACR_NAME" --sku Basic -o table
ACR_LOGIN_SERVER="$(az acr show -n "$ACR_NAME" --query loginServer -o tsv)"

echo "== 3. Build + push images via ACR build (no local docker needed) =="
az acr build -r "$ACR_NAME" -t "opencalendar/server:latest" -f packages/server/Dockerfile .
az acr build -r "$ACR_NAME" -t "opencalendar/client:latest" -f packages/client/Dockerfile .

echo "== 4. Log Analytics + Container Apps environment =="
az monitor log-analytics workspace create \
  -g "$RESOURCE_GROUP" -n "$LOG_ANALYTICS_NAME" -o table
LOG_ID="$(az monitor log-analytics workspace show -g "$RESOURCE_GROUP" -n "$LOG_ANALYTICS_NAME" --query customerId -o tsv)"
LOG_KEY="$(az monitor log-analytics workspace get-shared-keys -g "$RESOURCE_GROUP" -n "$LOG_ANALYTICS_NAME" --query primarySharedKey -o tsv)"

az extension add --name containerapp --upgrade -o none 2>/dev/null || true
az provider register --namespace Microsoft.App -o none
az provider register --namespace Microsoft.OperationalInsights -o none

az containerapp env create \
  -g "$RESOURCE_GROUP" -n "$ENV_NAME" -l "$LOCATION" \
  --logs-workspace-id "$LOG_ID" --logs-workspace-key "$LOG_KEY" -o table
MANAGED_ENVIRONMENT_ID="$(az containerapp env show -g "$RESOURCE_GROUP" -n "$ENV_NAME" --query id -o tsv)"

echo "== 5. PostgreSQL Flexible Server =="
# Public access + SSL required, restricted to Azure-internal callers. Revisit
# with VNET-injected Container Apps env + private endpoint once this baseline
# needs to move past a single-region single-replica setup (see
# docs/AZURE_DEPLOYMENT_PLAN.md decision matrix).
az postgres flexible-server create \
  -g "$RESOURCE_GROUP" -n "$PG_SERVER_NAME" -l "$LOCATION" \
  --admin-user "$PG_ADMIN_USER" --admin-password "$PG_ADMIN_PASSWORD" \
  --sku-name Standard_B1ms --tier Burstable --storage-size 32 \
  --version 16 --public-access 0.0.0.0-0.0.0.0 -o table

az postgres flexible-server db create \
  -g "$RESOURCE_GROUP" -s "$PG_SERVER_NAME" -d "$PG_DB_NAME" -o table

az postgres flexible-server parameter set \
  -g "$RESOURCE_GROUP" -s "$PG_SERVER_NAME" \
  --name require_secure_transport --value on -o table

PG_HOST="${PG_SERVER_NAME}.postgres.database.azure.com"
DATABASE_URL="postgresql://${PG_ADMIN_USER}:${PG_ADMIN_PASSWORD}@${PG_HOST}:5432/${PG_DB_NAME}?sslmode=require"

echo "== 6. Run schema migration from this machine =="
MY_IP="$(curl -s https://api.ipify.org)"
az postgres flexible-server firewall-rule create \
  -g "$RESOURCE_GROUP" -n "$PG_SERVER_NAME" --rule-name allow-deploy-machine \
  --start-ip-address "$MY_IP" --end-ip-address "$MY_IP" -o table

DATABASE_URL="$DATABASE_URL" npm run db:migrate -w @opencalendar/server

az postgres flexible-server firewall-rule delete \
  -g "$RESOURCE_GROUP" -n "$PG_SERVER_NAME" --rule-name allow-deploy-machine --yes

echo "== 7. Deploy server container app (internal ingress) =="
SERVER_MANIFEST="$(mktemp)"
sed \
  -e "s#__MANAGED_ENVIRONMENT_ID__#${MANAGED_ENVIRONMENT_ID}#g" \
  -e "s#__ACR_LOGIN_SERVER__#${ACR_LOGIN_SERVER}#g" \
  -e "s#__SERVER_IMAGE__#${ACR_LOGIN_SERVER}/opencalendar/server:latest#g" \
  -e "s#__DATABASE_URL__#${DATABASE_URL}#g" \
  -e "s#__JWT_SECRET__#${JWT_SECRET}#g" \
  -e "s#__METRICS_TOKEN__#${METRICS_TOKEN}#g" \
  -e "s#__RESEND_API_KEY__#${RESEND_API_KEY}#g" \
  -e "s#__MICROSOFT_CLIENT_ID__#${MICROSOFT_CLIENT_ID}#g" \
  -e "s#__MICROSOFT_CLIENT_SECRET__#${MICROSOFT_CLIENT_SECRET}#g" \
  -e "s#calendar.example.com#${APP_DOMAIN}#g" \
  infra/azure/container-apps/server.containerapp.yaml > "$SERVER_MANIFEST"

az containerapp create -g "$RESOURCE_GROUP" --yaml "$SERVER_MANIFEST" -o table
az containerapp registry set -g "$RESOURCE_GROUP" -n opencalendar-server \
  --server "$ACR_LOGIN_SERVER" --identity system
SERVER_INTERNAL_ORIGIN="https://$(az containerapp show -g "$RESOURCE_GROUP" -n opencalendar-server --query properties.configuration.ingress.fqdn -o tsv)"

echo "== 8. Deploy client container app (external ingress) =="
CLIENT_MANIFEST="$(mktemp)"
sed \
  -e "s#__MANAGED_ENVIRONMENT_ID__#${MANAGED_ENVIRONMENT_ID}#g" \
  -e "s#__ACR_LOGIN_SERVER__#${ACR_LOGIN_SERVER}#g" \
  -e "s#__CLIENT_IMAGE__#${ACR_LOGIN_SERVER}/opencalendar/client:latest#g" \
  -e "s#__SERVER_INTERNAL_ORIGIN__#${SERVER_INTERNAL_ORIGIN}#g" \
  infra/azure/container-apps/client.containerapp.yaml > "$CLIENT_MANIFEST"

az containerapp create -g "$RESOURCE_GROUP" --yaml "$CLIENT_MANIFEST" -o table
az containerapp registry set -g "$RESOURCE_GROUP" -n opencalendar-client \
  --server "$ACR_LOGIN_SERVER" --identity system
CLIENT_FQDN="$(az containerapp show -g "$RESOURCE_GROUP" -n opencalendar-client --query properties.configuration.ingress.fqdn -o tsv)"

echo "== 9. Front Door Premium in front of the client app =="
az afd profile create -g "$RESOURCE_GROUP" -n "$AFD_PROFILE_NAME" --sku Premium_AzureFrontDoor -o table
az afd endpoint create -g "$RESOURCE_GROUP" --profile-name "$AFD_PROFILE_NAME" -n "$AFD_ENDPOINT_NAME" -o table

az afd origin-group create -g "$RESOURCE_GROUP" --profile-name "$AFD_PROFILE_NAME" \
  -n opencalendar-origin-group \
  --probe-request-type GET --probe-protocol Https --probe-path / --probe-interval-in-seconds 30 \
  --sample-size 4 --successful-samples-required 3 -o table

az afd origin create -g "$RESOURCE_GROUP" --profile-name "$AFD_PROFILE_NAME" \
  --origin-group-name opencalendar-origin-group -n opencalendar-client-origin \
  --host-name "$CLIENT_FQDN" --origin-host-header "$CLIENT_FQDN" \
  --http-port 80 --https-port 443 --priority 1 --weight 1000 --enabled-state Enabled -o table

az afd route create -g "$RESOURCE_GROUP" --profile-name "$AFD_PROFILE_NAME" \
  --endpoint-name "$AFD_ENDPOINT_NAME" -n opencalendar-route \
  --origin-group opencalendar-origin-group --supported-protocols Https Http \
  --https-redirect Enabled --forwarding-protocol HttpsOnly --link-to-default-domain Enabled -o table

echo
echo "Default Front Door hostname (works immediately, use for a smoke test):"
az afd endpoint show -g "$RESOURCE_GROUP" --profile-name "$AFD_PROFILE_NAME" -n "$AFD_ENDPOINT_NAME" \
  --query hostName -o tsv

cat <<EOF

== Remaining manual steps ==
1. Custom domain: az afd custom-domain create ... for ${APP_DOMAIN}, then add the
   validation TXT record + CNAME it gives you at your DNS provider, then
   az afd route update ... --custom-domains to attach it to the route.
2. WAF: Front Door Premium supports a managed WAF policy - attach one via
   az afd security-policy create if this app will be internet-facing long-term.
3. Store JWT_SECRET / METRICS_TOKEN / PG_ADMIN_PASSWORD somewhere durable
   (Key Vault recommended) - they only exist in this shell's env right now.
4. Confirm CORS_ORIGIN / BOOKING_PORTAL_BASE_URL / MICROSOFT_REDIRECT_URI on the
   server app match https://${APP_DOMAIN} exactly (the sed above assumes the
   manifest's placeholder domain was calendar.example.com).
EOF
