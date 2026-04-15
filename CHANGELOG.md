# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Root version bump workflow for date-based versions (`yyyy.mm.dd`, then `yyyy-mm-dd-<build#>` for additional same-day builds).
- Workspace package bump workflow using semantic versioning for packages under `packages/*`.
- Hash-based package change detection with persisted state in `.bump-hashes.json`.
- Workspace dependency connection mapping so dependent packages can be bumped when upstream workspace versions change.
- Admin pages and guards in the client (`AdminOverview`, `AdminUsers`, `AdminAudit`, `AdminSSO`, `AdminRoute`).
- Setup initialization flow and setup page for first-time tenant/bootstrap.
- Time zone selection context and UI support in the client.
- Data retention jobs, background queue jobs, idempotency middleware, and abuse protection middleware on the server.
- Microsoft Calendar integration job handlers and utility support.
- Backup/restore scripts for local Dockerized PostgreSQL (`scripts/db-backup.sh`, `scripts/db-restore.sh`).
- Built-in load testing script and documentation (`scripts/load-test.mjs`, `docs/LOAD_TESTING.md`).
- Time block editing support across the API, shared validation schemas, and project detail UI, including signed-up client visibility and engineer/max-signup updates.
- Brand logo component and bundled Calendar Genie SVG assets for horizontal, stacked, and icon treatments in the client.
- Complete rebranding from CalendarGenie to OpenCalendar across documentation and configuration.
- Azure deployment configuration with container app YAML specs, Bicep modules, and environment variable support.
- GitHub Actions CI/CD workflows for continuous integration, Docker build-push, and deployment.
- Password reset flow with forgot-password and token-based reset endpoints, plus frontend pages.
- Onboarding wizard component guiding new users through project setup.
- Visual step progress bar for the public booking flow.
- Progressive disclosure in the project creation modal for advanced settings.
- Updated tagline and user-facing copy across the application.
- CSS design tokens for consistent styling (`--color-*`, `--space-*`, `--font-size-*` variables).
- Lucide Icons integration replacing inline SVGs across the UI.
- Scheduled booking reminder emails (24h and 1h before session) via background job queue.
- White-label booking pages with per-tenant logo and accent color support.
- Dashboard metrics hero section with 6 real-time stat cards (active projects, sessions this week, pending bookings, next 24h, team members, bookings this month).
- Session notes on bookings — `PUT /api/v1/bookings/:id/notes` endpoint with RBAC and auto-save textarea on ProjectDetailPage (#17).
- Smart Availability Solver — `GET /api/v1/projects/:id/availability-solver` endpoint that queries Microsoft Graph calendar data to find windows where all assigned engineers are free, with 5-minute cache and frontend modal for one-click time block creation (#16).
- Session Reporting CSV Export — `GET /api/v1/projects/:id/export` (per-project) and `GET /api/v1/export/sessions` (cross-project, PM/admin only) with date range and status filters, PII redaction for scrubbed bookings, and frontend download buttons on ProjectDetailPage and DashboardPage (#18).

### Changed
- API routing supports both legacy (`/api/*`) and versioned (`/api/v1/*`) routes.
- Booking and project flows expanded for idempotency, email-domain restrictions, recurring time blocks, and observability coverage.
- README and architecture/docs updated to reflect Epic 11 platform capabilities and operational workflows.
- Project naming, package references, local database defaults, and load-testing labels were renamed from Session Scheduler to Calendar Genie across the repo.
- README messaging was refreshed to better describe the product and highlight core platform features.

### Fixed
- Version bump script output no longer emits noisy git tag errors when no tags are present.
