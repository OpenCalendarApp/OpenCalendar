import { useEffect, useState } from 'react';
import { CalendarSearch, Plus, AlertTriangle, Loader } from 'lucide-react';

import type {
  AvailabilitySolverResponse,
  AvailabilitySuggestion,
  ProjectDetail
} from '@opencalendar/shared';

import { apiFetch } from '../api/client.js';
import { useTimezone } from '../context/TimezoneContext.js';

interface AvailabilitySolverModalProps {
  project: ProjectDetail;
  onClose: () => void;
  onCreateBlock: (startTime: string) => void;
}

export function AvailabilitySolverModal({
  project,
  onClose,
  onCreateBlock
}: AvailabilitySolverModalProps): JSX.Element {
  const { timeZone } = useTimezone();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AvailabilitySolverResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSuggestions(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const result = await apiFetch<AvailabilitySolverResponse>(
          `/projects/${project.id}/availability-solver`
        );
        if (!cancelled) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load suggestions');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchSuggestions();

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  function formatSlotDate(suggestion: AvailabilitySuggestion): string {
    const date = new Date(suggestion.start_time);
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone
    });
  }

  function formatSlotTime(suggestion: AvailabilitySuggestion): string {
    const startDate = new Date(suggestion.start_time);
    const endDate = new Date(suggestion.end_time);
    const start = startDate.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone
    });
    const end = endDate.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone
    });
    return `${start} – ${end}`;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Availability Solver">
      <div className="modal-card solver-modal">
        <div className="solver-header">
          <CalendarSearch size={20} />
          <h3>Find a Time for Everyone</h3>
        </div>

        <p className="hint solver-description">
          Searches calendars for the next available {project.session_length_minutes}-minute windows where
          all assigned engineers are free.
        </p>

        {loading ? (
          <div className="solver-loading">
            <Loader size={24} className="spinner" />
            <p>Checking team calendars&hellip;</p>
          </div>
        ) : error ? (
          <div className="solver-error">
            <p className="error">{error}</p>
            <button type="button" className="secondary-button" onClick={onClose}>
              Close
            </button>
          </div>
        ) : data ? (
          <>
            {data.engineers_without_calendar.length > 0 ? (
              <div className="solver-warning">
                <AlertTriangle size={16} />
                <span>
                  {data.engineers_without_calendar.length === 1
                    ? `${data.engineers_without_calendar[0]} has`
                    : `${data.engineers_without_calendar.length} engineers have`}{' '}
                  no linked calendar — shown as available.
                </span>
              </div>
            ) : null}

            {data.suggestions.length === 0 ? (
              <div className="solver-empty">
                <p className="hint">No open windows found in the next two weeks.</p>
                <p className="hint">Try adjusting engineer assignments or extending the date range.</p>
              </div>
            ) : (
              <div className="solver-list">
                {data.suggestions.map((suggestion) => (
                  <div
                    key={suggestion.start_time}
                    className="solver-suggestion"
                  >
                    <div className="solver-suggestion-info">
                      <span className="solver-suggestion-date">{formatSlotDate(suggestion)}</span>
                      <span className="solver-suggestion-time">{formatSlotTime(suggestion)}</span>
                      <span className="solver-suggestion-engineers">
                        {suggestion.available_engineers.length} engineer{suggestion.available_engineers.length !== 1 ? 's' : ''} available
                      </span>
                    </div>
                    <button
                      type="button"
                      className="solver-create-button"
                      onClick={() => onCreateBlock(suggestion.start_time)}
                      title="Create time block from this suggestion"
                    >
                      <Plus size={14} /> Create Block
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}

        <div className="solver-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
