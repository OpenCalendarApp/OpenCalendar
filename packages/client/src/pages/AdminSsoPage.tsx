import { useCallback, useEffect, useState, type FormEvent } from 'react';

import type {
  AdminOidcSsoConfig,
  AdminOidcSsoConfigResponse,
  UpdateAdminOidcSsoConfigRequest
} from '@opencalendar/shared';

import { apiFetch } from '../api/client.js';
import { useToast } from '../context/ToastContext.js';

const defaultConfig: AdminOidcSsoConfig = {
  enabled: false,
  issuer_url: '',
  authorization_endpoint: '',
  token_endpoint: '',
  userinfo_endpoint: '',
  client_id: '',
  client_secret_configured: false,
  scopes: 'openid profile email',
  default_role: 'pm',
  auto_provision: true,
  claim_email: 'email',
  claim_first_name: 'given_name',
  claim_last_name: 'family_name',
  success_redirect_url: '',
  error_redirect_url: ''
};

export function AdminSsoPage(): JSX.Element {
  const { showToast } = useToast();
  const [config, setConfig] = useState<AdminOidcSsoConfig>(defaultConfig);
  const [clientSecret, setClientSecret] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetch<AdminOidcSsoConfigResponse>('/admin/sso/oidc');
      setConfig(response.config);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load OIDC SSO config');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  async function saveConfig(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    const payload: UpdateAdminOidcSsoConfigRequest = {
      enabled: config.enabled,
      issuer_url: config.issuer_url.trim(),
      authorization_endpoint: config.authorization_endpoint.trim(),
      token_endpoint: config.token_endpoint.trim(),
      userinfo_endpoint: config.userinfo_endpoint.trim(),
      client_id: config.client_id.trim(),
      client_secret: clientSecret.trim(),
      scopes: config.scopes.trim(),
      default_role: config.default_role,
      auto_provision: config.auto_provision,
      claim_email: config.claim_email.trim(),
      claim_first_name: config.claim_first_name.trim(),
      claim_last_name: config.claim_last_name.trim(),
      success_redirect_url: config.success_redirect_url.trim(),
      error_redirect_url: config.error_redirect_url.trim()
    };

    try {
      const response = await apiFetch<AdminOidcSsoConfigResponse>('/admin/sso/oidc', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      setConfig(response.config);
      setClientSecret('');
      showToast('OIDC SSO configuration saved.', 'success');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to save OIDC SSO config';
      setError(message);
      showToast(message, 'error');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section>
      <div className="header-row">
        <h2>Admin SSO (OIDC)</h2>
        <button type="button" className="header-button" onClick={() => void loadConfig()} disabled={isLoading || isSaving}>
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="detail-card status-card">
          <p className="error">{error}</p>
        </div>
      ) : null}

      <form className="detail-card" onSubmit={(event) => void saveConfig(event)}>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => setConfig((prev) => ({ ...prev, enabled: event.target.checked }))}
          />
          Enable OIDC SSO
        </label>

        <label>
          Issuer URL (optional)
          <input
            type="url"
            value={config.issuer_url}
            onChange={(event) => setConfig((prev) => ({ ...prev, issuer_url: event.target.value }))}
            placeholder="https://idp.example.com"
          />
        </label>

        <label>
          Authorization Endpoint
          <input
            type="url"
            value={config.authorization_endpoint}
            onChange={(event) => setConfig((prev) => ({ ...prev, authorization_endpoint: event.target.value }))}
            placeholder="https://idp.example.com/oauth2/authorize"
          />
        </label>

        <label>
          Token Endpoint
          <input
            type="url"
            value={config.token_endpoint}
            onChange={(event) => setConfig((prev) => ({ ...prev, token_endpoint: event.target.value }))}
            placeholder="https://idp.example.com/oauth2/token"
          />
        </label>

        <label>
          UserInfo Endpoint
          <input
            type="url"
            value={config.userinfo_endpoint}
            onChange={(event) => setConfig((prev) => ({ ...prev, userinfo_endpoint: event.target.value }))}
            placeholder="https://idp.example.com/oauth2/userinfo"
          />
        </label>

        <label>
          Client ID
          <input
            value={config.client_id}
            onChange={(event) => setConfig((prev) => ({ ...prev, client_id: event.target.value }))}
          />
        </label>

        <label>
          Client Secret
          <input
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder={config.client_secret_configured ? 'Leave blank to keep existing secret' : 'Enter client secret'}
          />
        </label>
        <p className="hint">
          {config.client_secret_configured ? 'A client secret is already configured.' : 'No client secret configured yet.'}
        </p>

        <label>
          Scopes
          <input
            value={config.scopes}
            onChange={(event) => setConfig((prev) => ({ ...prev, scopes: event.target.value }))}
            placeholder="openid profile email"
          />
        </label>

        <label>
          Default Role for New SSO Users
          <select
            value={config.default_role}
            onChange={(event) =>
              setConfig((prev) => ({ ...prev, default_role: event.target.value as 'pm' | 'engineer' }))
            }
          >
            <option value="pm">PM</option>
            <option value="engineer">Engineer</option>
          </select>
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={config.auto_provision}
            onChange={(event) => setConfig((prev) => ({ ...prev, auto_provision: event.target.checked }))}
          />
          Auto-provision users on first SSO login
        </label>

        <label>
          Email Claim
          <input
            value={config.claim_email}
            onChange={(event) => setConfig((prev) => ({ ...prev, claim_email: event.target.value }))}
          />
        </label>

        <label>
          First Name Claim
          <input
            value={config.claim_first_name}
            onChange={(event) => setConfig((prev) => ({ ...prev, claim_first_name: event.target.value }))}
          />
        </label>

        <label>
          Last Name Claim
          <input
            value={config.claim_last_name}
            onChange={(event) => setConfig((prev) => ({ ...prev, claim_last_name: event.target.value }))}
          />
        </label>

        <label>
          Success Redirect URL (optional)
          <input
            type="url"
            value={config.success_redirect_url}
            onChange={(event) => setConfig((prev) => ({ ...prev, success_redirect_url: event.target.value }))}
            placeholder="http://localhost:5173/login"
          />
        </label>

        <label>
          Error Redirect URL (optional)
          <input
            type="url"
            value={config.error_redirect_url}
            onChange={(event) => setConfig((prev) => ({ ...prev, error_redirect_url: event.target.value }))}
            placeholder="http://localhost:5173/login"
          />
        </label>

        <div className="button-row">
          <button type="submit" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save OIDC SSO Config'}
          </button>
        </div>
      </form>
    </section>
  );
}
