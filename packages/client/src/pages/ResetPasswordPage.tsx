import { useState, type FormEvent } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';

import { apiPublicFetch } from '../api/client.js';
import { BrandLogo } from '../components/BrandLogo.js';
import { useToast } from '../context/ToastContext.js';

export function ResetPasswordPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setPending(true);
    setError(null);

    try {
      await apiPublicFetch<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password })
      });
      setSuccess(true);
      showToast('Password has been reset successfully.', 'success');
      setTimeout(() => navigate('/login', { replace: true }), 3000);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Reset failed';
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="center-card">
      <div className="auth-brand">
        <BrandLogo variant="stacked" className="brand-logo auth-brand-logo" />
      </div>
      <h2>Reset Password</h2>

      {success ? (
        <div className="detail-card status-card">
          <p>Your password has been reset. Redirecting to login...</p>
          <div className="button-row">
            <Link to="/login" className="button secondary-button">Go to Login</Link>
          </div>
        </div>
      ) : (
        <>
          <p className="hint">Enter your new password below.</p>
          <form onSubmit={(event) => void handleSubmit(event)}>
            <label>
              New Password
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                required
                minLength={8}
                autoFocus
              />
            </label>
            <label>
              Confirm Password
              <input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type="password"
                required
                minLength={8}
              />
            </label>
            {error ? <p className="error">{error}</p> : null}
            <button type="submit" disabled={pending}>
              {pending ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
          <p className="hint">
            <Link to="/login">Back to Login</Link>
          </p>
        </>
      )}
    </div>
  );
}
