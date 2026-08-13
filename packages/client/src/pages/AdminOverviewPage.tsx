import { useCallback, useEffect, useState } from 'react';

import type { AdminOverviewResponse, AdminOverviewStats } from '@opencalendar/shared';

import { apiFetch } from '../api/client.js';

const peopleCards: Array<{ key: keyof AdminOverviewStats; label: string }> = [
  { key: 'total_users', label: 'Total Users' },
  { key: 'active_users', label: 'Active Users' },
  { key: 'admins', label: 'Admins' },
  { key: 'pms', label: 'PMs' },
  { key: 'engineers', label: 'Engineers' }
];

const schedulingCards: Array<{ key: keyof AdminOverviewStats; label: string }> = [
  { key: 'projects', label: 'Projects' },
  { key: 'active_projects', label: 'Active Projects' },
  { key: 'time_blocks', label: 'Time Blocks' },
  { key: 'active_bookings', label: 'Active Bookings' }
];

export function AdminOverviewPage(): JSX.Element {
  const [stats, setStats] = useState<AdminOverviewStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadOverview = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetch<AdminOverviewResponse>('/admin/overview');
      setStats(response.stats);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load admin overview');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  return (
    <section>
      <div className="header-row">
        <h2>Admin Overview</h2>
        <button type="button" className="header-button" onClick={() => void loadOverview()} disabled={isLoading}>
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="detail-card status-card">
          <p className="error">{error}</p>
        </div>
      ) : null}

      {isLoading && !stats ? (
        <div className="detail-card status-card">
          <p>Loading admin stats...</p>
        </div>
      ) : null}

      {stats ? (
        <>
          <p className="hint" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '11px' }}>
            People
          </p>
          <ul className="metrics-hero">
            {peopleCards.map((card) => (
              <li key={card.key} className="metric-card">
                <span className="metric-value">{stats[card.key]}</span>
                <span className="metric-label">{card.label}</span>
              </li>
            ))}
          </ul>

          <p className="hint" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '11px' }}>
            Scheduling
          </p>
          <ul className="metrics-hero">
            {schedulingCards.map((card) => (
              <li key={card.key} className="metric-card">
                <span className="metric-value">{stats[card.key]}</span>
                <span className="metric-label">{card.label}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
