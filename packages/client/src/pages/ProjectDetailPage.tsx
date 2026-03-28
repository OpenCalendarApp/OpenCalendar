import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import type {
  ProjectDetail,
  ProjectDetailResponse,
  ProjectResponse,
  TimeBlockWithRelations,
  UpdateProjectRequest
} from '@session-scheduler/shared';

import { apiFetch } from '../api/client.js';
import { AddTimeBlockModal } from '../components/AddTimeBlockModal.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';

interface ProjectFormState {
  name: string;
  description: string;
  sessionLengthMinutes: number;
  isGroupSignup: boolean;
  maxGroupSize: number;
  isActive: boolean;
  signupPassword: string;
}

type ConfirmAction =
  | { type: 'delete-project' }
  | { type: 'delete-time-block'; timeBlockId: number };

function toFormState(project: ProjectDetail): ProjectFormState {
  return {
    name: project.name,
    description: project.description,
    sessionLengthMinutes: project.session_length_minutes,
    isGroupSignup: project.is_group_signup,
    maxGroupSize: project.max_group_size,
    isActive: project.is_active,
    signupPassword: ''
  };
}

export function ProjectDetailPage(): JSX.Element {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [form, setForm] = useState<ProjectFormState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [blockDeletePendingId, setBlockDeletePendingId] = useState<number | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [isAddTimeBlockModalOpen, setIsAddTimeBlockModalOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const isPm = user?.role === 'pm';

  const canCreateBlocks = Boolean(user && (user.role === 'pm' || user.role === 'engineer'));

  const loadProject = useCallback(async () => {
    if (!id) {
      setError('Missing project id');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetch<ProjectDetailResponse>(`/projects/${id}`);
      setProject(response.project);
      setForm(toFormState(response.project));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load project');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const shareUrl = useMemo(() => {
    if (!project) {
      return '';
    }

    return `${window.location.origin}/schedule/${project.share_token}`;
  }, [project]);

  function canDeleteBlock(block: TimeBlockWithRelations): boolean {
    if (!user) {
      return false;
    }

    if (user.role === 'pm') {
      return true;
    }

    return block.is_personal && block.created_by === user.id;
  }

  async function handleCopyShareLink(): Promise<void> {
    if (!shareUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyMessage('Booking link copied.');
      showToast('Booking link copied.', 'success');
    } catch {
      setCopyMessage('Unable to copy link from this browser context.');
      showToast('Unable to copy booking link.', 'error');
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!project || !form) {
      return;
    }

    setSavePending(true);
    setError(null);

    const payload: UpdateProjectRequest = {
      name: form.name.trim(),
      description: form.description.trim(),
      session_length_minutes: form.sessionLengthMinutes,
      is_group_signup: form.isGroupSignup,
      max_group_size: form.isGroupSignup ? form.maxGroupSize : 1,
      is_active: form.isActive
    };

    if (form.signupPassword.trim().length > 0) {
      payload.signup_password = form.signupPassword.trim();
    }

    try {
      await apiFetch<ProjectResponse>(`/projects/${project.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      await loadProject();
      showToast('Project changes saved.', 'success');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to save project changes';
      setError(message);
      showToast(message, 'error');
    } finally {
      setSavePending(false);
    }
  }

  function handleDeleteRequest(): void {
    setConfirmAction({ type: 'delete-project' });
  }

  async function handleDeleteProject(): Promise<void> {
    if (!project) {
      return;
    }

    setDeletePending(true);
    setError(null);

    try {
      await apiFetch<unknown>(`/projects/${project.id}`, {
        method: 'DELETE'
      });

      showToast('Project deleted.', 'success');
      navigate('/dashboard');
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Unable to delete project';
      setError(message);
      showToast(message, 'error');
    } finally {
      setDeletePending(false);
      setConfirmAction(null);
    }
  }

  function handleDeleteTimeBlockRequest(timeBlockId: number): void {
    setConfirmAction({ type: 'delete-time-block', timeBlockId });
  }

  async function handleDeleteTimeBlock(timeBlockId: number): Promise<void> {
    setBlockDeletePendingId(timeBlockId);
    setError(null);

    try {
      await apiFetch<unknown>(`/time-blocks/${timeBlockId}`, {
        method: 'DELETE'
      });

      await loadProject();
      showToast('Time block deleted.', 'success');
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Unable to delete time block';
      setError(message);
      showToast(message, 'error');
    } finally {
      setBlockDeletePendingId(null);
      setConfirmAction(null);
    }
  }

  if (isLoading) {
    return (
      <section className="center-card">
        <h2>Loading project...</h2>
      </section>
    );
  }

  if (error && !project) {
    return (
      <section className="center-card">
        <h2>Project unavailable</h2>
        <p className="error">{error}</p>
      </section>
    );
  }

  if (!project || !form) {
    return (
      <section className="center-card">
        <h2>Project not found</h2>
      </section>
    );
  }

  return (
    <section className="project-detail">
      <div className="header-row">
        <div>
          <h2>{project.name}</h2>
          <p className="hint">Created by {project.creator_name}</p>
        </div>
      </div>

      <div className="detail-card">
        <h3>Booking Link</h3>
        <p className="mono-text">{shareUrl}</p>
        <button type="button" onClick={() => void handleCopyShareLink()}>
          Copy Link
        </button>
        {copyMessage ? <p className="hint">{copyMessage}</p> : null}
      </div>

      {isPm ? (
        <form className="detail-card" onSubmit={(event) => void handleSave(event)}>
          <h3>Project Settings</h3>

          <label>
            Name
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
              type="text"
              maxLength={255}
              required
            />
          </label>

          <label>
            Description
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm((prev) => (prev ? { ...prev, description: event.target.value } : prev))
              }
              maxLength={5000}
              rows={4}
            />
          </label>

          <label>
            Session Length (minutes)
            <input
              value={form.sessionLengthMinutes}
              onChange={(event) =>
                setForm((prev) =>
                  prev ? { ...prev, sessionLengthMinutes: Number(event.target.value) } : prev
                )
              }
              type="number"
              min={1}
              required
            />
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.isGroupSignup}
              onChange={(event) =>
                setForm((prev) =>
                  prev
                    ? {
                        ...prev,
                        isGroupSignup: event.target.checked,
                        maxGroupSize: event.target.checked ? prev.maxGroupSize : 1
                      }
                    : prev
                )
              }
            />
            Group Signup Enabled
          </label>

          <label>
            Max Group Size
            <input
              value={form.maxGroupSize}
              onChange={(event) =>
                setForm((prev) => (prev ? { ...prev, maxGroupSize: Number(event.target.value) } : prev))
              }
              type="number"
              min={1}
              disabled={!form.isGroupSignup}
              required
            />
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) =>
                setForm((prev) => (prev ? { ...prev, isActive: event.target.checked } : prev))
              }
            />
            Project Active
          </label>

          <label>
            Reset Client Password (optional)
            <input
              value={form.signupPassword}
              onChange={(event) =>
                setForm((prev) => (prev ? { ...prev, signupPassword: event.target.value } : prev))
              }
              type="password"
              minLength={4}
              placeholder="Leave blank to keep current password"
            />
          </label>

          {error ? <p className="error">{error}</p> : null}

          <div className="button-row">
            <button type="submit" disabled={savePending}>
              {savePending ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={handleDeleteRequest}
              disabled={deletePending}
            >
              {deletePending ? 'Deleting...' : 'Delete Project'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="detail-card">
        <div className="header-row">
          <h3>Time Blocks</h3>
          {canCreateBlocks ? (
            <button
              type="button"
              className="header-button"
              onClick={() => setIsAddTimeBlockModalOpen(true)}
            >
              {isPm ? 'Add Time Blocks' : 'Add Personal Block'}
            </button>
          ) : null}
        </div>

        {error ? <p className="error">{error}</p> : null}

        {project.time_blocks.length === 0 ? (
          <p className="hint">No time blocks added yet.</p>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Start</th>
                <th>End</th>
                <th>Engineers</th>
                <th>Remaining</th>
                <th>Bookings</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {project.time_blocks.map((block) => {
                const activeBookings = block.bookings.filter((booking) => booking.cancelled_at === null).length;

                return (
                  <tr key={block.id}>
                    <td>{new Date(block.start_time).toLocaleString()}</td>
                    <td>{new Date(block.end_time).toLocaleString()}</td>
                    <td>
                      {block.engineers.length > 0
                        ? block.engineers
                            .map((engineer) => `${engineer.first_name} ${engineer.last_name}`)
                            .join(', ')
                        : 'Unassigned'}
                    </td>
                    <td>
                      {block.remaining_slots} / {block.max_signups}
                    </td>
                    <td>
                      {activeBookings} active ({block.bookings.length} total)
                    </td>
                    <td>
                      {canDeleteBlock(block) ? (
                        <button
                          type="button"
                          className="secondary-button small-button"
                          onClick={() => handleDeleteTimeBlockRequest(block.id)}
                          disabled={blockDeletePendingId === block.id}
                        >
                          {blockDeletePendingId === block.id ? 'Deleting...' : 'Delete'}
                        </button>
                      ) : (
                        <span className="hint">No actions</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {isAddTimeBlockModalOpen && user ? (
        <AddTimeBlockModal
          project={project}
          userRole={user.role}
          onClose={() => setIsAddTimeBlockModalOpen(false)}
          onCreated={loadProject}
        />
      ) : null}

      {confirmAction?.type === 'delete-project' ? (
        <ConfirmDialog
          title="Delete Project"
          message="This deletes the project and all related time blocks and bookings."
          confirmLabel="Yes, Delete Project"
          tone="danger"
          pending={deletePending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={handleDeleteProject}
        />
      ) : null}

      {confirmAction?.type === 'delete-time-block' ? (
        <ConfirmDialog
          title="Delete Time Block"
          message="This removes the selected time block. Active bookings must be cancelled first."
          confirmLabel="Delete Time Block"
          tone="danger"
          pending={blockDeletePendingId === confirmAction.timeBlockId}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => handleDeleteTimeBlock(confirmAction.timeBlockId)}
        />
      ) : null}
    </section>
  );
}
