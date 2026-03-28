docs/BACKLOG.md:20:- [x] Implement schema (users, projects, time_blocks, time_block_engineers, bookings)
docs/BACKLOG.md:52:# EPIC 6 — Public Booking
docs/BACKLOG.md:55:- [ ] Public booking UI (password → slots → form → confirm)
docs/BACKLOG.md:85:- [ ] Tests (auth, booking, concurrency)
docs/BACKLOG.md:105:- [ ] Idempotency keys for booking
docs/BACKLOG.md:124:- [ ] No double booking (concurrency safe)
docs/ARCHITECTURE.md:28:Session Scheduler is an internal scheduling platform that allows Project Managers to create time-blocked sessions for projects, assign engineers to those blocks, and generate password-protected booking links for external clients. Clients visit the link, authenticate with a project-specific password, select an available time slot, and receive a downloadable `.ics` calendar reminder. Clients can also reschedule or cancel, which automatically frees the original slot.
docs/ARCHITECTURE.md:33:- **PostgreSQL backend** — relational schema with race-condition-safe booking
docs/ARCHITECTURE.md:74:| View all projects & bookings | ✅ | ✅ | ❌ |
docs/ARCHITECTURE.md:76:| Reschedule booking | ❌ | ❌ | ✅ |
docs/ARCHITECTURE.md:77:| Cancel booking | ❌ | ❌ | ✅ |
docs/ARCHITECTURE.md:79:| View client booking link | ✅ | ✅ | N/A |
docs/ARCHITECTURE.md:85:- Deleting a time block with active (non-cancelled) bookings is prohibited — cancellation must happen first
docs/ARCHITECTURE.md:106:     → Copy shareable booking URL
docs/ARCHITECTURE.md:108:     → View bookings table (who booked what, contact info)
docs/ARCHITECTURE.md:126:Client receives booking URL from PM/team
docs/ARCHITECTURE.md:140:     → Reschedule link provided (contains unique booking_token)
docs/ARCHITECTURE.md:147:  → /schedule/{share_token}/reschedule/{booking_token}
docs/ARCHITECTURE.md:148:  → View current booking details
docs/ARCHITECTURE.md:151:     → Old booking: cancelled_at timestamp set (slot freed)
docs/ARCHITECTURE.md:152:     → New booking: created with new booking_token
docs/ARCHITECTURE.md:160:Two variants are generated per booking:
docs/ARCHITECTURE.md:227:│   │       │   └── booking.ts   # Public booking, reschedule, .ics
docs/ARCHITECTURE.md:260:2. **Public booking requests (Client):** Browser → nginx → Express `/api/schedule/*` → password check in handler → PostgreSQL → JSON + .ics response
docs/ARCHITECTURE.md:305:                      │  │ time_block_  │  │      bookings        │
docs/ARCHITECTURE.md:313:                                           │ booking_token (UNQ) │
docs/ARCHITECTURE.md:341:| `description` | `TEXT` | DEFAULT '' | Appears in booking page and .ics files |
docs/ARCHITECTURE.md:378:#### `bookings`
docs/ARCHITECTURE.md:388:| `booking_token` | `VARCHAR(64)` | UNIQUE, NOT NULL | Auto-generated, used for reschedule/cancel URLs |
docs/ARCHITECTURE.md:392:**Indexes:** `idx_bookings_block` on `time_block_id`, `idx_bookings_email` on `client_email`, `idx_bookings_token` on `booking_token`
docs/ARCHITECTURE.md:408:LEFT JOIN bookings b ON b.time_block_id = tb.id
docs/ARCHITECTURE.md:415:The booking endpoint uses `SELECT ... FOR UPDATE` on the time_blocks row to prevent double-booking. The full transaction flow:
docs/ARCHITECTURE.md:420:  → Check: current_bookings < max_signups
docs/ARCHITECTURE.md:421:  → INSERT INTO bookings
docs/ARCHITECTURE.md:425:If two clients attempt to book the last slot simultaneously, the second transaction waits on the row lock, then recounts bookings and sees the slot is full. This guarantees no overbooking without application-level locking.
docs/ARCHITECTURE.md:427:The same pattern applies to rescheduling — the old booking is cancelled and the new slot is locked + checked within a single transaction.
docs/ARCHITECTURE.md:431:- `pgcrypto` — used for `gen_random_bytes()` to generate `share_token` and `booking_token` values
docs/ARCHITECTURE.md:516:| `GET` | `/api/projects/:id` | JWT | Full project detail with time blocks and bookings |
docs/ARCHITECTURE.md:519:| `DELETE` | `/api/projects/:id` | PM | Delete project (cascades to blocks and bookings) |
docs/ARCHITECTURE.md:559:      "bookings": [
docs/ARCHITECTURE.md:568:          "booking_token": "def456..."
docs/ARCHITECTURE.md:584:| `DELETE` | `/api/time-blocks/:id` | JWT | Delete block (fails if active bookings exist) |
docs/ARCHITECTURE.md:615:- Fails with 409 if the block has any active (non-cancelled) bookings
docs/ARCHITECTURE.md:626:| `GET` | `/api/schedule/booking/:bookingToken` | — | Get booking detail + reschedule options |
docs/ARCHITECTURE.md:627:| `POST` | `/api/schedule/reschedule/:bookingToken` | — | Cancel old + book new slot |
docs/ARCHITECTURE.md:628:| `POST` | `/api/schedule/cancel/:bookingToken` | — | Cancel a booking |
docs/ARCHITECTURE.md:629:| `GET` | `/api/schedule/calendar/:bookingToken` | — | Download .ics file |
docs/ARCHITECTURE.md:633:Returns only future, available slots (with remaining capacity > 0). Does NOT require the project password — the password is checked on booking.
docs/ARCHITECTURE.md:674:  "booking": { ...booking object with booking_token... },
docs/ARCHITECTURE.md:682:  "reschedule_url": "/schedule/{shareToken}/reschedule/{bookingToken}"
docs/ARCHITECTURE.md:688:##### `POST /api/schedule/reschedule/:bookingToken`
docs/ARCHITECTURE.md:698:  "booking": { ...new booking object... },
docs/ARCHITECTURE.md:705:    → Lock old booking (FOR UPDATE)
docs/ARCHITECTURE.md:706:    → Set cancelled_at = NOW() on old booking
docs/ARCHITECTURE.md:709:    → INSERT new booking
docs/ARCHITECTURE.md:712:Errors: 404 (booking not found / already cancelled), 409 (new slot full)
docs/ARCHITECTURE.md:715:##### `GET /api/schedule/calendar/:bookingToken`
docs/ARCHITECTURE.md:745:| `/schedule/:shareToken` | `PublicBookingPage` | Public | Client booking flow |
docs/ARCHITECTURE.md:746:| `/schedule/:shareToken/reschedule/:bookingToken` | `ReschedulePage` | Public | Client reschedule |
docs/ARCHITECTURE.md:776:| `DashboardPage` | Lists all projects as cards, shows block count + booking count + session length, PM gets "Create Project" button |
docs/ARCHITECTURE.md:778:| `ProjectDetailPage` | Full project view: share link copy, stats grid, time blocks table with booking details, "Add Time Blocks" button |
docs/ARCHITECTURE.md:781:| `ReschedulePage` | Shows current booking, available alternative slots, confirm reschedule or cancel entirely |
docs/ARCHITECTURE.md:920:- **Row-level locking** (`FOR UPDATE`) prevents race conditions on booking
docs/ARCHITECTURE.md:925:- The booking endpoints (`/api/schedule/*`) are public (no JWT) but:
docs/ARCHITECTURE.md:927:  - Reschedule/cancel require a cryptographically random `booking_token` (256-bit entropy)
docs/ARCHITECTURE.md:946:| Observability + SLOs | High | Define booking success/error SLOs and API latency targets; add structured logs, metrics, traces, and alerts for booking failures. |
docs/ARCHITECTURE.md:950:| Email notifications | High | Send booking confirmations and .ics attachments via email (Resend, SendGrid, or SES). |
docs/ARCHITECTURE.md:954:| Idempotency keys on booking | Medium | Support `Idempotency-Key` on `/api/schedule/book` to prevent duplicate bookings when clients retry after timeouts. |
docs/ARCHITECTURE.md:957:| Capacity planning + load testing | Medium | Document expected peak booking traffic, validate indexing strategy, and run periodic contention/load tests. |
docs/ARCHITECTURE.md:959:| Booking email domain validation | Medium | Allow projects to define an approved root domain (for example `client.com`) and reject bookings where `email` is outside that domain. |
