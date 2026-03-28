import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type {
  CreateTimeBlockRequest,
  CreateTimeBlocksBatchRequest,
  EngineersResponse,
  ProjectDetail,
  TimeBlocksResponse,
  UserRole
} from '@session-scheduler/shared';

import { apiFetch } from '../api/client.js';
import { useToast } from '../context/ToastContext.js';

interface AddTimeBlockModalProps {
  project: ProjectDetail;
  userRole: UserRole;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

interface EngineerOption {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

function toIsoString(dateValue: string, timeValue: string): string {
  const [yearPart, monthPart, dayPart] = dateValue.split('-');
  const [hoursPart, minutesPart] = timeValue.split(':');

  const year = Number(yearPart || 1970);
  const month = Number(monthPart || 1);
  const day = Number(dayPart || 1);
  const hours = Number(hoursPart || 0);
  const minutes = Number(minutesPart || 0);

  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return date.toISOString();
}

export function AddTimeBlockModal({
  project,
  userRole,
  onClose,
  onCreated
}: AddTimeBlockModalProps): JSX.Element {
  const { showToast } = useToast();
  const now = useMemo(() => new Date(), []);
  const defaultDate = now.toISOString().slice(0, 10);
  const defaultTime = '09:00';

  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState(defaultTime);
  const [slotCount, setSlotCount] = useState(1);
  const [maxSignups, setMaxSignups] = useState(project.is_group_signup ? project.max_group_size : 1);
  const [engineers, setEngineers] = useState<EngineerOption[]>([]);
  const [selectedEngineerIds, setSelectedEngineerIds] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPm = userRole === 'pm';

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

  function toggleEngineer(engineerId: number): void {
    setSelectedEngineerIds((prev) =>
      prev.includes(engineerId)
        ? prev.filter((existingId) => existingId !== engineerId)
        : [...prev, engineerId]
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const firstStart = toIsoString(date, startTime);
      const firstStartMs = new Date(firstStart).getTime();
      const sessionLengthMs = project.session_length_minutes * 60 * 1000;

      if (isPm) {
        const blocks: CreateTimeBlocksBatchRequest['blocks'] = [];

        for (let index = 0; index < slotCount; index += 1) {
          const startMs = firstStartMs + index * sessionLengthMs;
          const endMs = startMs + sessionLengthMs;

          blocks.push({
            start_time: new Date(startMs).toISOString(),
            end_time: new Date(endMs).toISOString(),
            max_signups: project.is_group_signup ? maxSignups : 1,
            engineer_ids: selectedEngineerIds
          });
        }

        const payload: CreateTimeBlocksBatchRequest = {
          project_id: project.id,
          blocks
        };

        await apiFetch<TimeBlocksResponse>('/time-blocks/batch', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      } else {
        const payload: CreateTimeBlockRequest = {
          project_id: project.id,
          start_time: new Date(firstStartMs).toISOString(),
          end_time: new Date(firstStartMs + sessionLengthMs).toISOString(),
          max_signups: 1,
          engineer_ids: []
        };

        await apiFetch<TimeBlocksResponse>('/time-blocks', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      await onCreated();
      showToast(isPm ? 'Time blocks created.' : 'Personal time block created.', 'success');
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
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Add time blocks">
      <div className="modal-card">
        <h3>{isPm ? 'Add Time Blocks' : 'Add Personal Time Block'}</h3>

        <form onSubmit={(event) => void handleSubmit(event)}>
          <label>
            Date
            <input value={date} onChange={(event) => setDate(event.target.value)} type="date" required />
          </label>

          <label>
            Start Time
            <input
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              type="time"
              required
            />
          </label>

          {isPm ? (
            <label>
              Consecutive Slots
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

          <label>
            Max Signups Per Slot
            <input
              value={maxSignups}
              onChange={(event) => setMaxSignups(Number(event.target.value))}
              type="number"
              min={1}
              max={project.is_group_signup ? project.max_group_size : 1}
              disabled={!project.is_group_signup}
              required
            />
          </label>

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
