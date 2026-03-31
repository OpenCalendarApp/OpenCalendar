import { createHmac, timingSafeEqual } from 'node:crypto';

export interface OidcTenantConfig {
  tenantId: number;
  tenantUid: string;
  enabled: boolean;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  claimEmail: string;
  claimFirstName: string;
  claimLastName: string;
  defaultRole: 'pm' | 'engineer';
  autoProvision: boolean;
  successRedirectUrl: string | null;
  errorRedirectUrl: string | null;
}

interface OidcTokenResponse {
  access_token?: string;
}

interface OidcStatePayload {
  tenantId: number;
  iat: number;
  exp: number;
}

function buildStateSignature(payloadEncoded: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadEncoded).digest('base64url');
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function requireStateSecret(stateSecret: string | null): string {
  if (!stateSecret) {
    throw new Error('Missing OIDC SSO state secret');
  }

  return stateSecret;
}

export function getOidcSsoStateSecret(env: Record<string, string | undefined> = process.env): string | null {
  return normalizeOptional(env.SSO_OIDC_STATE_SECRET) ?? normalizeOptional(env.JWT_SECRET);
}

export function getOidcSsoRedirectUri(env: Record<string, string | undefined> = process.env): string | null {
  return normalizeOptional(env.SSO_OIDC_REDIRECT_URI);
}

export function createOidcSsoState(args: {
  tenantId: number;
  stateSecret?: string | null;
  ttlSeconds?: number;
  nowMs?: number;
}): string {
  const stateSecret = requireStateSecret(args.stateSecret ?? getOidcSsoStateSecret());
  const ttlSeconds = Math.max(60, Math.floor(args.ttlSeconds ?? 600));
  const nowSeconds = Math.floor((args.nowMs ?? Date.now()) / 1000);

  const payload: OidcStatePayload = {
    tenantId: args.tenantId,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds
  };

  const payloadEncoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = buildStateSignature(payloadEncoded, stateSecret);
  return `${payloadEncoded}.${signature}`;
}

export function verifyOidcSsoState(args: {
  state: string;
  stateSecret?: string | null;
  nowMs?: number;
}): { ok: true; tenantId: number } | { ok: false; error: string } {
  const stateSecret = args.stateSecret ?? getOidcSsoStateSecret();
  if (!stateSecret) {
    return { ok: false, error: 'Missing OIDC SSO state secret' };
  }

  const [payloadEncoded, signature] = args.state.split('.');
  if (!payloadEncoded || !signature) {
    return { ok: false, error: 'Invalid state format' };
  }

  const expectedSignature = buildStateSignature(payloadEncoded, stateSecret);
  const providedSignatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  if (
    providedSignatureBuffer.length !== expectedSignatureBuffer.length
    || !timingSafeEqual(providedSignatureBuffer, expectedSignatureBuffer)
  ) {
    return { ok: false, error: 'Invalid state signature' };
  }

  try {
    const payloadJson = Buffer.from(payloadEncoded, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as OidcStatePayload;
    if (!Number.isInteger(payload.tenantId) || payload.tenantId <= 0 || !Number.isInteger(payload.exp)) {
      return { ok: false, error: 'Invalid state payload' };
    }

    const nowSeconds = Math.floor((args.nowMs ?? Date.now()) / 1000);
    if (payload.exp < nowSeconds) {
      return { ok: false, error: 'State has expired' };
    }

    return { ok: true, tenantId: payload.tenantId };
  } catch {
    return { ok: false, error: 'Invalid state payload' };
  }
}

export function isOidcTenantConfigUsable(config: OidcTenantConfig | null): config is OidcTenantConfig {
  if (!config || !config.enabled) {
    return false;
  }

  return Boolean(
    normalizeOptional(config.authorizationEndpoint)
    && normalizeOptional(config.tokenEndpoint)
    && normalizeOptional(config.userinfoEndpoint)
    && normalizeOptional(config.clientId)
    && normalizeOptional(config.clientSecret)
  );
}

export function buildOidcAuthorizeUrl(args: {
  config: OidcTenantConfig;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.config.clientId,
    response_type: 'code',
    redirect_uri: args.redirectUri,
    scope: args.config.scopes,
    state: args.state
  });

  return `${args.config.authorizationEndpoint}?${params.toString()}`;
}

export async function exchangeOidcAuthorizationCode(args: {
  config: OidcTenantConfig;
  code: string;
  redirectUri: string;
}): Promise<{ accessToken: string }> {
  const formData = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.config.clientId,
    client_secret: args.config.clientSecret
  });

  const response = await fetch(args.config.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString()
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`OIDC token exchange failed (${response.status}): ${bodyText}`);
  }

  const payload = await response.json() as OidcTokenResponse;
  const accessToken = payload.access_token?.trim();
  if (!accessToken) {
    throw new Error('OIDC token response missing access_token');
  }

  return { accessToken };
}

export async function fetchOidcUserInfo(args: {
  config: OidcTenantConfig;
  accessToken: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch(args.config.userinfoEndpoint, {
    headers: {
      authorization: `Bearer ${args.accessToken}`
    }
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`OIDC userinfo fetch failed (${response.status}): ${bodyText}`);
  }

  return await response.json() as Record<string, unknown>;
}

function getNestedClaim(payload: Record<string, unknown>, claimPath: string): string | null {
  const segments = claimPath.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  let current: unknown = payload;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  if (typeof current !== 'string') {
    return null;
  }

  const normalized = current.trim();
  return normalized.length > 0 ? normalized : null;
}

export function resolveOidcProfile(args: {
  userInfo: Record<string, unknown>;
  config: OidcTenantConfig;
}): { email: string; firstName: string; lastName: string } | null {
  const email = getNestedClaim(args.userInfo, args.config.claimEmail)
    ?? getNestedClaim(args.userInfo, 'email')
    ?? getNestedClaim(args.userInfo, 'preferred_username')
    ?? getNestedClaim(args.userInfo, 'upn');
  if (!email) {
    return null;
  }

  const firstName = getNestedClaim(args.userInfo, args.config.claimFirstName)
    ?? getNestedClaim(args.userInfo, 'given_name')
    ?? 'SSO';
  const lastName = getNestedClaim(args.userInfo, args.config.claimLastName)
    ?? getNestedClaim(args.userInfo, 'family_name')
    ?? 'User';

  return {
    email: email.toLowerCase(),
    firstName,
    lastName
  };
}
