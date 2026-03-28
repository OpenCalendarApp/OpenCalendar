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
- [ ] bcrypt + JWT helpers
- [ ] Auth middleware + RBAC
- [ ] Auth endpoints (register, login, me, engineers)
- [ ] Client auth context

---

# EPIC 4 — Project Management
- [ ] Project CRUD endpoints
- [ ] Dashboard UI
- [ ] Create project modal
- [ ] Project detail page

---

# EPIC 5 — Time Blocks
- [ ] Batch create endpoint (transactional)
- [ ] Engineer assignment
- [ ] Delete rules (prevent if booked)
- [ ] UI for block creation + table

---

# EPIC 6 — Public Booking
- [ ] Public project endpoint (available slots)
- [ ] Booking transaction (SELECT FOR UPDATE)
- [ ] Public booking UI (password → slots → form → confirm)

---

# EPIC 7 — Reschedule & Cancel
- [ ] Booking lookup endpoint
- [ ] Reschedule transaction (atomic)
- [ ] Cancel endpoint
- [ ] Reschedule UI

---

# EPIC 8 — Calendar (.ics)
- [ ] ICS generator (RFC 5545)
- [ ] Calendar download endpoint
- [ ] Download UI

---

# EPIC 9 — UX Polish
- [ ] Loading + error states
- [ ] Mobile responsiveness
- [ ] Toasts + confirmations

---

# EPIC 10 — Hardening & Production
- [ ] Rate limiting (public endpoints)
- [ ] Logging + error handling
- [ ] Health checks
- [ ] Tests (auth, booking, concurrency)
- [ ] Docker production validation

---

# EPIC 11 — Future Considerations

## High Priority
- [ ] Rate limiting improvements (nginx + app layer)
- [ ] Observability (logs, metrics, traces)
- [ ] Background job queue (email, retries)
- [ ] Backup + restore automation
- [ ] Abuse protection (lockouts, CAPTCHA)

## Medium Priority
- [ ] Email notifications (SendGrid/SES/Resend)
- [ ] Google Calendar integration (OAuth2)
- [ ] Recurring time blocks
- [ ] Timezone selection UI
- [ ] Booking email domain validation (project-level root domain allowlist)
- [ ] Idempotency keys for booking
- [ ] API versioning (/api/v1)
- [ ] Data retention + deletion policies
- [ ] Load testing + capacity planning
- [ ] Multi-tenant isolation (tenant_id, RLS)
- [ ] JWT refresh tokens + revocation

## Low Priority
- [ ] Audit log (who did what)
- [ ] Waitlist system
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
