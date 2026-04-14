import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, CheckCircle, Link2, MonitorSmartphone, Plus } from 'lucide-react';

import type {
  MicrosoftCalendarAuthUrlResponse,
  OnboardingStatusResponse
} from '@opencalendar/shared';

import { apiFetch } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';

interface OnboardingWizardProps {
  onComplete: () => void;
  onCreateProject: () => void;
  onAddTimeBlock: () => void;
  shareLink: string | null;
}

interface StepState {
  calendar_connected: boolean;
  has_project: boolean;
  has_time_block: boolean;
  has_copied_link: boolean;
}

export function OnboardingWizard({
  onComplete,
  onCreateProject,
  onAddTimeBlock,
  shareLink
}: OnboardingWizardProps): JSX.Element {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [steps, setSteps] = useState<StepState>({
    calendar_connected: false,
    has_project: false,
    has_time_block: false,
    has_copied_link: false
  });
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [calendarPending, setCalendarPending] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await apiFetch<OnboardingStatusResponse>('/auth/onboarding/status');
      if (response.completed) {
        onComplete();
        return;
      }
      setSteps(response.steps);
    } catch {
      // Silently fail — wizard is non-blocking
    } finally {
      setLoading(false);
    }
  }, [onComplete]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const allStepsComplete = steps.calendar_connected && steps.has_project && steps.has_time_block && steps.has_copied_link;

  useEffect(() => {
    if (!allStepsComplete) {
      return;
    }

    void (async () => {
      try {
        await apiFetch<{ message: string }>('/auth/onboarding/complete', { method: 'POST' });
        showToast('Onboarding complete! You\'re all set.', 'success');
        onComplete();
      } catch {
        // Non-blocking
      }
    })();
  }, [allStepsComplete, onComplete, showToast]);

  if (loading || dismissed) {
    return <></>;
  }

  async function handleConnectCalendar(): Promise<void> {
    setCalendarPending(true);
    try {
      const response = await apiFetch<MicrosoftCalendarAuthUrlResponse>('/auth/microsoft/connect');
      window.location.assign(response.authorization_url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to start Microsoft OAuth flow';
      showToast(message, 'error');
      setCalendarPending(false);
    }
  }

  function handleCopyLink(): void {
    if (!shareLink) {
      return;
    }

    const fullUrl = `${window.location.origin}/schedule/${shareLink}`;
    void navigator.clipboard.writeText(fullUrl).then(() => {
      setSteps((prev) => ({ ...prev, has_copied_link: true }));
      showToast('Booking link copied to clipboard.', 'success');
    });
  }

  function handleDismiss(): void {
    setDismissed(true);
  }

  function currentStep(): number {
    if (!steps.calendar_connected) return 1;
    if (!steps.has_project) return 2;
    if (!steps.has_time_block) return 3;
    return 4;
  }

  const active = currentStep();
  const completedCount = [steps.calendar_connected, steps.has_project, steps.has_time_block, steps.has_copied_link].filter(Boolean).length;

  return (
    <div className="detail-card status-card onboarding-wizard">
      <div className="onboarding-header">
        <h3>Getting Started</h3>
        <span className="hint">{completedCount}/4 steps complete</span>
        <button type="button" className="secondary-button onboarding-dismiss" onClick={handleDismiss}>
          Skip for now
        </button>
      </div>

      <div className="onboarding-progress">
        <div className="onboarding-progress-bar" style={{ width: `${(completedCount / 4) * 100}%` }} />
      </div>

      <ol className="onboarding-steps">
        <li className={steps.calendar_connected ? 'step-done' : active === 1 ? 'step-active' : ''}>
          <span className="step-indicator">{steps.calendar_connected ? <CheckCircle size={16} /> : <MonitorSmartphone size={16} />}</span>
          <div className="step-content">
            <strong>Connect Calendar</strong>
            <p className="hint">Link your Microsoft Calendar to auto-sync bookings.</p>
            {!steps.calendar_connected && active === 1 ? (
              <button
                type="button"
                onClick={() => void handleConnectCalendar()}
                disabled={calendarPending}
              >
                {calendarPending ? 'Redirecting...' : 'Connect Microsoft Calendar'}
              </button>
            ) : null}
          </div>
        </li>

        <li className={steps.has_project ? 'step-done' : active === 2 ? 'step-active' : ''}>
          <span className="step-indicator">{steps.has_project ? <CheckCircle size={16} /> : <Plus size={16} />}</span>
          <div className="step-content">
            <strong>Create First Project</strong>
            <p className="hint">Set up a project to organize your booking sessions.</p>
            {!steps.has_project && active === 2 && (user?.role === 'pm' || user?.role === 'admin') ? (
              <button type="button" onClick={onCreateProject}>
                Create Project
              </button>
            ) : null}
          </div>
        </li>

        <li className={steps.has_time_block ? 'step-done' : active === 3 ? 'step-active' : ''}>
          <span className="step-indicator">{steps.has_time_block ? <CheckCircle size={16} /> : <CalendarPlus size={16} />}</span>
          <div className="step-content">
            <strong>Set Availability</strong>
            <p className="hint">Add time blocks so clients can book sessions.</p>
            {!steps.has_time_block && active === 3 ? (
              <button type="button" onClick={onAddTimeBlock}>
                Add Time Blocks
              </button>
            ) : null}
          </div>
        </li>

        <li className={steps.has_copied_link ? 'step-done' : active === 4 ? 'step-active' : ''}>
          <span className="step-indicator">{steps.has_copied_link ? <CheckCircle size={16} /> : <Link2 size={16} />}</span>
          <div className="step-content">
            <strong>Share Booking Link</strong>
            <p className="hint">Copy your booking link and share it with clients.</p>
            {!steps.has_copied_link && active === 4 ? (
              <button type="button" onClick={handleCopyLink} disabled={!shareLink}>
                {shareLink ? 'Copy Booking Link' : 'Create a project first'}
              </button>
            ) : null}
          </div>
        </li>
      </ol>
    </div>
  );
}
