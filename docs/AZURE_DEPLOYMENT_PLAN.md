# Azure Deployment Plan

## Summary

This repo now targets an initial Azure production baseline of:

- `Azure Front Door Premium`
- `Azure Container Apps` for `client` and `server`
- `Azure Database for PostgreSQL Flexible Server`
- no `Azure API Management`
- no `Redis`
- one `server` replica until background work is moved out of process

The implementation artifacts for this baseline live under `infra/azure/`.

## Azure Platform Decision Matrix

| Capability | Decision | When To Introduce | Why | Main Tradeoff |
| --- | --- | --- | --- | --- |
| Azure Front Door Premium | `Use now` | Initial deployment | Required to keep public entry at the edge while backend stays private | Expensive fixed monthly cost |
| Azure Container Apps | `Use now` | Initial deployment | Best fit for current containerized client/server setup | Less operational control than AKS |
| PostgreSQL Flexible Server | `Use now` | Initial deployment | Managed relational DB fits current app exactly | HA and storage upgrades raise cost quickly |
| API backend (current Express server) | `Keep now` | Initial deployment | Business logic, auth, booking, jobs, and integrations already live here | Single service owns many responsibilities |
| Azure API Management | `Do not use now` | Add only when external API governance matters | It does not replace the backend; it only adds gateway capabilities | Adds cost and policy complexity |
| Redis / Azure Managed Redis | `Do not use now` | Add when scale or distributed coordination requires it | Current load and app shape do not justify it yet | Another stateful component and cost line |
| Durable job worker / external queue | `Add next` | Before horizontal API scaling | Current in-memory jobs and retention scheduler block clean multi-replica scaling | Requires an architecture refactor |
| Multi-replica API scaling | `Wait` | After queue/scheduler are externalized | Current in-process jobs make multi-replica risky | Delays elasticity until worker model is in place |
| API response caching | `Wait` | After real read hotspots appear | Current traffic is too small to justify cache complexity | Premature tuning risk |
| Distributed rate-limit / abuse state | `Wait` | When more than one API replica is needed | Current single replica can keep this local | Requires shared state later |

## Baseline Implementation

### Client container

- nginx now resolves its upstream at container startup using `API_UPSTREAM`
- local Docker keeps the current default `http://server:4000`
- Azure can point the client app at the internal Container Apps server hostname without rebuilding the image

### Server container

- health endpoints already match Container Apps probes
- the deployment baseline keeps the server at `maxReplicas: 1`
- no Redis or APIM resources are part of the first deployment

### Azure assets

- `infra/azure/container-apps/client.containerapp.yaml`
- `infra/azure/container-apps/server.containerapp.yaml`
- `infra/azure/env.production.example`
- `infra/azure/README.md`

## Next Changes After Launch

- Move background jobs and retention work to a durable worker pattern
- Add monitoring and alerting
- Reassess multi-replica API scale
- Revisit Redis or API Management only if the product outgrows the initial operating model
