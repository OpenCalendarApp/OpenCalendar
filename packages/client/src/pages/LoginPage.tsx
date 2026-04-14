import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import type { OidcSsoAuthUrlResponse, SetupStatusResponse } from '@opencalendar/shared';

import { apiFetch } from '../api/client.js';
import { BrandLogo } from '../components/BrandLogo.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { completeSsoLogin, login } = useAuth();
  const { showToast } = useToast();
  const [email, setEmail] = useState('pm@example.com');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ssoPending, setSsoPending] = useState(false);
  const [setupCheckPending, setSetupCheckPending] = useState(true);
  const [requiresSetup, setRequiresSetup] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ssoStatus = params.get('sso');
    if (!ssoStatus) {
      return;
    }

    if (ssoStatus === 'error') {
      const reason = (params.get('reason') ?? 'sso_failed').replaceAll('_', ' ');
      setError(`SSO login failed: ${reason}`);
      showToast(`SSO login failed: ${reason}`, 'error');
      return;
    }

    if (ssoStatus !== 'success') {
      return;
    }

    const token = params.get('token') ?? '';
    const refreshToken = params.get('refresh_token') ?? '';
    if (!token || !refreshToken) {
      setError('SSO callback is missing session tokens');
      showToast('SSO callback is missing session tokens.', 'error');
      return;
    }

    let cancelled = false;

    void (async () => {
      setSsoPending(true);
      setError(null);

      try {
        await completeSsoLogin({
          token,
          refresh_token: refreshToken
        });
        if (cancelled) {
          return;
        }

        showToast('Signed in with SSO.', 'success');
        navigate('/dashboard', { replace: true });
      } catch (submitError) {
        if (cancelled) {
          return;
        }

        const message = submitError instanceof Error ? submitError.message : 'SSO login failed';
        setError(message);
        showToast(message, 'error');
      } finally {
        if (!cancelled) {
          setSsoPending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [completeSsoLogin, location.search, navigate, showToast]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const status = await apiFetch<SetupStatusResponse>('/setup/status');
        if (cancelled) {
          return;
        }

        setRequiresSetup(status.requires_setup);
      } catch {
        if (cancelled) {
          return;
        }
      } finally {
        if (!cancelled) {
          setSetupCheckPending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (requiresSetup) {
      setError('Initial setup is required before login.');
      return;
    }

    setPending(true);
    setError(null);

    try {
      await login({ email, password });
      showToast('Signed in successfully.', 'success');
      navigate('/dashboard');
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Login failed';
      setError(message);
      showToast(message, 'error');
    } finally {
      setPending(false);
    }
  }

  async function startSsoLogin(): Promise<void> {
    if (requiresSetup) {
      setError('Initial setup is required before SSO login.');
      return;
    }

    setSsoPending(true);
    setError(null);

    try {
      const response = await apiFetch<OidcSsoAuthUrlResponse>('/auth/sso/oidc/start');
      window.location.assign(response.authorization_url);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Unable to start SSO login';
      setError(message);
      showToast(message, 'error');
      setSsoPending(false);
    }
  }

  return (
    <div className="center-card">
      <div className="auth-brand">
        <BrandLogo variant="stacked" className="brand-logo auth-brand-logo" />
        <p className="hint">Calendar Genie keeps teams, calendars, and client bookings aligned.</p>
      </div>
      <p className="hint">Project-aware scheduling that replaces per-seat calendar tools. Manage availability, bookings, and client communication in one place.</p>
      <h2>Login</h2>
      {!setupCheckPending && requiresSetup ? (
        <div className="detail-card status-card">
          <p className="hint">This environment has not been initialized yet.</p>
          <div className="button-row">
            <button type="button" onClick={() => navigate('/setup')}>
              Start Initial Setup
            </button>
          </div>
        </div>
      ) : null}
      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => void startSsoLogin()}
          disabled={ssoPending || requiresSetup || setupCheckPending}
        >
          {ssoPending ? 'Starting SSO...' : 'Sign in with SSO'}
        </button>
      </div>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={pending || ssoPending || requiresSetup || setupCheckPending}>
          {pending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      <p className="hint">
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
      <p className="hint">Seed credentials: admin@example.com or pm@example.com / password123</p>
    </div>
  );
}
