import { useState, type FormEvent } from 'react';

import type { CreateProjectRequest, ProjectResponse } from '@calendar-genie/shared';

import { apiFetch } from '../api/client.js';
import { useToast } from '../context/ToastContext.js';

interface CreateProjectModalProps {
  onClose: () => void;
  onCreated: () => Promise<void>;
}

export function CreateProjectModal({ onClose, onCreated }: CreateProjectModalProps): JSX.Element {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [bookingEmailDomainAllowlist, setBookingEmailDomainAllowlist] = useState('');
  const [sessionLengthMinutes, setSessionLengthMinutes] = useState(60);
  const [isGroupSignup, setIsGroupSignup] = useState(false);
  const [maxGroupSize, setMaxGroupSize] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    const payload: CreateProjectRequest = {
      name: name.trim(),
      description: description.trim(),
      signup_password: signupPassword,
      booking_email_domain_allowlist: bookingEmailDomainAllowlist.trim().toLowerCase(),
      is_group_signup: isGroupSignup,
      max_group_size: isGroupSignup ? maxGroupSize : 1,
      session_length_minutes: sessionLengthMinutes
    };

    try {
      await apiFetch<ProjectResponse>('/projects', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      await onCreated();
      showToast('Project created.', 'success');
      onClose();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Unable to create project';
      setError(message);
      showToast(message, 'error');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Create project">
      <div className="modal-card">
        <h3>Create Project</h3>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              type="text"
              maxLength={255}
              required
            />
          </label>

          <label>
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={5000}
              rows={4}
            />
          </label>

          <label>
            Client Password
            <input
              value={signupPassword}
              onChange={(event) => setSignupPassword(event.target.value)}
              type="password"
              minLength={4}
              required
            />
          </label>

          <label>
            Booking Email Domain Allowlist (optional)
            <input
              value={bookingEmailDomainAllowlist}
              onChange={(event) => setBookingEmailDomainAllowlist(event.target.value)}
              type="text"
              maxLength={255}
              placeholder="client.com"
            />
          </label>

          <label>
            Session Length
            <select
              value={sessionLengthMinutes}
              onChange={(event) => setSessionLengthMinutes(Number(event.target.value))}
            >
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>60 minutes</option>
              <option value={90}>90 minutes</option>
            </select>
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={isGroupSignup}
              onChange={(event) => {
                setIsGroupSignup(event.target.checked);
                if (!event.target.checked) {
                  setMaxGroupSize(1);
                }
              }}
            />
            Enable group signup
          </label>

          <label>
            Max Group Size
            <input
              value={maxGroupSize}
              onChange={(event) => setMaxGroupSize(Number(event.target.value))}
              type="number"
              min={1}
              disabled={!isGroupSignup}
              required
            />
          </label>

          {error ? <p className="error">{error}</p> : null}

          <div className="button-row">
            <button type="button" className="secondary-button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button type="submit" disabled={pending}>
              {pending ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
