# Session Scheduler — Build Backlog (with Future Considerations)

## Legend
- **Priority:** P0 (critical), P1 (important), P2 (nice to have)
- **Effort:** S (≤4h), M (1–2d), L (3–5d)
- **Type:** FE (frontend), BE (backend), INF (infra), FULL (full stack)

---

# EPIC 1 — Platform Foundation
- [x] Monorepo setup (workspaces, packages)
- [x] TypeScript configs
- [x] ESLint + Prettier
- [x] Docker Compose (postgres, server, client)
- [x] Dev scripts (dev, db:migrate, db:seed)

---

# EPIC 2 — Database & Shared Contracts
- [x] Implement schema (users, projects, time_blocks, time_block_engineers, bookings)
- [x] Indexes + constraints
- [x] Migration runner + seed data
- [x] Shared TS models + DTOs
- [x] Zod validation schemas

---

# EPIC 3 — Auth & Identity
- [x] bcrypt + JWT helpers
- [x] Auth middleware + RBAC
- [x] Auth endpoints (register, login, me, engineers)
- [x] Client auth context

---

# EPIC 4 — Project Management
- [x] Project CRUD endpoints
- [x] Dashboard UI
- [x] Create project modal
- [x] Project detail page

---

# EPIC 5 — Time Blocks
- [x] Batch create endpoint (transactional)
- [x] Engineer assignment
- [x] Delete rules (prevent if booked)
- [x] UI for block creation + table

---

# EPIC 6 — Public Booking
- [x] Public project endpoint (available slots)
- [x] Booking transaction (SELECT FOR UPDATE)
- [x] Public booking UI (password → slots → form → confirm)

---

# EPIC 7 — Reschedule & Cancel
- [x] Booking lookup endpoint
- [x] Reschedule transaction (atomic)
- [x] Cancel endpoint
- [x] Reschedule UI

---

# EPIC 8 — Calendar (.ics)
- [x] ICS generator (RFC 5545)
- [x] Calendar download endpoint
- [x] Download UI

---

# EPIC 9 — UX Polish
- [x] Loading + error states
- [x] Mobile responsiveness
- [x] Toasts + confirmations

---

# EPIC 10 — Hardening & Production
- [x] Rate limiting (public endpoints)
- [x] Logging + error handling
- [x] Health checks
- [x] Tests (auth, booking, concurrency)
- [ ] Docker production validation

---

# EPIC 11 — Future Considerations

## High Priority
- [x] Rate limiting improvements (nginx + app layer)
- [x] Observability (logs, metrics, traces)
- [x] Background job queue (email, retries)
- [x] Backup + restore automation
- [x] Abuse protection (lockouts, CAPTCHA)

## Medium Priority
- [x] Email notifications (SendGrid/SES/Resend)
- [x] Microsoft Calendar integration (OAuth2)
- [x] Recurring time blocks
- [x] Timezone selection UI
- [x] Booking email domain validation (project-level root domain allowlist)
- [x] Idempotency keys for booking
- [x] API versioning (/api/v1)
- [x] Data retention + deletion policies
- [x] Load testing + capacity planning
- [x] Multi-tenant isolation (tenant_id, RLS)
- [x] JWT refresh tokens + revocation
- [x] Admin page with specific routes and permissions

## Low Priority
- [x] Audit log (who did what)
- [x] Waitlist system
- [ ] SSO (SAML/OIDC)

---

# DONE (v1)
- [ ] Projects can be created
- [ ] Time blocks can be scheduled
- [ ] Engineers can view assignments
- [ ] Clients can book with password
- [ ] No double booking (concurrency safe)
- [ ] Clients can reschedule/cancel
- [ ] ICS downloads work
- [ ] App works on mobile
- [ ] Docker deployment works
    
