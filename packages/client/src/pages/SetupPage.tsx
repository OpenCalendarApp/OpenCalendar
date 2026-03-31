import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import type { SetupInitializeResponse, SetupStatusResponse } from '@calendar-genie/shared';

import { apiFetch } from '../api/client.js';
import { BrandLogo } from '../components/BrandLogo.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';

interface SetupFormState {
  tenant_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  password: string;
  confirm_password: string;
}

const defaultForm: SetupFormState = {
  tenant_name: 'Default Tenant',
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  password: '',
  confirm_password: ''
};

export function SetupPage(): JSX.Element {
  const navigate = useNavigate();
  const { completeSsoLogin, isAuthenticated } = useAuth();
  const { showToast } = useToast();

  const [form, setForm] = useState<SetupFormState>(defaultForm);
  const [isChecking, setIsChecking] = useState(true);
  const [requiresSetup, setRequiresSetup] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsChecking(true);
      setError(null);

      try {
        const status = await apiFetch<SetupStatusResponse>('/setup/status');
        if (cancelled) {
          return;
        }

        setRequiresSetup(status.requires_setup);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Unable to load setup status');
      } finally {
        if (!cancelled) {
          setIsChecking(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (form.password !== form.confirm_password) {
      setError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await apiFetch<SetupInitializeResponse>('/setup/initialize', {
        method: 'POST',
        body: JSON.stringify({
          tenant_name: form.tenant_name,
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          phone: form.phone.trim() ? form.phone.trim() : undefined,
          password: form.password
        })
      });

      await completeSsoLogin({
        token: response.token,
        refresh_token: response.refresh_token
      });
      showToast('Initial setup completed.', 'success');
      navigate('/dashboard', { replace: true });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Unable to complete setup';
      setError(message);
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="center-card">
      <div className="auth-brand">
        <BrandLogo variant="stacked" className="brand-logo auth-brand-logo" />
        <p className="hint">Set up your first Calendar Genie tenant and admin workspace.</p>
      </div>
      <h2>Initial Setup</h2>
      <p className="hint">
        Create the first admin account and tenant profile.
      </p>

      {isChecking ? <p>Checking setup status...</p> : null}
      {!isChecking && !requiresSetup ? (
        <p className="hint">
          Setup is already complete. <Link to="/login">Go to login</Link>.
        </p>
      ) : null}

      {requiresSetup ? (
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label>
            Tenant Name
            <input
              value={form.tenant_name}
              onChange={(event) => setForm((prev) => ({ ...prev, tenant_name: event.target.value }))}
              required
            />
          </label>

          <label>
            First Name
            <input
              value={form.first_name}
              onChange={(event) => setForm((prev) => ({ ...prev, first_name: event.target.value }))}
              required
            />
          </label>

          <label>
            Last Name
            <input
              value={form.last_name}
              onChange={(event) => setForm((prev) => ({ ...prev, last_name: event.target.value }))}
              required
            />
          </label>

          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              required
            />
          </label>

          <label>
            Phone (optional)
            <input
              type="tel"
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              minLength={8}
              required
            />
          </label>

          <label>
            Confirm Password
            <input
              type="password"
              value={form.confirm_password}
              onChange={(event) => setForm((prev) => ({ ...prev, confirm_password: event.target.value }))}
              minLength={8}
              required
            />
          </label>

          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Completing setup...' : 'Complete Setup'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
