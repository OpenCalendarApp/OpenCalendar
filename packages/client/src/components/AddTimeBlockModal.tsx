import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type {
  CreateRecurringTimeBlocksRequest,
  CreateTimeBlockRequest,
  CreateTimeBlocksBatchRequest,
  EngineersResponse,
  ProjectDetail,
  TimeBlocksResponse,
  UserRole
} from '@opencalendar/shared';

import { apiFetch } from '../api/client.js';
import { TimeZoneSelect } from './TimeZoneSelect.js';
import { useTimezone } from '../context/TimezoneContext.js';
import { useToast } from '../context/ToastContext.js';
import { getCurrentDateKeyInTimeZone, toIsoStringInTimeZone } from '../utils/timezone.js';
import { useFocusTrap } from '../utils/useFocusTrap.js';

interface AddTimeBlockModalProps {
  project: ProjectDetail;
  userRole: UserRole;
  onClose: () => void;
  onCreated: () => Promise<void>;
  initialStartTime?: string;
}

interface EngineerOption {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

interface CalendarDayCell {
  dateKey: string;
  dayOfMonth: number;
  inCurrentMonth: boolean;
  isToday: boolean;
}

const calendarWeekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const slotLengthOptions = [15, 30, 45, 60];

function formatDateKey(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey: string): Date {
  const [yearPart, monthPart, dayPart] = dateKey.split('-');
  const year = Number(yearPart || 1970);
  const month = Number(monthPart || 1);
  const day = Number(dayPart || 1);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildCalendarDayCells(monthStart: Date, todayKey: string): CalendarDayCell[] {
  const firstVisibleDate = addDays(monthStart, -monthStart.getDay());
  const cells: CalendarDayCell[] = [];

  for (let index = 0; index < 42; index += 1) {
    const cellDate = addDays(firstVisibleDate, index);
    const dateKey = formatDateKey(cellDate);
    cells.push({
      dateKey,
      dayOfMonth: cellDate.getDate(),
      inCurrentMonth: cellDate.getMonth() === monthStart.getMonth(),
      isToday: dateKey === todayKey
    });
  }

  return cells;
}

function formatDateLabel(dateKey: string): string {
  return parseDateKey(dateKey).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

interface LocalDateTimeValue {
  dateKey: string;
  timeValue: string;
}

function shiftLocalDateTimeByMinutes(
  dateKey: string,
  timeValue: string,
  minutesToAdd: number
): LocalDateTimeValue {
  const [yearPart, monthPart, dayPart] = dateKey.split('-');
  const [hourPart, minutePart] = timeValue.split(':');

  const year = Number(yearPart || 1970);
  const month = Number(monthPart || 1);
  const day = Number(dayPart || 1);
  const hour = Number(hourPart || 0);
  const minute = Number(minutePart || 0);

  const shifted = new Date(Date.UTC(year, month - 1, day, hour, minute + minutesToAdd, 0, 0));
  const shiftedYear = shifted.getUTCFullYear().toString().padStart(4, '0');
  const shiftedMonth = (shifted.getUTCMonth() + 1).toString().padStart(2, '0');
  const shiftedDay = shifted.getUTCDate().toString().padStart(2, '0');
  const shiftedHour = shifted.getUTCHours().toString().padStart(2, '0');
  const shiftedMinute = shifted.getUTCMinutes().toString().padStart(2, '0');

  return {
    dateKey: `${shiftedYear}-${shiftedMonth}-${shiftedDay}`,
    timeValue: `${shiftedHour}:${shiftedMinute}`
  };
}

function buildSlotIsoWindow(args: {
  dateKey: string;
  startTime: string;
  slotIndex: number;
  slotLengthMinutes: number;
  timeZone: string;
}): { start_time: string; end_time: string } {
  const startOffsetMinutes = args.slotIndex * args.slotLengthMinutes;
  const endOffsetMinutes = (args.slotIndex + 1) * args.slotLengthMinutes;
  const localStart = shiftLocalDateTimeByMinutes(args.dateKey, args.startTime, startOffsetMinutes);
  const localEnd = shiftLocalDateTimeByMinutes(args.dateKey, args.startTime, endOffsetMinutes);

  return {
    start_time: toIsoStringInTimeZone(localStart.dateKey, localStart.timeValue, args.timeZone),
    end_time: toIsoStringInTimeZone(localEnd.dateKey, localEnd.timeValue, args.timeZone)
  };
}

export function AddTimeBlockModal({
  project,
  userRole,
  onClose,
  onCreated,
  initialStartTime
}: AddTimeBlockModalProps): JSX.Element {
  const { showToast } = useToast();
  const { timeZone } = useTimezone();
  const containerRef = useFocusTrap<HTMLDivElement>();
  const defaultDate = useMemo(() => getCurrentDateKeyInTimeZone(timeZone), [timeZone]);
  const [defaultYearPart, defaultMonthPart] = defaultDate.split('-');
  const defaultYear = Number(defaultYearPart || 1970);
  const defaultMonth = Number(defaultMonthPart || 1);
  const defaultTime = '09:00';

  const prefill = useMemo(() => {
    if (!initialStartTime) return null;
    const startDate = new Date(initialStartTime);
    const dateKey = formatDateKey(startDate);
    const hours = startDate.getHours().toString().padStart(2, '0');
    const minutes = startDate.getMinutes().toString().padStart(2, '0');
    return { dateKey, timeValue: `${hours}:${minutes}` };
  }, [initialStartTime]);

  const [selectedDates, setSelectedDates] = useState<string[]>([prefill?.dateKey ?? defaultDate]);
  const [viewMonthStart, setViewMonthStart] = useState(() => {
    if (prefill) {
      const [yearPart, monthPart] = prefill.dateKey.split('-');
      return new Date(Number(yearPart || 1970), Number(monthPart || 1) - 1, 1);
    }
    return new Date(defaultYear, defaultMonth - 1, 1);
  });
  const [startTime, setStartTime] = useState(prefill?.timeValue ?? defaultTime);
  const [slotLengthMinutes, setSlotLengthMinutes] = useState(() =>
    slotLengthOptions.includes(project.session_length_minutes) ? project.session_length_minutes : 60
  );
  const [slotCount, setSlotCount] = useState(1);
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [recurrenceIntervalWeeks, setRecurrenceIntervalWeeks] = useState(1);
  const [recurrenceOccurrences, setRecurrenceOccurrences] = useState(4);
  const [maxSignups, setMaxSignups] = useState(project.is_group_signup ? project.max_group_size : 1);
  const [engineers, setEngineers] = useState<EngineerOption[]>([]);
  const [selectedEngineerIds, setSelectedEngineerIds] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPm = userRole === 'pm' || userRole === 'admin';
  const maxSignupsLimit = project.is_group_signup ? project.max_group_size : 1;
  const canEditMaxSignups = isPm && project.is_group_signup && maxSignupsLimit > 1;
  const todayKey = useMemo(() => getCurrentDateKeyInTimeZone(timeZone), [timeZone]);
  const calendarDayCells = useMemo(
    () => buildCalendarDayCells(viewMonthStart, todayKey),
    [todayKey, viewMonthStart]
  );
  const selectedDatesSorted = useMemo(() => [...selectedDates].sort(), [selectedDates]);
  const viewMonthLabel = useMemo(
    () =>
      viewMonthStart.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric'
      }),
    [viewMonthStart]
  );

  useEffect(() => {
    if (!isPm) {
      return;
    }

    void (async () => {
      try {
        const response = await apiFetch<EngineersResponse>('/auth/engineers');
        setEngineers(response.engineers);
      } catch {
        setError('Unable to load engineers for assignment');
      }
    })();
  }, [isPm]);

  // Close modal on Escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !pending) {
        onClose();
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose, pending]);

  function toggleEngineer(engineerId: number): void {
    setSelectedEngineerIds((prev) =>
      prev.includes(engineerId)
        ? prev.filter((existingId) => existingId !== engineerId)
        : [...prev, engineerId]
    );
  }

  function shiftCalendarMonth(offset: number): void {
    setViewMonthStart((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  }

  function toggleDate(dateKey: string): void {
    if (!isPm) {
      setSelectedDates([dateKey]);
      return;
    }

    setSelectedDates((prev) => {
      if (prev.includes(dateKey)) {
        if (prev.length === 1) {
          return prev;
        }
        return prev.filter((existing) => existing !== dateKey);
      }

      return [...prev, dateKey];
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const targetDates = [...new Set(selectedDates)].sort();
      if (targetDates.length === 0) {
        throw new Error('Select at least one date');
      }

      if (isPm) {
        if (recurringEnabled) {
          if (targetDates.length !== 1) {
            throw new Error('Recurring schedule supports one selected start date at a time');
          }
          const singleDate = targetDates[0];
          if (!singleDate) {
            throw new Error('Select one date for recurring schedule');
          }

          const firstWindow = buildSlotIsoWindow({
            dateKey: singleDate,
            startTime,
            slotIndex: 0,
            slotLengthMinutes,
            timeZone
          });
          const recurringPayload: CreateRecurringTimeBlocksRequest = {
            project_id: project.id,
            start_time: firstWindow.start_time,
            end_time: firstWindow.end_time,
            max_signups: project.is_group_signup ? maxSignups : 1,
            engineer_ids: selectedEngineerIds,
            slots_per_occurrence: slotCount,
            recurrence: {
              frequency: 'weekly',
              interval_weeks: recurrenceIntervalWeeks,
              occurrences: recurrenceOccurrences
            }
          };

          await apiFetch<TimeBlocksResponse>('/time-blocks/recurring', {
            method: 'POST',
            body: JSON.stringify(recurringPayload)
          });
        } else {
          const blocks: CreateTimeBlocksBatchRequest['blocks'] = [];

          for (const dateKey of targetDates) {
            for (let index = 0; index < slotCount; index += 1) {
              const window = buildSlotIsoWindow({
                dateKey,
                startTime,
                slotIndex: index,
                slotLengthMinutes,
                timeZone
              });

              blocks.push({
                start_time: window.start_time,
                end_time: window.end_time,
                max_signups: project.is_group_signup ? maxSignups : 1,
                engineer_ids: selectedEngineerIds
              });
            }
          }

          const payload: CreateTimeBlocksBatchRequest = {
            project_id: project.id,
            blocks
          };

          await apiFetch<TimeBlocksResponse>('/time-blocks/batch', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
        }
      } else {
        for (const dateKey of targetDates) {
          const window = buildSlotIsoWindow({
            dateKey,
            startTime,
            slotIndex: 0,
            slotLengthMinutes,
            timeZone
          });

          const payload: CreateTimeBlockRequest = {
            project_id: project.id,
            start_time: window.start_time,
            end_time: window.end_time,
            max_signups: 1,
            engineer_ids: []
          };

          await apiFetch<TimeBlocksResponse>('/time-blocks', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
        }
      }

      await onCreated();
      showToast(
        isPm
          ? recurringEnabled
            ? 'Recurring time blocks created.'
            : 'Time blocks created.'
          : targetDates.length > 1
            ? 'Personal time blocks created.'
            : 'Personal time block created.',
        'success'
      );
      onClose();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Unable to create time block(s)';
      setError(message);
      showToast(message, 'error');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="add-time-block-title">
      <div className="modal-card" ref={containerRef}>
        <h3 id="add-time-block-title">{isPm ? 'Add Time Blocks' : 'Add Personal Time Block'}</h3>

        <form onSubmit={(event) => void handleSubmit(event)}>
          <div className="calendar-panel">
            <div className="calendar-header-row">
              <button
                type="button"
                className="small-button secondary-button"
                onClick={() => shiftCalendarMonth(-1)}
              >
                Previous
              </button>
              <strong>{viewMonthLabel}</strong>
              <button
                type="button"
                className="small-button secondary-button"
                onClick={() => shiftCalendarMonth(1)}
              >
                Next
              </button>
            </div>

            <div className="calendar-weekdays">
              {calendarWeekdayLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>

            <div className="calendar-grid" role="grid" aria-label="Date picker">
              {calendarDayCells.map((cell) => {
                const isSelected = selectedDates.includes(cell.dateKey);
                const label = [
                  formatDateLabel(cell.dateKey),
                  cell.isToday ? '(today)' : '',
                  isSelected ? '(selected)' : ''
                ].filter(Boolean).join(' ');
                return (
                  <button
                    key={cell.dateKey}
                    type="button"
                    className={`calendar-day${isSelected ? ' selected' : ''}${cell.inCurrentMonth ? '' : ' outside'}${cell.isToday ? ' today' : ''}`}
                    onClick={() => toggleDate(cell.dateKey)}
                    aria-label={label}
                    aria-pressed={isSelected}
                  >
                    {cell.dayOfMonth}
                  </button>
                );
              })}
            </div>

            <p className="hint">
              {isPm
                ? 'Click days to select or deselect. Same time slot settings apply to all selected days.'
                : 'Select a date for your personal time block.'}
            </p>
            <p className="hint">Selected: {selectedDatesSorted.map(formatDateLabel).join(', ')}</p>
          </div>

          <label>
            Start Time
            <input
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              type="time"
              required
            />
          </label>

          <TimeZoneSelect label="Timezone" />
          <p className="hint">Selected timezone applies to all created slots.</p>

          <label>
            Slot Length
            <select
              value={slotLengthMinutes}
              onChange={(event) => setSlotLengthMinutes(Number(event.target.value))}
            >
              {slotLengthOptions.map((lengthMinutes) => (
                <option key={lengthMinutes} value={lengthMinutes}>
                  {lengthMinutes} minutes
                </option>
              ))}
            </select>
          </label>

          {isPm ? (
            <label>
              {recurringEnabled ? 'Slots Per Occurrence' : 'Consecutive Slots'}
              <input
                value={slotCount}
                onChange={(event) => setSlotCount(Number(event.target.value))}
                type="number"
                min={1}
                max={24}
                required
              />
            </label>
          ) : null}

          {isPm ? (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={recurringEnabled}
                onChange={(event) => setRecurringEnabled(event.target.checked)}
              />
              <span>Create recurring weekly schedule</span>
            </label>
          ) : null}

          {isPm && recurringEnabled ? (
            <>
              <label>
                Repeat Every (Weeks)
                <input
                  value={recurrenceIntervalWeeks}
                  onChange={(event) => setRecurrenceIntervalWeeks(Number(event.target.value))}
                  type="number"
                  min={1}
                  max={26}
                  required
                />
              </label>

              <label>
                Number of Occurrences
                <input
                  value={recurrenceOccurrences}
                  onChange={(event) => setRecurrenceOccurrences(Number(event.target.value))}
                  type="number"
                  min={2}
                  max={52}
                  required
                />
              </label>
            </>
          ) : null}

          <label>
            Max Signups Per Slot
            <input
              value={maxSignups}
              onChange={(event) =>
                setMaxSignups(Math.min(maxSignupsLimit, Math.max(1, Number(event.target.value))))
              }
              type="number"
              min={1}
              max={maxSignupsLimit}
              disabled={!canEditMaxSignups}
              required
            />
          </label>
          {!isPm ? <p className="hint">Personal blocks always use 1 signup slot.</p> : null}
          {isPm && !project.is_group_signup ? (
            <p className="hint">This project is set to individual signup, so max signups per slot stays at 1.</p>
          ) : null}
          {isPm && project.is_group_signup && maxSignupsLimit <= 1 ? (
            <p className="hint">
              Project max group size is 1. Increase "Max Group Size" in project settings to allow higher slot capacity.
            </p>
          ) : null}

          {isPm ? (
            <fieldset className="selection-grid">
              <legend>Assign Engineers</legend>
              {engineers.length === 0 ? <p className="hint">No engineers available for assignment.</p> : null}
              {engineers.map((engineer) => (
                <label key={engineer.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedEngineerIds.includes(engineer.id)}
                    onChange={() => toggleEngineer(engineer.id)}
                  />
                  <span>
                    {engineer.first_name} {engineer.last_name} ({engineer.email})
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="hint">This block will be created as your personal assignment.</p>
          )}

          {error ? <p className="error">{error}</p> : null}

          <div className="button-row">
            <button type="button" className="secondary-button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button type="submit" disabled={pending}>
              {pending ? 'Saving...' : isPm ? 'Create Blocks' : 'Create Block'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
