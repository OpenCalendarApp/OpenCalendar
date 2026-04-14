import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import type { TenantBranding, TenantBrandingResponse } from '@opencalendar/shared';

import { apiFetch, buildApiUrl } from '../api/client.js';
import { getStoredToken } from '../auth/storage.js';
import { useToast } from '../context/ToastContext.js';

const DEFAULT_ACCENT = '#194677';

export function AdminBrandingPage(): JSX.Element {
  const { showToast } = useToast();
  const [branding, setBranding] = useState<TenantBranding>({ logo_url: null, accent_color: null });
  const [accentInput, setAccentInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBranding = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetch<TenantBrandingResponse>('/branding/admin/current');
      setBranding(response.branding);
      setAccentInput(response.branding.accent_color ?? '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load branding');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBranding();
  }, [loadBranding]);

  async function saveAccentColor(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const response = await apiFetch<TenantBrandingResponse>('/branding/admin/accent-color', {
        method: 'PUT',
        body: JSON.stringify({
          accent_color: accentInput.trim() || null
        })
      });
      setBranding(response.branding);
      setAccentInput(response.branding.accent_color ?? '');
      showToast('Accent color saved.', 'success');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to save accent color';
      setError(message);
      showToast(message, 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadLogo(): Promise<void> {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('logo', file);

      const response = await fetch(buildApiUrl('/branding/admin/logo'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getStoredToken() ?? ''}`
        },
        body: formData
      });

      if (!response.ok) {
        const err = await response.json() as { error?: string };
        throw new Error(err.error ?? `Upload failed (${response.status})`);
      }

      const data = (await response.json()) as TenantBrandingResponse;
      setBranding(data.branding);
      showToast('Logo uploaded.', 'success');

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Unable to upload logo';
      setError(message);
      showToast(message, 'error');
    } finally {
      setIsUploading(false);
    }
  }

  async function removeLogo(): Promise<void> {
    setIsUploading(true);
    setError(null);

    try {
      const response = await apiFetch<TenantBrandingResponse>('/branding/admin/logo', {
        method: 'DELETE'
      });
      setBranding(response.branding);
      showToast('Logo removed.', 'success');
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : 'Unable to remove logo';
      setError(message);
      showToast(message, 'error');
    } finally {
      setIsUploading(false);
    }
  }

  const previewAccent = accentInput.trim() || DEFAULT_ACCENT;

  return (
    <section>
      <div className="header-row">
        <h2>Branding</h2>
        <button
          type="button"
          className="header-button"
          onClick={() => void loadBranding()}
          disabled={isLoading || isSaving || isUploading}
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="detail-card status-card">
          <p className="error">{error}</p>
        </div>
      ) : null}

      {/* Logo Section */}
      <div className="detail-card" style={{ marginBottom: 'var(--space-4)' }}>
        <h3>Organization Logo</h3>
        <p className="hint">
          Displayed on public booking pages. Accepts PNG, JPG, or SVG (max 500 KB, resized to 400px width).
        </p>

        {branding.logo_url ? (
          <div style={{ margin: 'var(--space-3) 0' }}>
            <img
              src={buildApiUrl(branding.logo_url.replace(/^\/api/, ''))}
              alt="Current logo"
              style={{ maxWidth: '200px', maxHeight: '80px', objectFit: 'contain' }}
            />
          </div>
        ) : (
          <p className="hint" style={{ fontStyle: 'italic', margin: 'var(--space-3) 0' }}>
            No logo uploaded. The default Calendar Genie logo will be shown.
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            style={{ flex: '1 1 auto' }}
          />
          <button
            type="button"
            onClick={() => void uploadLogo()}
            disabled={isUploading}
          >
            {isUploading ? 'Uploading...' : 'Upload'}
          </button>
          {branding.logo_url ? (
            <button
              type="button"
              className="danger-button"
              onClick={() => void removeLogo()}
              disabled={isUploading}
            >
              Remove Logo
            </button>
          ) : null}
        </div>
      </div>

      {/* Accent Color Section */}
      <form className="detail-card" onSubmit={(event) => void saveAccentColor(event)}>
        <h3>Accent Color</h3>
        <p className="hint">
          Applied to buttons, links, and progress bars on public booking pages.
          Leave blank to use the default brand color.
        </p>

        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginTop: 'var(--space-2)' }}>
          <input
            type="color"
            value={previewAccent}
            onChange={(event) => setAccentInput(event.target.value)}
            style={{ width: '48px', height: '36px', padding: '2px', cursor: 'pointer' }}
          />
          <input
            type="text"
            value={accentInput}
            onChange={(event) => setAccentInput(event.target.value)}
            placeholder="#194677"
            maxLength={7}
            style={{ width: '100px', fontFamily: 'monospace' }}
          />
          <span className="hint" style={{ marginLeft: 'var(--space-2)' }}>
            Default: {DEFAULT_ACCENT}
          </span>
        </div>

        {/* Live Preview */}
        <div style={{ marginTop: 'var(--space-3)' }}>
          <p className="hint" style={{ marginBottom: 'var(--space-1)' }}>Preview:</p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <button
              type="button"
              style={{ background: previewAccent, color: '#fff', border: 'none' }}
            >
              Sample Button
            </button>
            <a href="#preview" onClick={(e) => e.preventDefault()} style={{ color: previewAccent }}>
              Sample Link
            </a>
            <div style={{
              width: '120px',
              height: '6px',
              borderRadius: '3px',
              background: `linear-gradient(90deg, ${previewAccent} 60%, #e4e8ee 60%)`
            }} />
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)' }}>
          <button type="submit" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Accent Color'}
          </button>
          {branding.accent_color ? (
            <button
              type="button"
              className="danger-button"
              onClick={() => {
                setAccentInput('');
                void saveAccentColor({ preventDefault: () => {} } as FormEvent<HTMLFormElement>);
              }}
              disabled={isSaving}
            >
              Reset to Default
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
