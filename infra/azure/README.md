# Azure Baseline

This directory contains the baseline Azure deployment assets that match the current deployment decision matrix:

- `Azure Front Door Premium` at the edge
- `Azure Container Apps` for `client` and `server`
- `Azure Database for PostgreSQL Flexible Server`
- no `API Management` for the initial launch
- no `Redis` for the initial launch
- `server` kept at a single replica until background jobs move off in-memory process state

## Files

- `container-apps/client.containerapp.yaml` example client app manifest
- `container-apps/server.containerapp.yaml` example server app manifest
- `env.production.example` production environment template

## Important Current Constraints

- The client container proxies `/api/*` using `API_UPSTREAM`
- In Azure Container Apps, set `API_UPSTREAM` to the internal server app origin exposed inside the environment
- The server app should stay at `maxReplicas: 1` for now because background jobs and retention sweeps still run in-process

## Not Included On Purpose

These are intentionally excluded from the first deployment:

- `Azure API Management`
- `Azure Managed Redis`

Revisit them only when the app needs external API governance, distributed coordination, or shared cache state.
