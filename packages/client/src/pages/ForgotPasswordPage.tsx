import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { apiPublicFetch } from '../api/client.js';
import { BrandLogo } from '../components/BrandLogo.js';

export function ForgotPasswordPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await apiPublicFetch<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      setSubmitted(true);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Request failed';
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
      <h2>Forgot Password</h2>

      {submitted ? (
        <div className="detail-card status-card">
          <p>Check your email for a password reset link. If you don&apos;t see it, check your spam folder.</p>
          <div className="button-row">
            <Link to="/login" className="button secondary-button">Back to Login</Link>
          </div>
        </div>
      ) : (
        <>
          <p className="hint">Enter your email address and we&apos;ll send you a link to reset your password.</p>
          <form onSubmit={(event) => void handleSubmit(event)}>
            <label>
              Email
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                required
                autoFocus
              />
            </label>
            {error ? <p className="error">{error}</p> : null}
            <button type="submit" disabled={pending}>
              {pending ? 'Sending...' : 'Send Reset Link'}
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
