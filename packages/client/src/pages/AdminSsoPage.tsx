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
  const [savedConfig, setSavedConfig] = useState<AdminOidcSsoConfig>(defaultConfig);
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
      setSavedConfig(response.config);
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
      setSavedConfig(response.config);
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

  function discard(): void {
    setConfig(savedConfig);
    setClientSecret('');
  }

  return (
    <section>
      <div className="header-row" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <h2>Admin SSO (OIDC)</h2>
          <span className={config.enabled ? 'tag tag-accent' : 'tag tag-neutral'}>
            {config.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <button type="button" className="header-button secondary-button" onClick={() => void loadConfig()} disabled={isLoading || isSaving}>
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="detail-card status-card">
          <p className="error">{error}</p>
        </div>
      ) : null}

      <form onSubmit={(event) => void saveConfig(event)}>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => setConfig((prev) => ({ ...prev, enabled: event.target.checked }))}
          />
          Enable OIDC SSO
        </label>

        <div className="ledger">
          <div className="ledger-section-label">Endpoints</div>
          <div className="ledger-section-body">
            <div className="field-rows field-rows--label-200">
              <div className="field-row">
                <label className="field-label" htmlFor="sso-issuer">Issuer URL (optional)</label>
                <input
                  id="sso-issuer"
                  type="url"
                  className="h-34"
                  style={{ maxWidth: '420px' }}
                  value={config.issuer_url}
                  onChange={(event) => setConfig((prev) => ({ ...prev, issuer_url: event.target.value }))}
                  placeholder="https://idp.example.com"
                />
              </div>

              <div className="field-row">
                <label className="field-label" htmlFor="sso-authorization-endpoint">Authorization Endpoint</label>
                <input
                  id="sso-authorization-endpoint"
                  type="url"
                  className="h-34"
                  style={{ maxWidth: '420px' }}
                  value={config.authorization_endpoint}
                  onChange={(event) => setConfig((prev) => ({ ...prev, authorization_endpoint: event.target.value }))}
                  placeholder="https://idp.example.com/oauth2/authorize"
                />
              </div>

              <div className="field-row">
                <label className="field-label" htmlFor="sso-token-endpoint">Token Endpoint</label>
                <input
                  id="sso-token-endpoint"
                  type="url"
                  className="h-34"
                  style={{ maxWidth: '420px' }}
                  value={config.token_endpoint}
                  onChange={(event) => setConfig((prev) => ({ ...prev, token_endpoint: event.target.value }))}
                  placeholder="https://idp.example.com/oauth2/token"
                />
              </div>

              <div className="field-row">
                <label className="field-label" htmlFor="sso-userinfo-endpoint">UserInfo Endpoint</label>
                <input
                  id="sso-userinfo-endpoint"
                  type="url"
                  className="h-34"
                  style={{ maxWidth: '420px' }}
                  value={config.userinfo_endpoint}
                  onChange={(event) => setConfig((prev) => ({ ...prev, userinfo_endpoint: event.target.value }))}
                  placeholder="https://idp.example.com/oauth2/userinfo"
                />
              </div>
            </div>
          </div>

          <div className="ledger-section-label">Client</div>
          <div className="ledger-section-body">
            <div className="field-rows field-rows--label-200">
              <div className="field-row">
                <label className="field-label" htmlFor="sso-client-id">Client ID</label>
                <input
                  id="sso-client-id"
                  className="h-34"
                  style={{ maxWidth: '260px' }}
                  value={config.client_id}
                  onChange={(event) => setConfig((prev) => ({ ...prev, client_id: event.target.value }))}
                />
              </div>

              <div className="field-row">
                <label className="field-label" htmlFor="sso-client-secret">Client Secret</label>
                <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    id="sso-client-secret"
                    type="password"
                    className="h-34"
                    style={{ maxWidth: '260px' }}
                    value={clientSecret}
                    onChange={(event) => setClientSecret(event.target.value)}
                    placeholder={config.client_secret_configured ? 'Leave blank to keep existing secret' : 'Enter client secret'}
                  />
                  <span className="hint">
                    {config.client_secret_configured ? 'A client secret is already configured.' : 'No client secret configured yet.'}
                  </span>
                </span>
              </div>

              <div className="field-row">
                <label className="field-label" htmlFor="sso-scopes">Scopes</label>
                <input
                  id="sso-scopes"
                  className="h-34"
                  style={{ maxWidth: '260px' }}
                  value={config.scopes}
                  onChange={(event) => setConfig((prev) => ({ ...prev, scopes: event.target.value }))}
                  placeholder="openid profile email"
                />
              </div>

              <div className="field-row">
                <label className="field-label">Default Role for New SSO Users</label>
                <div className="seg">
                  <label className={`seg-opt${config.default_role === 'pm' ? ' checked' : ''}`}>
                    <input
                      type="radio"
                      name="sso-default-role"
                      checked={config.default_role === 'pm'}
                      onChange={() => setConfig((prev) => ({ ...prev, default_role: 'pm' }))}
                    />
                    <span>PM</span>
                  </label>
                  <label className={`seg-opt${config.default_role === 'engineer' ? ' checked' : ''}`}>
                    <input
                      type="radio"
                      name="sso-default-role"
                      checked={config.default_role === 'engineer'}
                      onChange={() => setConfig((prev) => ({ ...prev, default_role: 'engineer' }))}
                    />
                    <span>Engineer</span>
                  </label>
                </div>
              </div>

              <div className="field-row">
                <label className="field-label">Auto-provision</label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={config.auto_provision}
                    onChange={(event) => setConfig((prev) => ({ ...prev, auto_provision: event.target.checked }))}
                  />
                  On first SSO login
                </label>
              </div>
            </div>
          </div>

          <div className="ledger-section-label">Claims</div>
          <div className="ledger-section-body">
            <div className="field-rows field-rows--label-200">
              <div className="field-row">
                <label className="field-label" htmlFor="sso-claim-email">Email Claim</label>
                <input
                  id="sso-claim-email"
                  className="h-34"
                  style={{ maxWidth: '180px' }}
                  value={config.claim_email}
                  onChange={(event) => setConfig((prev) => ({ ...prev, claim_email: event.target.value }))}
                />
              </div>

              <div className="field-row">
                <label className="field-label" htmlFor="sso-claim-first-name">First Name Claim</label>
                <input
                  id="sso-claim-first-name"
                  className="h-34"
                  style={{ maxWidth: '180px' }}
                  value={config.claim_first_name}
                  onChange={(event) => setConfig((prev) => ({ ...prev, claim_first_name: event.target.value }))}
                />
              </div>

              <div className="field-row">
                <label className="field-label" htmlFor="sso-claim-last-name">Last Name Claim</label>
                <input
                  id="sso-claim-last-name"
                  className="h-34"
                  style={{ maxWidth: '180px' }}
                  value={config.claim_last_name}
                  onChange={(event) => setConfig((prev) => ({ ...prev, claim_last_name: event.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="ledger-section-label ledger-section-label--last">Redirects</div>
          <div className="ledger-section-body ledger-section-body--last">
            <div className="field-rows field-rows--label-200">
              <div className="field-row">
                <label className="field-label" htmlFor="sso-success-redirect">Success Redirect URL (optional)</label>
                <input
                  id="sso-success-redirect"
                  type="url"
                  className="h-34"
                  style={{ maxWidth: '320px' }}
                  value={config.success_redirect_url}
                  onChange={(event) => setConfig((prev) => ({ ...prev, success_redirect_url: event.target.value }))}
                  placeholder="http://localhost:5173/login"
                />
              </div>

              <div className="field-row">
                <label className="field-label" htmlFor="sso-error-redirect">Error Redirect URL (optional)</label>
                <input
                  id="sso-error-redirect"
                  type="url"
                  className="h-34"
                  style={{ maxWidth: '320px' }}
                  value={config.error_redirect_url}
                  onChange={(event) => setConfig((prev) => ({ ...prev, error_redirect_url: event.target.value }))}
                  placeholder="http://localhost:5173/login"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="card-footer">
          <button type="button" className="secondary-button" onClick={discard} disabled={isSaving}>
            Discard
          </button>
          <button type="submit" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save OIDC SSO Config'}
          </button>
        </div>
      </form>
    </section>
  );
}
