import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Calendar, FolderOpen, Link2Off, Plus } from 'lucide-react';

import type {
  MicrosoftCalendarAuthUrlResponse,
  MicrosoftCalendarStatusResponse,
  ProjectSummary,
  ProjectsResponse
} from '@opencalendar/shared';

import { apiFetch } from '../api/client.js';
import { CreateProjectModal } from '../components/CreateProjectModal.js';
import { OnboardingWizard } from '../components/OnboardingWizard.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';

export function DashboardPage(): JSX.Element {
  const { user } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<MicrosoftCalendarStatusResponse | null>(null);
  const [calendarPending, setCalendarPending] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => user?.onboarding_completed_at === null || user?.onboarding_completed_at === undefined);
  const isEngineer = user?.role === 'engineer';
  const canManageProjects = user?.role === 'pm' || user?.role === 'admin';

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetch<ProjectsResponse>('/projects');
      setProjects(response.projects);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load projects');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const loadCalendarStatus = useCallback(async () => {
    if (!isEngineer) {
      return;
    }

    setCalendarError(null);

    try {
      const status = await apiFetch<MicrosoftCalendarStatusResponse>('/auth/microsoft/status');
      setCalendarStatus(status);
    } catch (loadStatusError) {
      setCalendarError(loadStatusError instanceof Error ? loadStatusError.message : 'Unable to load calendar status');
    }
  }, [isEngineer]);

  useEffect(() => {
    if (!isEngineer) {
      return;
    }
    void loadCalendarStatus();
  }, [isEngineer, loadCalendarStatus]);

  useEffect(() => {
    if (!isEngineer) {
      return;
    }

    const params = new URLSearchParams(location.search);
    const microsoftStatus = params.get('microsoft');
    if (!microsoftStatus) {
      return;
    }

    if (microsoftStatus === 'connected') {
      showToast('Microsoft Calendar connected.', 'success');
      void loadCalendarStatus();
    } else if (microsoftStatus === 'error') {
      const reason = params.get('reason');
      const suffix = reason ? ` (${reason.replaceAll('_', ' ')})` : '';
      showToast(`Microsoft Calendar connection failed${suffix}.`, 'error');
    }

    params.delete('microsoft');
    params.delete('reason');
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : ''
      },
      { replace: true }
    );
  }, [isEngineer, loadCalendarStatus, location.pathname, location.search, navigate, showToast]);

  async function handleConnectMicrosoftCalendar(): Promise<void> {
    setCalendarPending(true);
    setCalendarError(null);

    try {
      const response = await apiFetch<MicrosoftCalendarAuthUrlResponse>('/auth/microsoft/connect');
      window.location.assign(response.authorization_url);
    } catch (connectError) {
      const message = connectError instanceof Error ? connectError.message : 'Unable to start Microsoft OAuth flow';
      setCalendarError(message);
      showToast(message, 'error');
      setCalendarPending(false);
    }
  }

  async function handleDisconnectMicrosoftCalendar(): Promise<void> {
    setCalendarPending(true);
    setCalendarError(null);

    try {
      await apiFetch<unknown>('/auth/microsoft/connection', { method: 'DELETE' });
      showToast('Microsoft Calendar disconnected.', 'success');
      await loadCalendarStatus();
    } catch (disconnectError) {
      const message = disconnectError instanceof Error ? disconnectError.message : 'Unable to disconnect Microsoft Calendar';
      setCalendarError(message);
      showToast(message, 'error');
    } finally {
      setCalendarPending(false);
    }
  }

  return (
    <section>
      <div className="header-row">
        <h2>Dashboard</h2>
        {canManageProjects ? (
          <button type="button" onClick={() => setIsCreateModalOpen(true)} className="header-button">
            <Plus size={16} /> Create Project
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="detail-card status-card">
          <p className="error">{error}</p>
        </div>
      ) : null}

      {showOnboarding ? (
        <OnboardingWizard
          onComplete={() => setShowOnboarding(false)}
          onCreateProject={() => setIsCreateModalOpen(true)}
          onAddTimeBlock={() => {
            const firstProject = projects[0];
            if (firstProject) {
              navigate(`/projects/${firstProject.id}`);
            }
          }}
          shareLink={projects[0]?.share_token ?? null}
        />
      ) : null}

      {isLoading ? (
        <div className="detail-card status-card">
          <p>Loading projects...</p>
        </div>
      ) : null}

      {!isLoading && !error && projects.length === 0 ? (
        <div className="empty-state">
          <FolderOpen size={24} />
          <p className="hint">No projects yet. Create your first project to begin scheduling.</p>
        </div>
      ) : null}

      {isEngineer ? (
        <div className="detail-card status-card">
          <h3><Calendar size={20} /> Microsoft Calendar</h3>
          <p className="hint">
            {calendarStatus?.connected
              ? `Connected as ${calendarStatus.account_email ?? 'your Microsoft account'}`
              : 'Not connected. Connect to auto-sync your assigned bookings.'}
          </p>
          {calendarStatus?.token_expires_at ? (
            <p className="hint">
              Token expires: {new Date(calendarStatus.token_expires_at).toLocaleString()}
            </p>
          ) : null}
          {calendarError ? <p className="error">{calendarError}</p> : null}
          <div className="button-row">
            {calendarStatus?.connected ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleDisconnectMicrosoftCalendar()}
                disabled={calendarPending}
              >
                {calendarPending ? 'Disconnecting...' : <><Link2Off size={16} /> Disconnect Calendar</>}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleConnectMicrosoftCalendar()}
                disabled={calendarPending}
              >
                {calendarPending ? 'Redirecting...' : 'Connect Calendar'}
              </button>
            )}
          </div>
        </div>
      ) : null}

      <ul className="project-grid">
        {projects.map((project) => (
          <li key={project.id}>
            <h3>
              <Link to={`/projects/${project.id}`} className="inline-link">
                {project.name}
              </Link>
            </h3>
            <p>{project.description || 'No description yet.'}</p>
            <small>
              {project.session_length_minutes} min sessions • {project.time_block_count} blocks •{' '}
              {project.active_booking_count} active bookings
            </small>
          </li>
        ))}
      </ul>

      {isCreateModalOpen ? (
        <CreateProjectModal
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={loadProjects}
        />
      ) : null}
    </section>
  );
}
