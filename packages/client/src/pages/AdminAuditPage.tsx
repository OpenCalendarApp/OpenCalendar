import { useCallback, useEffect, useState } from 'react';

import type { AdminAuditEvent, AdminAuditLogResponse } from '@opencalendar/shared';

import { apiFetch } from '../api/client.js';

export function AdminAuditPage(): JSX.Element {
  const [events, setEvents] = useState<AdminAuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetch<AdminAuditLogResponse>('/admin/audit?limit=100');
      setEvents(response.events);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load audit log');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  return (
    <section>
      <div className="header-row">
        <h2>Admin Audit Log</h2>
        <button type="button" className="header-button" onClick={() => void loadEvents()} disabled={isLoading}>
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="detail-card status-card">
          <p className="error">{error}</p>
        </div>
      ) : null}

      {isLoading && events.length === 0 ? (
        <div className="detail-card status-card">
          <p>Loading audit events...</p>
        </div>
      ) : null}

      {!isLoading && events.length === 0 ? (
        <div className="detail-card status-card">
          <p className="hint">No audit events yet.</p>
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="detail-card">
          <table className="block-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.created_at).toLocaleString()}</td>
                  <td>
                    {event.actor_name ?? 'System'}
                    {event.actor_email ? ` (${event.actor_email})` : ''}
                    <br />
                    <small>{event.actor_role}</small>
                  </td>
                  <td>{event.action}</td>
                  <td>
                    {event.entity_type}
                    {event.entity_id !== null ? ` #${event.entity_id}` : ''}
                  </td>
                  <td>
                    <code>{JSON.stringify(event.metadata)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
