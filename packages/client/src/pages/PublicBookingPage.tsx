import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import type {
  BookingResponse,
  PublicProjectResponse,
  PublicSlotInfo,
  PublicWaitlistSlotInfo,
  WaitlistJoinResponse
} from '@opencalendar/shared';

import { apiPublicFetch, buildApiUrl } from '../api/client.js';
import { BrandLogo } from '../components/BrandLogo.js';
import { TimeZoneSelect } from '../components/TimeZoneSelect.js';
import { useTimezone } from '../context/TimezoneContext.js';
import { useToast } from '../context/ToastContext.js';
import {
  formatDateInTimeZone,
  formatDateTimeInTimeZone,
  formatTimeInTimeZone,
  getDateKeyInTimeZone
} from '../utils/timezone.js';

type BookingStep = 'password' | 'slot' | 'contact' | 'confirm';
type BookingMode = 'booking' | 'waitlist';

const STEP_ORDER: BookingStep[] = ['password', 'slot', 'contact', 'confirm'];
const STEP_LABELS: Record<BookingStep, string> = {
  password: 'Password',
  slot: 'Select Time',
  contact: 'Your Details',
  confirm: 'Confirmed'
};

function BookingProgressBar({ current }: { current: BookingStep }): JSX.Element {
  const currentIndex = STEP_ORDER.indexOf(current);

  return (
    <nav className="booking-progress" aria-label="Booking progress">
      <ol>
        {STEP_ORDER.map((stepKey, index) => {
          let status: string;
          if (index < currentIndex) {
            status = 'completed';
          } else if (index === currentIndex) {
            status = 'active';
          } else {
            status = 'upcoming';
          }

          return (
            <li key={stepKey} className={`booking-progress-step ${status}`}>
              <span className="booking-progress-indicator">
                {status === 'completed' ? '✓' : index + 1}
              </span>
              <span className="booking-progress-label">{STEP_LABELS[stepKey]}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface ContactFormState {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
}

function formatSlotLabel(slot: PublicSlotInfo, timeZone: string): string {
  return `${formatDateTimeInTimeZone(slot.start_time, timeZone)} - ${formatTimeInTimeZone(slot.end_time, timeZone)}`;
}

function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function PublicBookingPage(): JSX.Element {
  const { shareToken } = useParams<{ shareToken: string }>();
  const { showToast } = useToast();
  const { timeZone } = useTimezone();

  const [step, setStep] = useState<BookingStep>('password');
  const [bookingMode, setBookingMode] = useState<BookingMode>('booking');
  const [password, setPassword] = useState('');
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [contact, setContact] = useState<ContactFormState>({
    first_name: '',
    last_name: '',
    email: '',
    phone: ''
  });

  const [projectResponse, setProjectResponse] = useState<PublicProjectResponse | null>(null);
  const [bookingResponse, setBookingResponse] = useState<BookingResponse | null>(null);
  const [waitlistResponse, setWaitlistResponse] = useState<WaitlistJoinResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shareToken) {
      setIsLoading(false);
      setError('Missing share token');
      return;
    }

    void (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await apiPublicFetch<PublicProjectResponse>(`/schedule/project/${shareToken}`);
        setProjectResponse(response);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load project booking page');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [shareToken]);

  const selectedAvailableSlot = useMemo(() => {
    if (!projectResponse || selectedSlotId === null) {
      return null;
    }

    return projectResponse.available_slots.find((slot) => slot.time_block_id === selectedSlotId) ?? null;
  }, [projectResponse, selectedSlotId]);

  const selectedWaitlistSlot = useMemo(() => {
    if (!projectResponse || selectedSlotId === null) {
      return null;
    }

    return projectResponse.full_slots.find((slot) => slot.time_block_id === selectedSlotId) ?? null;
  }, [projectResponse, selectedSlotId]);

  const selectedSlot = selectedAvailableSlot ?? selectedWaitlistSlot;

  const slotsByDay = useMemo(() => {
    if (!projectResponse) {
      return [] as Array<{ dayLabel: string; slots: PublicSlotInfo[] }>;
    }

    const grouped = new Map<string, { dayLabel: string; slots: PublicSlotInfo[] }>();

    for (const slot of projectResponse.available_slots) {
      const dayKey = getDateKeyInTimeZone(slot.start_time, timeZone);
      const existing = grouped.get(dayKey) ?? {
        dayLabel: formatDateInTimeZone(slot.start_time, timeZone),
        slots: []
      };

      existing.slots.push(slot);
      grouped.set(dayKey, existing);
    }

    return Array.from(grouped.values());
  }, [projectResponse, timeZone]);

  const fullSlotsByDay = useMemo(() => {
    if (!projectResponse) {
      return [] as Array<{ dayLabel: string; slots: PublicWaitlistSlotInfo[] }>;
    }

    const grouped = new Map<string, { dayLabel: string; slots: PublicWaitlistSlotInfo[] }>();

    for (const slot of projectResponse.full_slots) {
      const dayKey = getDateKeyInTimeZone(slot.start_time, timeZone);
      const existing = grouped.get(dayKey) ?? {
        dayLabel: formatDateInTimeZone(slot.start_time, timeZone),
        slots: []
      };

      existing.slots.push(slot);
      grouped.set(dayKey, existing);
    }

    return Array.from(grouped.values());
  }, [projectResponse, timeZone]);

  async function submitBooking(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!shareToken || selectedSlotId === null) {
      setError('Please select a time slot before continuing');
      return;
    }

    const phoneDigits = contact.phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      setError('Please enter a valid 10-digit phone number in (XXX) XXX-XXXX format');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (bookingMode === 'waitlist') {
        const response = await apiPublicFetch<WaitlistJoinResponse>(`/schedule/waitlist/${shareToken}`, {
          method: 'POST',
          body: JSON.stringify({
            password,
            time_block_id: selectedSlotId,
            ...contact
          })
        });

        setBookingResponse(null);
        setWaitlistResponse(response);
        setStep('confirm');
        showToast(response.already_exists ? 'Already on waitlist.' : 'Added to waitlist.', 'success');
      } else {
        const response = await apiPublicFetch<BookingResponse>(`/schedule/book/${shareToken}`, {
          method: 'POST',
          body: JSON.stringify({
            password,
            time_block_id: selectedSlotId,
            ...contact
          })
        });

        setWaitlistResponse(null);
        setBookingResponse(response);
        setStep('confirm');
        showToast('Booking confirmed.', 'success');
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Unable to complete booking';
      setError(message);
      showToast(message, 'error');

      if (message.toLowerCase().includes('password')) {
        setStep('password');
      } else if (
        message.toLowerCase().includes('full') ||
        message.toLowerCase().includes('no longer available')
      ) {
        setBookingMode('waitlist');
        setStep('contact');
      } else if (message.toLowerCase().includes('book directly')) {
        setBookingMode('booking');
        setStep('contact');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetFlow(): void {
    setStep('password');
    setBookingMode('booking');
    setPassword('');
    setSelectedSlotId(null);
    setContact({
      first_name: '',
      last_name: '',
      email: '',
      phone: ''
    });
    setBookingResponse(null);
    setWaitlistResponse(null);
    setError(null);
  }

  function downloadCalendar(bookingToken: string): void {
    const tokenPrefix = bookingToken.slice(0, 8);
    triggerDownload(
      buildApiUrl(`/schedule/calendar/${bookingToken}`),
      `opencalendar-${tokenPrefix}.ics`
    );
    showToast('Calendar download started.', 'info');
  }

  if (isLoading) {
    return (
      <section className="center-card">
        <h2>Loading booking page...</h2>
      </section>
    );
  }

  if (error && !projectResponse) {
    return (
      <section className="center-card">
        <h2>Booking unavailable</h2>
        <p className="error">{error}</p>
      </section>
    );
  }

  if (!projectResponse) {
    return (
      <section className="center-card">
        <h2>Booking unavailable</h2>
      </section>
    );
  }

  return (
    <section className="public-booking-page">
      <div className="detail-card">
        <div className="public-brand-bar">
          <BrandLogo className="brand-logo public-brand-logo" />
          <p className="hint public-brand-copy">Simple, professional scheduling — powered by Calendar Genie.</p>
        </div>
        <h2>{projectResponse.project.name}</h2>
        <p>{projectResponse.project.description || 'No project description provided.'}</p>
        <TimeZoneSelect label="Display Timezone" />
      </div>

      <BookingProgressBar current={step} />

      {step === 'password' ? (
        <form className="detail-card" onSubmit={(event) => {
          event.preventDefault();
          if (!password.trim()) {
            setError('Project password is required');
            return;
          }

          setError(null);
          setStep('slot');
        }}>
          <h3>Project Password</h3>
          <label>
            Password
            <input
              type="password"
              minLength={1}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error ? <p className="error">{error}</p> : null}

          <button type="submit">Continue</button>
        </form>
      ) : null}

      {step === 'slot' ? (
        <div className="detail-card">
          <h3>Select a Time Slot</h3>

          {projectResponse.available_slots.length === 0 && projectResponse.full_slots.length === 0 ? (
            <p className="hint">No upcoming slots remain for this project.</p>
          ) : null}

          {projectResponse.available_slots.length > 0 ? (
            <div className="slot-groups">
              {slotsByDay.map((group) => (
                <div key={group.dayLabel} className="slot-group">
                  <h4>{group.dayLabel}</h4>
                  <ul className="block-list">
                    {group.slots.map((slot) => (
                      <li key={slot.time_block_id}>
                        <label className="checkbox-label">
                          <input
                            type="radio"
                            name="selected-slot"
                            checked={bookingMode === 'booking' && selectedSlotId === slot.time_block_id}
                            onChange={() => {
                              setSelectedSlotId(slot.time_block_id);
                              setBookingMode('booking');
                            }}
                          />
                          <span>
                            <strong>{formatSlotLabel(slot, timeZone)}</strong>
                            <br />
                            Remaining: {slot.remaining_slots}
                            <br />
                            Engineers:{' '}
                            {slot.engineers.length > 0
                              ? slot.engineers
                                  .map((engineer) => `${engineer.first_name} ${engineer.last_name}`)
                                  .join(', ')
                              : 'Unassigned'}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">No currently open slots. You can still join the waitlist below.</p>
          )}

          {projectResponse.full_slots.length > 0 ? (
            <div className="slot-groups">
              <h4>Fully Booked Slots (Join Waitlist)</h4>
              {fullSlotsByDay.map((group) => (
                <div key={`waitlist-${group.dayLabel}`} className="slot-group">
                  <h4>{group.dayLabel}</h4>
                  <ul className="block-list">
                    {group.slots.map((slot) => (
                      <li key={slot.time_block_id}>
                        <label className="checkbox-label">
                          <input
                            type="radio"
                            name="selected-slot"
                            checked={bookingMode === 'waitlist' && selectedSlotId === slot.time_block_id}
                            onChange={() => {
                              setSelectedSlotId(slot.time_block_id);
                              setBookingMode('waitlist');
                            }}
                          />
                          <span>
                            <strong>{formatSlotLabel(slot, timeZone)}</strong>
                            <br />
                            Status: Full
                            <br />
                            Waitlist count: {slot.waitlist_count}
                            <br />
                            Engineers:{' '}
                            {slot.engineers.length > 0
                              ? slot.engineers
                                  .map((engineer) => `${engineer.first_name} ${engineer.last_name}`)
                                  .join(', ')
                              : 'Unassigned'}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}

          {error ? <p className="error">{error}</p> : null}

          <div className="button-row">
            <button type="button" className="secondary-button" onClick={() => setStep('password')}>
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (selectedSlotId === null) {
                  setError('Select a slot to continue');
                  return;
                }

                setError(null);
                setStep('contact');
              }}
              disabled={projectResponse.available_slots.length === 0 && projectResponse.full_slots.length === 0}
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {step === 'contact' ? (
        <form className="detail-card" onSubmit={(event) => void submitBooking(event)}>
          <h3>Your Details {bookingMode === 'waitlist' ? '(Waitlist)' : ''}</h3>

          {selectedSlot ? <p className="hint">Selected slot: {formatSlotLabel(selectedSlot, timeZone)}</p> : null}
          {bookingMode === 'waitlist' ? (
            <p className="hint">This slot is currently full. We will notify you if a spot opens.</p>
          ) : null}

          <label>
            First Name
            <input
              type="text"
              value={contact.first_name}
              onChange={(event) =>
                setContact((prev) => ({ ...prev, first_name: event.target.value }))
              }
              required
            />
          </label>

          <label>
            Last Name
            <input
              type="text"
              value={contact.last_name}
              onChange={(event) => setContact((prev) => ({ ...prev, last_name: event.target.value }))}
              required
            />
          </label>

          <label>
            Email
            <input
              type="email"
              value={contact.email}
              onChange={(event) => setContact((prev) => ({ ...prev, email: event.target.value }))}
              required
            />
          </label>

          <label>
            Phone
            <input
              type="tel"
              inputMode="numeric"
              placeholder="(XXX) XXX-XXXX"
              value={contact.phone}
              onChange={(event) =>
                setContact((prev) => ({ ...prev, phone: formatPhoneNumber(event.target.value) }))
              }
              required
            />
          </label>

          {error ? <p className="error">{error}</p> : null}

          <div className="button-row">
            <button type="button" className="secondary-button" onClick={() => setStep('slot')}>
              Back
            </button>
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? (bookingMode === 'waitlist' ? 'Joining waitlist...' : 'Booking...')
                : (bookingMode === 'waitlist' ? 'Join Waitlist' : 'Confirm Booking')}
            </button>
          </div>
        </form>
      ) : null}

      {step === 'confirm' && bookingResponse ? (
        <div className="detail-card">
          <h3>Booking Confirmed ✓</h3>
          <p>
            Booking confirmed for {bookingResponse.booking.client_first_name}{' '}
            {bookingResponse.booking.client_last_name}.
          </p>
          <p className="hint">
            Need to make a change?{' '}
            <a className="inline-link" href={bookingResponse.reschedule_url}>
              Reschedule or cancel this booking
            </a>
            .
          </p>

          <div className="button-row">
            <button
              type="button"
              onClick={() => downloadCalendar(bookingResponse.booking.booking_token)}
            >
              Download Calendar (.ics)
            </button>
            <button type="button" className="secondary-button" onClick={resetFlow}>
              Book Another Slot
            </button>
          </div>
        </div>
      ) : null}

      {step === 'confirm' && !bookingResponse && waitlistResponse ? (
        <div className="detail-card">
          <h3>Waitlist Confirmed ✓</h3>
          <p>{waitlistResponse.message}</p>
          {selectedSlot ? <p className="hint">Requested slot: {formatSlotLabel(selectedSlot, timeZone)}</p> : null}
          <div className="button-row">
            <button type="button" className="secondary-button" onClick={resetFlow}>
              Done
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
