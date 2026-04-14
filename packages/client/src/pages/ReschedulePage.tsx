import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarCheck, Download, XCircle } from 'lucide-react';

import type {
  BookingLookupResponse,
  CancelBookingResponse,
  PublicSlotInfo,
  RescheduleResponse
} from '@opencalendar/shared';

import { apiPublicFetch, buildApiUrl } from '../api/client.js';
import { BrandLogo } from '../components/BrandLogo.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { TimeZoneSelect } from '../components/TimeZoneSelect.js';
import { useTimezone } from '../context/TimezoneContext.js';
import { useToast } from '../context/ToastContext.js';
import {
  formatDateInTimeZone,
  formatDateTimeInTimeZone,
  formatTimeInTimeZone,
  getDateKeyInTimeZone
} from '../utils/timezone.js';

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
}

function formatSlotLabel(slot: { start_time: string; end_time: string }, timeZone: string): string {
  return `${formatDateTimeInTimeZone(slot.start_time, timeZone)} - ${formatTimeInTimeZone(slot.end_time, timeZone)}`;
}

export function ReschedulePage(): JSX.Element {
  const { shareToken, bookingToken } = useParams<{ shareToken: string; bookingToken: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { timeZone } = useTimezone();

  const [lookup, setLookup] = useState<BookingLookupResponse | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [successBookingToken, setSuccessBookingToken] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingToken) {
      setError('Missing booking token');
      setIsLoading(false);
      return;
    }

    void (async () => {
      setIsLoading(true);
      setError(null);
      setCancelMessage(null);

      try {
        const response = await apiPublicFetch<BookingLookupResponse>(`/schedule/booking/${bookingToken}`);

        if (shareToken && response.project.share_token !== shareToken) {
          setLookup(null);
          setError('Reschedule link does not match this project');
          return;
        }

        setLookup(response);
      } catch (loadError) {
        setLookup(null);
        setError(loadError instanceof Error ? loadError.message : 'Unable to load booking');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [bookingToken, shareToken]);

  const slotsByDay = useMemo(() => {
    if (!lookup) {
      return [] as Array<{ dayLabel: string; slots: PublicSlotInfo[] }>;
    }

    const grouped = new Map<string, { dayLabel: string; slots: PublicSlotInfo[] }>();
    for (const slot of lookup.available_slots) {
      const dayKey = getDateKeyInTimeZone(slot.start_time, timeZone);
      const existing = grouped.get(dayKey) ?? {
        dayLabel: formatDateInTimeZone(slot.start_time, timeZone),
        slots: []
      };

      existing.slots.push(slot);
      grouped.set(dayKey, existing);
    }

    return Array.from(grouped.values());
  }, [lookup, timeZone]);

  async function submitReschedule(): Promise<void> {
    if (!bookingToken || selectedSlotId === null) {
      setError('Select a slot to continue');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setCancelMessage(null);

    try {
      const response = await apiPublicFetch<RescheduleResponse>(`/schedule/reschedule/${bookingToken}`, {
        method: 'POST',
        body: JSON.stringify({ new_time_block_id: selectedSlotId })
      });

      setSuccessMessage(response.message);
      setSuccessBookingToken(response.booking.booking_token);
      setSelectedSlotId(null);
      showToast(response.message, 'success');
      navigate(`/schedule/${lookup?.project.share_token ?? shareToken}/reschedule/${response.booking.booking_token}`, {
        replace: true
      });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Unable to reschedule booking';
      setError(message);
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitCancel(): Promise<void> {
    if (!bookingToken) {
      setError('Missing booking token');
      return;
    }

    setIsCancelling(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await apiPublicFetch<CancelBookingResponse>(`/schedule/cancel/${bookingToken}`, {
        method: 'POST'
      });
      setCancelMessage(response.message);
      setLookup(null);
      setIsCancelConfirmOpen(false);
      showToast(response.message, 'success');
    } catch (cancelError) {
      const message = cancelError instanceof Error ? cancelError.message : 'Unable to cancel booking';
      setError(message);
      showToast(message, 'error');
    } finally {
      setIsCancelling(false);
    }
  }

  function downloadCalendar(token: string): void {
    const tokenPrefix = token.slice(0, 8);
    triggerDownload(buildApiUrl(`/schedule/calendar/${token}`), `opencalendar-${tokenPrefix}.ics`);
    showToast('Calendar download started.', 'info');
  }

  if (isLoading) {
    return (
      <section className="center-card">
        <h2>Loading booking...</h2>
      </section>
    );
  }

  if (cancelMessage) {
    return (
      <section className="center-card">
        <h2>Booking Cancelled</h2>
        <p>{cancelMessage}</p>
      </section>
    );
  }

  if (!lookup) {
    return (
      <section className="center-card">
        <h2>Booking unavailable</h2>
        {error ? <p className="error">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="public-booking-page">
      <div className="detail-card">
        <div className="public-brand-bar">
          <BrandLogo className="brand-logo public-brand-logo" />
          <p className="hint public-brand-copy">Review and update your booking below.</p>
        </div>
        <h2>Reschedule: {lookup.project.name}</h2>
        <p>
          Current booking for {lookup.booking.client_first_name} {lookup.booking.client_last_name}
        </p>
        <p className="hint">Current slot: {formatSlotLabel(lookup.current_slot, timeZone)}</p>
        <TimeZoneSelect label="Display Timezone" />
        <button type="button" className="secondary-button" onClick={() => downloadCalendar(lookup.booking.booking_token)}>
          <Download size={16} /> Download Current Calendar (.ics)
        </button>
      </div>

      {successMessage ? (
        <div className="detail-card">
          <p>{successMessage}</p>
          <button
            type="button"
            onClick={() => downloadCalendar(successBookingToken ?? lookup.booking.booking_token)}
          >
            <Download size={16} /> Download Updated Calendar (.ics)
          </button>
        </div>
      ) : null}

      <div className="detail-card">
        <h3>Select a New Slot</h3>

        {lookup.available_slots.length === 0 ? (
          <p className="hint">No alternative slots are currently available.</p>
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
                          name="new-slot"
                          checked={selectedSlotId === slot.time_block_id}
                          onChange={() => setSelectedSlotId(slot.time_block_id)}
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
        )}

        {error ? <p className="error">{error}</p> : null}

        <div className="button-row">
          <button
            type="button"
            onClick={() => void submitReschedule()}
            disabled={isSubmitting || lookup.available_slots.length === 0 || selectedSlotId === null}
          >
            {isSubmitting ? 'Rescheduling...' : <><CalendarCheck size={16} /> Confirm Reschedule</>}
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => setIsCancelConfirmOpen(true)}
            disabled={isCancelling}
          >
            {isCancelling ? 'Cancelling...' : <><XCircle size={16} /> Cancel Booking</>}
          </button>
        </div>
      </div>

      {isCancelConfirmOpen ? (
        <ConfirmDialog
          title="Cancel Booking"
          message="This will permanently cancel the current booking and free the slot."
          confirmLabel="Yes, Cancel Booking"
          tone="danger"
          pending={isCancelling}
          onCancel={() => setIsCancelConfirmOpen(false)}
          onConfirm={submitCancel}
        />
      ) : null}
    </section>
  );
}
