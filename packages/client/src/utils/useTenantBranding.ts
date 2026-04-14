import { useEffect, useState } from 'react';

import type { TenantBranding, PublicTenantBrandingResponse } from '@opencalendar/shared';

import { apiPublicFetch } from '../api/client.js';

/**
 * Fetches tenant branding (logo_url, accent_color) for public pages.
 * Returns the branding data and CSS style object to apply as inline styles.
 */
export function useTenantBranding(tenantUid: string | undefined): {
  branding: TenantBranding | null;
  brandStyle: React.CSSProperties;
} {
  const [branding, setBranding] = useState<TenantBranding | null>(null);

  useEffect(() => {
    if (!tenantUid) return;

    let cancelled = false;

    apiPublicFetch<PublicTenantBrandingResponse>(`/branding/${tenantUid}`)
      .then((response) => {
        if (!cancelled) {
          setBranding(response.branding);
        }
      })
      .catch(() => {
        // Branding is non-critical — fail silently and use defaults
      });

    return () => {
      cancelled = true;
    };
  }, [tenantUid]);

  const brandStyle: React.CSSProperties = {};
  if (branding?.accent_color) {
    (brandStyle as Record<string, string>)['--color-brand-primary'] = branding.accent_color;
    // Derive a hover shade by darkening
    (brandStyle as Record<string, string>)['--color-brand-primary-hover'] = darkenHex(branding.accent_color, 0.15);
  }

  return { branding, brandStyle };
}

function darkenHex(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.round(((num >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((num >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((num & 0xff) * (1 - amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
