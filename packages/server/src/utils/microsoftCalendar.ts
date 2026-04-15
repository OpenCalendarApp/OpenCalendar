import { createHmac, timingSafeEqual } from 'node:crypto';

interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number | string;
  scope?: string;
}

interface GraphErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export interface MicrosoftOAuthConfig {
  enabled: boolean;
  tenantId: string;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
  scopes: string[];
  stateTtlSeconds: number;
  stateSecret: string | null;
  successRedirectUrl: string | null;
  errorRedirectUrl: string | null;
}

export interface MicrosoftCalendarEventInput {
  projectName: string;
  projectDescription: string;
  clientFirstName: string;
  clientLastName: string;
  clientEmail: string;
  clientPhone: string;
  sessionStartIso: string;
  sessionEndIso: string;
}

export interface MicrosoftCalendarEventPayload {
  subject: string;
  body: {
    contentType: 'Text';
    content: string;
  };
  start: {
    dateTime: string;
    timeZone: 'UTC';
  };
  end: {
    dateTime: string;
    timeZone: 'UTC';
  };
  attendees: Array<{
    type: 'required';
    emailAddress: {
      address: string;
      name: string;
    };
  }>;
}

export interface MicrosoftTokenExchangeResult {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scope: string;
}

interface StatePayload {
  userId: number;
  iat: number;
  exp: number;
}

type EnvLike = Record<string, string | undefined>;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseScopes(value: string | undefined): string[] {
  const fallbackScopes = ['offline_access', 'User.Read', 'Calendars.ReadWrite'];
  const source = value?.trim();
  if (!source) {
    return fallbackScopes;
  }

  const scopes = source.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
  return scopes.length > 0 ? scopes : fallbackScopes;
}

function normalizeOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getStateSecret(env: EnvLike): string | null {
  const configuredSecret = normalizeOptional(env.MICROSOFT_OAUTH_STATE_SECRET);
  if (configuredSecret) {
    return configuredSecret;
  }

  return normalizeOptional(env.JWT_SECRET);
}

export function getMicrosoftOAuthConfig(env: EnvLike = process.env): MicrosoftOAuthConfig {
  return {
    enabled: parseBoolean(env.MICROSOFT_CALENDAR_SYNC_ENABLED, true),
    tenantId: normalizeOptional(env.MICROSOFT_TENANT_ID) ?? 'common',
    clientId: normalizeOptional(env.MICROSOFT_CLIENT_ID),
    clientSecret: normalizeOptional(env.MICROSOFT_CLIENT_SECRET),
    redirectUri: normalizeOptional(env.MICROSOFT_REDIRECT_URI),
    scopes: parseScopes(env.MICROSOFT_OAUTH_SCOPES),
    stateTtlSeconds: parsePositiveInt(env.MICROSOFT_OAUTH_STATE_TTL_SECONDS, 600),
    stateSecret: getStateSecret(env),
    successRedirectUrl: normalizeOptional(env.MICROSOFT_OAUTH_SUCCESS_REDIRECT_URL),
    errorRedirectUrl: normalizeOptional(env.MICROSOFT_OAUTH_ERROR_REDIRECT_URL)
  };
}

export function isMicrosoftOAuthConfigured(config: MicrosoftOAuthConfig): boolean {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri && config.stateSecret);
}

function buildTokenEndpoint(config: MicrosoftOAuthConfig): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
}

