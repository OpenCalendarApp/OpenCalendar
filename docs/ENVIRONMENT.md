# Environment Variables

This project uses `.env.example` as the canonical template for local configuration.

## Quick Start

```bash
cp .env.example .env
```

## Notes

- Duration settings use explicit units in the variable name (`_MS`, `_HOURS`, `_DAYS`, `_SECONDS`).
- Boolean settings accept `true`/`false` and, in most server parsers, also `1`/`0`.
- `DATABASE_URL` is used by local Node processes; `DOCKER_DATABASE_URL` is used by the `server` container in `docker-compose.yml`.

## Database

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `POSTGRES_DB` | `calendar_genie` | No | Database name used by local scripts, connection-string fallback, and Docker Postgres initialization. |
| `POSTGRES_USER` | `ss_admin` | No | Database user used by local scripts, fallback URL construction, and Docker Postgres initialization. |
| `POSTGRES_PASSWORD` | `change-me` | No (dev), Yes (prod) | Database password for local fallback URL construction and Docker Postgres initialization. |
| `POSTGRES_PORT` | `5432` | No | PostgreSQL port used by host mapping and fallback URL construction. |
| `POSTGRES_HOST` | `localhost` | No | PostgreSQL host used by fallback URL construction for local Node runtime. |
| `DATABASE_SSLMODE` | empty | No | Optional `sslmode` appended to fallback `DATABASE_URL` (for example `require`, `disable`, `verify-full`). |
| `DATABASE_URL` | computed from `POSTGRES_*` | No | Primary DB connection string for the server and db scripts. If empty or template-like, code rebuilds it from `POSTGRES_*`. |
| `DOCKER_DATABASE_URL` | `postgresql://ss_admin:change-me@postgres:5432/calendar_genie` (compose fallback) | No | DB connection string injected into the Docker `server` container as `DATABASE_URL`. Use `postgres` as host when containerized. |

## Core Server + Security

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `JWT_SECRET` | none | Yes | Signing secret for access tokens; also used as Microsoft/OIDC OAuth state-secret fallback when provider-specific state secrets are unset. |
| `PORT` | `4000` | No | Express server port. |
| `CORS_ORIGIN` | `http://localhost:5173` | No | Allowed CORS origin and fallback base used for dashboard/login redirect URLs in OAuth flows. |
| `SSO_OIDC_REDIRECT_URI` | `http://localhost:4000/api/v1/auth/sso/oidc/callback` | Conditional | Required backend callback URL registered with the enterprise OIDC provider. |
| `SSO_OIDC_STATE_SECRET` | empty | No (if `JWT_SECRET` set) | HMAC secret for OIDC SSO state. Falls back to `JWT_SECRET`. |
| `TRUST_PROXY` | `1` | No | Express `trust proxy` setting; supports boolean, numeric, or string trust modes. |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | No | Refresh-token lifetime in days. Normalized to min `1`, max `365`. |
| `METRICS_TOKEN` | empty | No | If set, `/api/metrics` and `/api/v1/metrics` require matching `x-metrics-token` header. |

## Public API Rate Limits

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `PUBLIC_RATE_LIMIT_WINDOW_MS` | `60000` | No | Rate-limit window (ms) for public booking/schedule endpoints. |
| `PUBLIC_READ_RATE_LIMIT_MAX` | `120` | No | Max read requests per window for public read routes. |
| `PUBLIC_WRITE_RATE_LIMIT_MAX` | `30` | No | Max write requests per window for public write routes. |

## Abuse Prevention

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `ABUSE_LOCKOUT_ENABLED` | `true` | No | Enables in-memory progressive lockouts for repeated failed booking password attempts. |
| `ABUSE_FAILURE_WINDOW_MS` | `900000` | No | Time window (ms) used to count failed booking password attempts. |
| `ABUSE_FAILURE_THRESHOLD` | `5` | No | Number of failures in the window before lockout starts. |
| `ABUSE_LOCKOUT_BASE_MS` | `300000` | No | Initial lockout duration (ms). Each new lockout level doubles duration up to max. |
| `ABUSE_LOCKOUT_MAX_MS` | `3600000` | No | Maximum lockout duration (ms). |
| `ABUSE_CAPTCHA_AFTER_LOCKOUTS` | `2` | No | Lockout level at/after which API responses can signal CAPTCHA requirement. |

## Booking + Background Jobs

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `BOOKING_IDEMPOTENCY_TTL_HOURS` | `24` | No | TTL for stored booking idempotency keys/response records. |
| `JOB_QUEUE_POLL_INTERVAL_MS` | `1000` | No | Poll interval (ms) for the in-memory job queue scheduler. |
| `JOB_QUEUE_MAX_ATTEMPTS` | `5` | No | Max retry attempts for background jobs before moving to dead-letter memory queue. |
| `JOB_QUEUE_BACKOFF_BASE_MS` | `5000` | No | Exponential backoff base delay (ms) for job retries. |

