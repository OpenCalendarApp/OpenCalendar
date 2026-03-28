import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import type { BookingResponse, PublicProjectResponse, PublicSlotInfo } from '@session-scheduler/shared';

import { apiFetch, buildApiUrl } from '../api/client.js';
import { useToast } from '../context/ToastContext.js';

type BookingStep = 'password' | 'slot' | 'contact' | 'confirm';

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

function formatSlotLabel(slot: PublicSlotInfo): string {
  const start = new Date(slot.start_time);
  const end = new Date(slot.end_time);

  return `${start.toLocaleString()} - ${end.toLocaleTimeString()}`;
}

export function PublicBookingPage(): JSX.Element {
  const { shareToken } = useParams<{ shareToken: string }>();
  const { showToast } = useToast();

  const [step, setStep] = useState<BookingStep>('password');
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
        const response = await apiFetch<PublicProjectResponse>(`/schedule/project/${shareToken}`);
        setProjectResponse(response);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load project booking page');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [shareToken]);

  const selectedSlot = useMemo(() => {
    if (!projectResponse || selectedSlotId === null) {
      return null;
    }

    return projectResponse.available_slots.find((slot) => slot.time_block_id === selectedSlotId) ?? null;
  }, [projectResponse, selectedSlotId]);

  const slotsByDay = useMemo(() => {
    if (!projectResponse) {
      return [] as Array<{ dayLabel: string; slots: PublicSlotInfo[] }>;
    }

    const grouped = new Map<string, PublicSlotInfo[]>();

    for (const slot of projectResponse.available_slots) {
      const dayLabel = new Date(slot.start_time).toLocaleDateString();
      const existing = grouped.get(dayLabel) ?? [];
      existing.push(slot);
      grouped.set(dayLabel, existing);
    }

    return Array.from(grouped.entries()).map(([dayLabel, slots]) => ({ dayLabel, slots }));
  }, [projectResponse]);

  async function submitBooking(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!shareToken || selectedSlotId === null) {
      setError('Please select a time slot before continuing');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await apiFetch<BookingResponse>(`/schedule/book/${shareToken}`, {
        method: 'POST',
        body: JSON.stringify({
          password,
          time_block_id: selectedSlotId,
          ...contact
        })
      });

      setBookingResponse(response);
      setStep('confirm');
      showToast('Booking confirmed.', 'success');
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
        setStep('slot');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetFlow(): void {
    setStep('password');
    setPassword('');
    setSelectedSlotId(null);
    setContact({
      first_name: '',
      last_name: '',
      email: '',
      phone: ''
    });
    setBookingResponse(null);
    setError(null);
  }

  function downloadCalendar(bookingToken: string): void {
    const tokenPrefix = bookingToken.slice(0, 8);
    triggerDownload(
      buildApiUrl(`/schedule/calendar/${bookingToken}`),
      `session-${tokenPrefix}.ics`
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
        <h2>{projectResponse.project.name}</h2>
        <p>{projectResponse.project.description || 'No project description provided.'}</p>
      </div>

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
          <h3>Step 1: Project Password</h3>
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
          <h3>Step 2: Select a Slot</h3>

          {projectResponse.available_slots.length === 0 ? (
            <p className="hint">No available slots remain for this project.</p>
          ) : (
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
                            checked={selectedSlotId === slot.time_block_id}
                            onChange={() => setSelectedSlotId(slot.time_block_id)}
                          />
                          <span>
                            <strong>{formatSlotLabel(slot)}</strong>
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
          )}

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
              disabled={projectResponse.available_slots.length === 0}
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {step === 'contact' ? (
        <form className="detail-card" onSubmit={(event) => void submitBooking(event)}>
          <h3>Step 3: Contact Details</h3>

          {selectedSlot ? <p className="hint">Selected slot: {formatSlotLabel(selectedSlot)}</p> : null}

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
              value={contact.phone}
              onChange={(event) => setContact((prev) => ({ ...prev, phone: event.target.value }))}
              required
            />
          </label>

          {error ? <p className="error">{error}</p> : null}

          <div className="button-row">
            <button type="button" className="secondary-button" onClick={() => setStep('slot')}>
              Back
            </button>
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Booking...' : 'Confirm Booking'}
            </button>
          </div>
        </form>
      ) : null}

      {step === 'confirm' && bookingResponse ? (
        <div className="detail-card">
          <h3>Step 4: Confirmed</h3>
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
    </section>
  );
}