function buildAuthorizeEndpoint(config: MicrosoftOAuthConfig): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/authorize`;
}

function requireConfiguredOAuth(config: MicrosoftOAuthConfig): void {
  if (!isMicrosoftOAuthConfigured(config)) {
    throw new Error('Microsoft OAuth is not fully configured');
  }
}

function buildStateSignature(payloadEncoded: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadEncoded).digest('base64url');
}

export function createMicrosoftOAuthState(args: {
  userId: number;
  config?: MicrosoftOAuthConfig;
  nowMs?: number;
}): string {
  const config = args.config ?? getMicrosoftOAuthConfig();
  requireConfiguredOAuth(config);
  if (!config.stateSecret) {
    throw new Error('Missing Microsoft OAuth state secret');
  }

  const nowMs = args.nowMs ?? Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  const payload: StatePayload = {
    userId: args.userId,
    iat: nowSeconds,
    exp: nowSeconds + config.stateTtlSeconds
  };

  const payloadEncoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = buildStateSignature(payloadEncoded, config.stateSecret);
  return `${payloadEncoded}.${signature}`;
}

export function verifyMicrosoftOAuthState(args: {
  state: string;
  config?: MicrosoftOAuthConfig;
  nowMs?: number;
}): { ok: true; userId: number } | { ok: false; error: string } {
  const config = args.config ?? getMicrosoftOAuthConfig();
  if (!config.stateSecret) {
    return { ok: false, error: 'Missing Microsoft OAuth state secret' };
  }

  const [payloadEncoded, signature] = args.state.split('.');
  if (!payloadEncoded || !signature) {
    return { ok: false, error: 'Invalid state format' };
  }

  const expectedSignature = buildStateSignature(payloadEncoded, config.stateSecret);
  const providedSignature = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  if (
    providedSignature.length !== expectedSignatureBuffer.length
    || !timingSafeEqual(providedSignature, expectedSignatureBuffer)
  ) {
    return { ok: false, error: 'Invalid state signature' };
  }

  try {
    const payloadJson = Buffer.from(payloadEncoded, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as StatePayload;
    if (
      !Number.isInteger(payload.userId)
      || !Number.isInteger(payload.exp)
      || payload.userId <= 0
      || payload.exp <= 0
    ) {
      return { ok: false, error: 'Invalid state payload' };
    }

    const nowMs = args.nowMs ?? Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);
    if (payload.exp < nowSeconds) {
      return { ok: false, error: 'State has expired' };
    }

    return { ok: true, userId: payload.userId };
  } catch {
    return { ok: false, error: 'Invalid state payload' };
  }
}

export function buildMicrosoftAuthorizeUrl(args: {
  userId: number;
  config?: MicrosoftOAuthConfig;
  nowMs?: number;
}): string {
  const config = args.config ?? getMicrosoftOAuthConfig();
  requireConfiguredOAuth(config);

  const state = createMicrosoftOAuthState({
    userId: args.userId,
    config,
    nowMs: args.nowMs
  });

  const params = new URLSearchParams({
    client_id: config.clientId ?? '',
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: config.redirectUri ?? '',
    scope: config.scopes.join(' '),
    state
  });

  return `${buildAuthorizeEndpoint(config)}?${params.toString()}`;
}

function normalizeTokenResponse(
  payload: MicrosoftTokenResponse,
  fallbackRefreshToken: string | null
): MicrosoftTokenExchangeResult {
  const accessToken = payload.access_token?.trim();
  const refreshToken = payload.refresh_token?.trim() || fallbackRefreshToken;
  if (!accessToken || !refreshToken) {
    throw new Error('Microsoft token response did not include expected tokens');
  }

  const expiresInRaw = Number(payload.expires_in ?? 3600);
  const expiresInSeconds = Number.isFinite(expiresInRaw) && expiresInRaw > 0
    ? Math.floor(expiresInRaw)
    : 3600;
  const scope = payload.scope?.trim() ?? '';

  return {
    accessToken,
    refreshToken,
    expiresInSeconds,
    scope
  };
}

async function requestTokenWithForm(
  formData: URLSearchParams,
  config: MicrosoftOAuthConfig,
  fallbackRefreshToken: string | null
): Promise<MicrosoftTokenExchangeResult> {
  const response = await fetch(buildTokenEndpoint(config), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString()
  });

  const payload = (await response.json()) as MicrosoftTokenResponse | GraphErrorPayload;
  if (!response.ok) {
    const errorPayload = payload as GraphErrorPayload;
    const errorMessage = errorPayload.error?.message ?? `Microsoft token request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  return normalizeTokenResponse(payload as MicrosoftTokenResponse, fallbackRefreshToken);
}

export async function exchangeMicrosoftAuthorizationCode(args: {
  code: string;
  config?: MicrosoftOAuthConfig;
}): Promise<MicrosoftTokenExchangeResult> {
  const config = args.config ?? getMicrosoftOAuthConfig();
  requireConfiguredOAuth(config);

  const formData = new URLSearchParams({
    client_id: config.clientId ?? '',
    client_secret: config.clientSecret ?? '',
    code: args.code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri ?? ''
  });

  return requestTokenWithForm(formData, config, null);
}

export async function refreshMicrosoftAccessToken(args: {
  refreshToken: string;
  config?: MicrosoftOAuthConfig;
}): Promise<MicrosoftTokenExchangeResult> {
  const config = args.config ?? getMicrosoftOAuthConfig();
  requireConfiguredOAuth(config);

  const formData = new URLSearchParams({
    client_id: config.clientId ?? '',
    client_secret: config.clientSecret ?? '',
    refresh_token: args.refreshToken,
    grant_type: 'refresh_token',
    redirect_uri: config.redirectUri ?? '',
    scope: config.scopes.join(' ')
  });

  return requestTokenWithForm(formData, config, args.refreshToken);
}