## Microsoft Calendar Sync

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `MICROSOFT_CALENDAR_SYNC_ENABLED` | `true` | No | Master feature toggle for Microsoft Calendar sync jobs. |
| `MICROSOFT_TENANT_ID` | `common` | No | Microsoft Entra tenant segment used in OAuth authorize/token endpoints. |
| `MICROSOFT_CLIENT_ID` | empty | Conditional | Required to complete OAuth configuration for Microsoft integration. |
| `MICROSOFT_CLIENT_SECRET` | empty | Conditional | Required to complete OAuth configuration for Microsoft integration. |
| `MICROSOFT_REDIRECT_URI` | `http://localhost:4000/api/auth/microsoft/callback` | Conditional | Required callback URL registered in Microsoft app config. |
| `MICROSOFT_OAUTH_SCOPES` | `offline_access User.Read Calendars.ReadWrite` | No | Space-delimited scopes requested during OAuth authorization. |
| `MICROSOFT_OAUTH_STATE_TTL_SECONDS` | `600` | No | OAuth state token TTL in seconds. |
| `MICROSOFT_OAUTH_STATE_SECRET` | empty | No (if `JWT_SECRET` set) | HMAC secret for OAuth state. Falls back to `JWT_SECRET`. |
| `MICROSOFT_OAUTH_SUCCESS_REDIRECT_URL` | `http://localhost:5173/dashboard` | No | Frontend redirect URL after successful Microsoft connect. |
| `MICROSOFT_OAUTH_ERROR_REDIRECT_URL` | `http://localhost:5173/dashboard` | No | Frontend redirect URL after Microsoft OAuth error. |

## Data Retention

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `DATA_RETENTION_ENABLED` | `true` | No | Enables recurring retention sweep job. |
| `DATA_RETENTION_SWEEP_INTERVAL_MS` | `3600000` | No | How often retention sweeps run (ms). |
| `DATA_RETENTION_PII_DAYS` | `365` | No | Age (days after session end) before booking PII is redacted. |
| `DATA_RETENTION_CANCELLED_BOOKING_DELETE_DAYS` | `730` | No | Age (days) before cancelled and already-redacted bookings are deleted. Clamped to at least `DATA_RETENTION_PII_DAYS`. |
| `DATA_RETENTION_IDEMPOTENCY_KEY_DELETE_DAYS` | `2` | No | Extra grace period (days) before deleting expired idempotency key rows. |

## Email + Notifications + Backups

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `EMAIL_PROVIDER` | `console` | No | Email transport: `console` (logs only) or `resend` (real delivery). |
| `EMAIL_FROM` | `no-reply@calendar-genie.local` | No | Sender address for booking emails. |
| `RESEND_API_KEY` | empty | Conditional | Required when `EMAIL_PROVIDER=resend`. |
| `BOOKING_PORTAL_BASE_URL` | `http://localhost:3000` | No | Base URL for absolute reschedule/manage links in booking emails. |
| `EMAIL_QUEUE_FORCE_FAILURE` | `false` | No | Dev/testing flag that forces email job failure to exercise retries/lockout flows. |
| `BACKUP_DIR` | `./backups` | No | Target directory used by `scripts/db-backup.sh` when no output path arg is provided. |

## Frontend (Vite)

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `VITE_API_URL` | `/api` | No | Client runtime API base URL used by browser requests. |
| `VITE_DEV_PROXY_TARGET` | `http://127.0.0.1:4000` | No | Vite dev-server proxy target for `/api` requests. |
| `API_UPSTREAM` | `http://server:4000` | No | nginx proxy upstream used by the production client container. Override this in Azure Container Apps so the client app proxies `/api` to the internal server app hostname. |

## Load Testing Helpers

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `LOADTEST_BASE_URL` | `http://127.0.0.1:4000` | No | Target server base URL for `scripts/load-test.mjs`. |
| `LOADTEST_API_BASE_PATH` | `/api/v1` | No | API base path appended to `LOADTEST_BASE_URL` for load tests. |
| `LOADTEST_SHARE_TOKEN` | empty | Yes (for load tests) | Required share token for both `read-project` and `book-contention` scenarios. |
| `LOADTEST_PASSWORD` | empty | Conditional | Required for `book-contention` scenario. |
| `LOADTEST_TIME_BLOCK_ID` | empty | No | Optional fixed `time_block_id`; otherwise load test randomly picks from available slots. |
| `LOADTEST_DURATION_SECONDS` | `30` | No | Load-test duration in seconds. |
| `LOADTEST_VUS` | `10` | No | Virtual user count (concurrency). |
| `LOADTEST_THINK_TIME_MS` | `20` | No | Delay between iterations per virtual user (ms). |
| `LOADTEST_EMAIL_DOMAIN` | `example.com` | No | Email domain used for generated booking test addresses. |

## Additional Load Test Setting

`scripts/load-test.mjs` also supports `LOADTEST_METRICS_TOKEN` (optional) for authenticated `/api/v1/metrics` snapshots. It is not currently listed in `.env.example`.
