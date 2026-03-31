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

### Changed
- API routing supports both legacy (`/api/*`) and versioned (`/api/v1/*`) routes.
- Booking and project flows expanded for idempotency, email-domain restrictions, recurring time blocks, and observability coverage.
- README and architecture/docs updated to reflect Epic 11 platform capabilities and operational workflows.

### Fixed
- Version bump script output no longer emits noisy git tag errors when no tags are present.