export async function fetchMicrosoftProfile(accessToken: string): Promise<{
  id: string;
  email: string;
}> {
  const response = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  const payload = (await response.json()) as
    | { id?: string; mail?: string | null; userPrincipalName?: string | null }
    | GraphErrorPayload;
  if (!response.ok) {
    const errorPayload = payload as GraphErrorPayload;
    const errorMessage = errorPayload.error?.message ?? `Microsoft profile request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  const profile = payload as { id?: string; mail?: string | null; userPrincipalName?: string | null };
  const id = profile.id?.trim();
  const email = (profile.mail ?? profile.userPrincipalName ?? '').trim();
  if (!id || !email) {
    throw new Error('Microsoft profile response missing id or email');
  }

  return { id, email };
}

function toMicrosoftUtcDateTime(iso: string): { dateTime: string; timeZone: 'UTC' } {
  return {
    dateTime: new Date(iso).toISOString(),
    timeZone: 'UTC'
  };
}

export function buildMicrosoftCalendarEventPayload(
  input: MicrosoftCalendarEventInput
): MicrosoftCalendarEventPayload {
  const descriptionLines = [
    input.projectDescription,
    `Client: ${input.clientFirstName} ${input.clientLastName}`,
    `Email: ${input.clientEmail}`,
    `Phone: ${input.clientPhone}`
  ]
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    subject: `${input.projectName} Session`,
    body: {
      contentType: 'Text',
      content: descriptionLines.join('\n\n')
    },
    start: toMicrosoftUtcDateTime(input.sessionStartIso),
    end: toMicrosoftUtcDateTime(input.sessionEndIso),
    attendees: [
      {
        type: 'required',
        emailAddress: {
          address: input.clientEmail,
          name: `${input.clientFirstName} ${input.clientLastName}`.trim()
        }
      }
    ]
  };
}

export async function createMicrosoftCalendarEvent(args: {
  accessToken: string;
  event: MicrosoftCalendarEventPayload;
  transactionId: string;
}): Promise<{ id: string }> {
  const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${args.accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      ...args.event,
      transactionId: args.transactionId
    })
  });

  const payload = (await response.json()) as { id?: string } | GraphErrorPayload;
  if (!response.ok) {
    const errorPayload = payload as GraphErrorPayload;
    const errorMessage = errorPayload.error?.message ?? `Microsoft create event failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  const event = payload as { id?: string };
  if (!event.id) {
    throw new Error('Microsoft create event response missing id');
  }

  return { id: event.id };
}

export async function updateMicrosoftCalendarEvent(args: {
  accessToken: string;
  eventId: string;
  event: MicrosoftCalendarEventPayload;
}): Promise<void> {
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(args.eventId)}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${args.accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(args.event)
  });

  if (response.status === 404) {
    throw new Error('Microsoft calendar event not found');
  }

  if (!response.ok) {
    const payload = (await response.json()) as GraphErrorPayload;
    throw new Error(payload.error?.message ?? `Microsoft update event failed with status ${response.status}`);
  }
}

export async function deleteMicrosoftCalendarEvent(args: {
  accessToken: string;
  eventId: string;
}): Promise<void> {
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(args.eventId)}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${args.accessToken}`
    }
  });

  if (response.status === 404) {
    return;
  }

  if (!response.ok) {
    let errorMessage = `Microsoft delete event failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as GraphErrorPayload;
      errorMessage = payload.error?.message ?? errorMessage;
    } catch {
      // noop
    }
    throw new Error(errorMessage);
  }
}

export interface BusyInterval {
  start: string;
  end: string;
}

interface CalendarViewEvent {
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  showAs?: string;
}

interface CalendarViewResponse {
  value?: CalendarViewEvent[];
  '@odata.nextLink'?: string;
}

export async function fetchCalendarBusyIntervals(args: {
  accessToken: string;
  startDateTime: string;
  endDateTime: string;
}): Promise<BusyInterval[]> {
  const busy: BusyInterval[] = [];

  const startIso = new Date(args.startDateTime).toISOString();
  const endIso = new Date(args.endDateTime).toISOString();

  let url: string | null =
    `https://graph.microsoft.com/v1.0/me/calendarview` +
    `?startDateTime=${encodeURIComponent(startIso)}` +
    `&endDateTime=${encodeURIComponent(endIso)}` +
    `&$select=start,end,showAs` +
    `&$top=250` +
    `&$orderby=start/dateTime`;

  while (url) {
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${args.accessToken}`,
        prefer: 'outlook.timezone="UTC"'
      }
    });

    if (!response.ok) {
      const payload = (await response.json()) as GraphErrorPayload;
      const errorMessage =
        payload.error?.message ?? `Microsoft calendarview request failed with status ${response.status}`;
      throw new Error(errorMessage);
    }

    const data = (await response.json()) as CalendarViewResponse;

    for (const event of data.value ?? []) {
      if (event.showAs === 'free') {
        continue;
      }

      const eventStart = event.start?.dateTime;
      const eventEnd = event.end?.dateTime;
      if (eventStart && eventEnd) {
        busy.push({
          start: new Date(eventStart).toISOString(),
          end: new Date(eventEnd).toISOString()
        });
      }
    }

    url = data['@odata.nextLink'] ?? null;
  }

  return busy;
}
