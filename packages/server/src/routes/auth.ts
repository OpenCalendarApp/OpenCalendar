import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { Router, type Response } from 'express';

import {
  loginSchema,
  oidcSsoStartQuerySchema,
  logoutSchema,
  refreshTokenSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  type AuthResponse,
  type EngineersResponse,
  type ForgotPasswordRequest,
  type LoginRequest,
  type LogoutRequest,
  type MeResponse,
  type MicrosoftCalendarAuthUrlResponse,
  type MicrosoftCalendarStatusResponse,
  type OidcSsoAuthUrlResponse,
  type RefreshTokenRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
  type User,
  type UserRecord
} from '@opencalendar/shared';

import { authMiddleware, requireRole, signToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { publicWriteRateLimiter } from '../middleware/rateLimit.js';
import { pool } from '../db/pool.js';
import {
  buildMicrosoftAuthorizeUrl,
  exchangeMicrosoftAuthorizationCode,
  fetchMicrosoftProfile,
  getMicrosoftOAuthConfig,
  isMicrosoftOAuthConfigured,
  verifyMicrosoftOAuthState
} from '../utils/microsoftCalendar.js';
import {
  buildOidcAuthorizeUrl,
  createOidcSsoState,
  exchangeOidcAuthorizationCode,
  fetchOidcUserInfo,
  getOidcSsoRedirectUri,
  getOidcSsoStateSecret,
  isOidcTenantConfigUsable,
  resolveOidcProfile,
  type OidcTenantConfig,
  verifyOidcSsoState
} from '../utils/oidcSso.js';
import { hashUserPassword, verifyPassword } from '../utils/auth.js';
import { enqueuePasswordResetEmailJob } from '../jobs/emailNotifications.js';
import {
  buildRefreshTokenExpiresAt,
  generateRefreshToken,
  hashRefreshToken
} from '../utils/refreshTokens.js';

const router = Router();

type MicrosoftConnectionStatusRow = {
  microsoft_user_email: string;
  access_token_expires_at: string;
};

type UserRoleLookupRow = {
  tenant_id: number;
  tenant_uid: string;
  role: User['role'];
};

type TenantRow = {
  id: number;
  tenant_uid: string;
};

type OidcSsoConfigRow = {
  tenant_id: number;
  tenant_uid: string;
  enabled: boolean;
  authorization_endpoint: string | null;
  token_endpoint: string | null;
  userinfo_endpoint: string | null;
  client_id: string | null;
  client_secret: string | null;
  scopes: string;
  claim_email: string;
  claim_first_name: string;
  claim_last_name: string;
  default_role: 'pm' | 'engineer';
  auto_provision: boolean;
  success_redirect_url: string | null;
  error_redirect_url: string | null;
};

type AuthUserRow = UserRecord;

type RefreshTokenSessionRow = UserRecord & {
  refresh_token_id: number;
  token_tenant_id: number;
  token_user_id: number;
  expires_at: string;
  revoked_at: string | null;
  is_active: boolean;
};

type LoginUserRow = UserRecord & {
  is_active: boolean;
};

const defaultTenantUid = process.env.DEFAULT_TENANT_UID ?? '00000000-0000-0000-0000-000000000001';

async function ensureDefaultTenant(): Promise<TenantRow> {
  const result = await pool.query<TenantRow>(
    `
    INSERT INTO tenants (tenant_uid, name)
    VALUES ($1, $2)
    ON CONFLICT (tenant_uid) DO UPDATE
    SET name = EXCLUDED.name
    RETURNING id, tenant_uid
    `,
    [defaultTenantUid, 'Default Tenant']
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Unable to ensure default tenant');
  }

  return row;
}

function getDefaultDashboardUrl(): string {
  const origin = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').trim().replace(/\/$/, '');
  return `${origin}/dashboard`;
}

function buildRedirectUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function redirectMicrosoftOAuthError(res: Response, reason: string): void {
  const config = getMicrosoftOAuthConfig();
  const redirectUrl = config.errorRedirectUrl ?? getDefaultDashboardUrl();
  res.redirect(buildRedirectUrl(redirectUrl, { microsoft: 'error', reason }));
}

function redirectMicrosoftOAuthSuccess(res: Response): void {
  const config = getMicrosoftOAuthConfig();
  const redirectUrl = config.successRedirectUrl ?? getDefaultDashboardUrl();
  res.redirect(buildRedirectUrl(redirectUrl, { microsoft: 'connected' }));
}

function getDefaultLoginUrl(): string {
  const origin = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').trim().replace(/\/$/, '');
  return `${origin}/login`;
}

function toOidcTenantConfig(row: OidcSsoConfigRow): OidcTenantConfig {
  return {
    tenantId: row.tenant_id,
    tenantUid: row.tenant_uid,
    enabled: row.enabled,
    authorizationEndpoint: row.authorization_endpoint?.trim() ?? '',
    tokenEndpoint: row.token_endpoint?.trim() ?? '',
    userinfoEndpoint: row.userinfo_endpoint?.trim() ?? '',
    clientId: row.client_id?.trim() ?? '',
    clientSecret: row.client_secret?.trim() ?? '',
    scopes: row.scopes?.trim() || 'openid profile email',
    claimEmail: row.claim_email?.trim() || 'email',
    claimFirstName: row.claim_first_name?.trim() || 'given_name',
    claimLastName: row.claim_last_name?.trim() || 'family_name',
    defaultRole: row.default_role,
    autoProvision: row.auto_provision,
    successRedirectUrl: row.success_redirect_url?.trim() || null,
    errorRedirectUrl: row.error_redirect_url?.trim() || null
  };
}

async function loadOidcTenantConfigByTenantUid(tenantUid: string): Promise<OidcTenantConfig | null> {
  const result = await pool.query<OidcSsoConfigRow>(
    `
    SELECT
      t.id AS tenant_id,
      t.tenant_uid,
      c.enabled,
      c.authorization_endpoint,
      c.token_endpoint,
      c.userinfo_endpoint,
      c.client_id,
      c.client_secret,
      c.scopes,
      c.claim_email,
      c.claim_first_name,
      c.claim_last_name,
      c.default_role,
      c.auto_provision,
      c.success_redirect_url,
      c.error_redirect_url
    FROM tenants t
    INNER JOIN tenant_oidc_sso_configs c ON c.tenant_id = t.id
    WHERE t.tenant_uid = $1::uuid
    LIMIT 1
    `,
    [tenantUid]
  );

  const row = result.rows[0];
  return row ? toOidcTenantConfig(row) : null;
}

async function loadOidcTenantConfigByTenantId(tenantId: number): Promise<OidcTenantConfig | null> {
  const result = await pool.query<OidcSsoConfigRow>(
    `
    SELECT
      t.id AS tenant_id,
      t.tenant_uid,
      c.enabled,
      c.authorization_endpoint,
      c.token_endpoint,
      c.userinfo_endpoint,
      c.client_id,
      c.client_secret,
      c.scopes,
      c.claim_email,
      c.claim_first_name,
      c.claim_last_name,
      c.default_role,
      c.auto_provision,
      c.success_redirect_url,
      c.error_redirect_url
    FROM tenants t
    INNER JOIN tenant_oidc_sso_configs c ON c.tenant_id = t.id
    WHERE t.id = $1
    LIMIT 1
    `,
    [tenantId]
  );

  const row = result.rows[0];
  return row ? toOidcTenantConfig(row) : null;
}

function redirectOidcSsoError(res: Response, args: { reason: string; config: OidcTenantConfig | null }): void {
  const redirectUrl = args.config?.errorRedirectUrl ?? getDefaultLoginUrl();
  res.redirect(buildRedirectUrl(redirectUrl, {
    sso: 'error',
    provider: 'oidc',
    reason: args.reason
  }));
}

function redirectOidcSsoSuccess(res: Response, args: { config: OidcTenantConfig; response: AuthResponse }): void {
  const redirectUrl = args.config.successRedirectUrl ?? getDefaultLoginUrl();
  res.redirect(buildRedirectUrl(redirectUrl, {
    sso: 'success',
    provider: 'oidc',
    token: args.response.token,
    refresh_token: args.response.refresh_token
  }));
}

function createAccessTokenForUser(user: Pick<User, 'id' | 'tenant_id' | 'tenant_uid' | 'email' | 'role'>): string {
  return signToken({
    userId: user.id,
    tenantId: user.tenant_id,
    tenantUid: user.tenant_uid,
    email: user.email,
    role: user.role
  });
}

async function createAndPersistRefreshToken(args: {
  userId: number;
  tenantId: number;
  db: { query: (text: string, values?: unknown[]) => Promise<unknown> };
}): Promise<{ refreshToken: string; refreshTokenHash: string }> {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = buildRefreshTokenExpiresAt().toISOString();

  await args.db.query(
    `
    INSERT INTO auth_refresh_tokens (
      tenant_id,
      user_id,
      token_hash,
      expires_at
    )
    VALUES ($1, $2, $3, $4)
    `,
    [args.tenantId, args.userId, refreshTokenHash, expiresAt]
  );

  return { refreshToken, refreshTokenHash };
}

async function buildAuthResponseWithRefreshToken(args: {
  user: AuthUserRow;
  db: { query: (text: string, values?: unknown[]) => Promise<unknown> };
}): Promise<AuthResponse> {
  const token = createAccessTokenForUser(args.user);
  const { refreshToken } = await createAndPersistRefreshToken({
    userId: args.user.id,
    tenantId: args.user.tenant_id,
    db: args.db
  });

  return {
    token,
    refresh_token: refreshToken,
    user: omitPasswordHash(args.user)
  };
}

function isExpired(isoTimestamp: string): boolean {
  return new Date(isoTimestamp).getTime() <= Date.now();
}

router.post('/register', asyncHandler(async (req, res) => {
  const parse = registerSchema.safeParse(req.body satisfies RegisterRequest);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() });
    return;
  }

  const { email, password, first_name, last_name, phone, role } = parse.data;
  const passwordHash = await hashUserPassword(password);
  const tenant = await ensureDefaultTenant();

  try {
    const result = await pool.query<UserRecord>(
      `
      INSERT INTO users (tenant_id, email, first_name, last_name, phone, role, password_hash)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, tenant_id, $8::uuid::text AS tenant_uid, email, first_name, last_name, phone, role, created_at, updated_at, password_hash
      `,
      [tenant.id, email.toLowerCase(), first_name, last_name, phone ?? null, role, passwordHash, tenant.tenant_uid]
    );

    const user = result.rows[0];
    if (!user) {
      res.status(500).json({ error: 'Unable to register user' });
      return;
    }

    const response = await buildAuthResponseWithRefreshToken({
      user,
      db: pool
    });
    res.status(201).json(response);
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'Email already exists' });
      return;
    }

    res.status(500).json({ error: 'Unable to register user' });
  }
}));

router.post('/login', asyncHandler(async (req, res) => {
  const parse = loginSchema.safeParse(req.body satisfies LoginRequest);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() });
    return;
  }

  const { email, password } = parse.data;

  const result = await pool.query<LoginUserRow>(
    `
    SELECT
      u.id,
      u.tenant_id,
      t.tenant_uid,
      u.email,
      u.first_name,
      u.last_name,
      u.phone,
      u.role,
      u.is_active,
      u.created_at,
      u.updated_at,
      u.password_hash
    FROM users u
    INNER JOIN tenants t ON t.id = u.tenant_id
    WHERE u.email = $1
    `,
    [email.toLowerCase()]
  );

  const user = result.rows[0];
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (!user.is_active) {
    res.status(403).json({ error: 'Account is inactive' });
    return;
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);
  if (!passwordMatches) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const response = await buildAuthResponseWithRefreshToken({
    user,
    db: pool
  });
  res.json(response);
}));

router.get('/sso/oidc/start', asyncHandler(async (req, res) => {
  const queryParse = oidcSsoStartQuerySchema.safeParse(req.query);
  if (!queryParse.success) {
    res.status(400).json({ error: 'Invalid SSO start query', details: queryParse.error.flatten() });
    return;
  }

  const tenantUid = queryParse.data.tenant_uid ?? defaultTenantUid;
  const config = await loadOidcTenantConfigByTenantUid(tenantUid);
  if (!config) {
    res.status(404).json({ error: 'OIDC SSO tenant configuration not found' });
    return;
  }

  if (!config.enabled) {
    res.status(503).json({ error: 'OIDC SSO is disabled for this tenant' });
    return;
  }

  const redirectUri = getOidcSsoRedirectUri();
  const stateSecret = getOidcSsoStateSecret();
  if (!redirectUri || !stateSecret) {
    res.status(503).json({ error: 'OIDC SSO callback environment is not configured' });
    return;
  }

  if (!isOidcTenantConfigUsable(config)) {
    res.status(503).json({ error: 'OIDC SSO is not fully configured' });
    return;
  }

  const state = createOidcSsoState({
    tenantId: config.tenantId,
    stateSecret
  });

  const authorizationUrl = buildOidcAuthorizeUrl({
    config,
    redirectUri,
    state
  });

  const response: OidcSsoAuthUrlResponse = {
    authorization_url: authorizationUrl
  };
  res.json(response);
}));

router.get('/sso/oidc/callback', asyncHandler(async (req, res) => {
  const providerError = typeof req.query.error === 'string' ? req.query.error : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';

  if (providerError) {
    redirectOidcSsoError(res, {
      reason: providerError,
      config: null
    });
    return;
  }

  if (!code || !state) {
    redirectOidcSsoError(res, {
      reason: 'missing_callback_code_or_state',
      config: null
    });
    return;
  }

  const stateVerification = verifyOidcSsoState({ state });
  if (!stateVerification.ok) {
    redirectOidcSsoError(res, {
      reason: 'invalid_callback_state',
      config: null
    });
    return;
  }

  const config = await loadOidcTenantConfigByTenantId(stateVerification.tenantId);
  if (!config || !config.enabled || !isOidcTenantConfigUsable(config)) {
    redirectOidcSsoError(res, {
      reason: 'oidc_sso_not_configured',
      config
    });
    return;
  }

  const redirectUri = getOidcSsoRedirectUri();
  if (!redirectUri) {
    redirectOidcSsoError(res, {
      reason: 'oidc_callback_uri_missing',
      config
    });
    return;
  }

  try {
    const tokenResult = await exchangeOidcAuthorizationCode({
      config,
      code,
      redirectUri
    });
    const userInfo = await fetchOidcUserInfo({
      config,
      accessToken: tokenResult.accessToken
    });
    const profile = resolveOidcProfile({
      config,
      userInfo
    });
    if (!profile) {
      redirectOidcSsoError(res, {
        reason: 'missing_user_email_claim',
        config
      });
      return;
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const existingUserResult = await client.query<LoginUserRow>(
        `
        SELECT
          u.id,
          u.tenant_id,
          t.tenant_uid,
          u.email,
          u.first_name,
          u.last_name,
          u.phone,
          u.role,
          u.is_active,
          u.created_at,
          u.updated_at,
          u.password_hash
        FROM users u
        INNER JOIN tenants t ON t.id = u.tenant_id
        WHERE u.tenant_id = $1
          AND lower(u.email) = lower($2)
        LIMIT 1
        FOR UPDATE
        `,
        [config.tenantId, profile.email]
      );

      let user = existingUserResult.rows[0];
      if (!user) {
        if (!config.autoProvision) {
          await client.query('ROLLBACK');
          redirectOidcSsoError(res, {
            reason: 'sso_user_not_provisioned',
            config
          });
          return;
        }

        const generatedPasswordHash = await hashUserPassword(randomUUID());
        const userInsertResult = await client.query<LoginUserRow>(
          `
          INSERT INTO users (
            tenant_id,
            email,
            first_name,
            last_name,
            role,
            is_active,
            password_hash
          )
          VALUES ($1, $2, $3, $4, $5, true, $6)
          RETURNING
            id,
            tenant_id,
            $7::uuid::text AS tenant_uid,
            email,
            first_name,
            last_name,
            phone,
            role,
            is_active,
            created_at,
            updated_at,
            password_hash
          `,
          [
            config.tenantId,
            profile.email,
            profile.firstName,
            profile.lastName,
            config.defaultRole,
            generatedPasswordHash,
            config.tenantUid
          ]
        );
        user = userInsertResult.rows[0];
      }

      if (!user) {
        await client.query('ROLLBACK');
        redirectOidcSsoError(res, {
          reason: 'sso_user_provision_failed',
          config
        });
        return;
      }

      if (!user.is_active) {
        await client.query('ROLLBACK');
        redirectOidcSsoError(res, {
          reason: 'sso_user_inactive',
          config
        });
        return;
      }

      const authResponse = await buildAuthResponseWithRefreshToken({
        user,
        db: client
      });

      await client.query('COMMIT');
      redirectOidcSsoSuccess(res, {
        config,
        response: authResponse
      });
    } catch {
      await client.query('ROLLBACK');
      redirectOidcSsoError(res, {
        reason: 'sso_login_failed',
        config
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[oidc-sso] callback failed', error);
    redirectOidcSsoError(res, {
      reason: 'oidc_exchange_failed',
      config
    });
  }
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const parse = refreshTokenSchema.safeParse(req.body satisfies RefreshTokenRequest);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() });
    return;
  }

  const refreshTokenHash = hashRefreshToken(parse.data.refresh_token);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const sessionResult = await client.query<RefreshTokenSessionRow>(
      `
      SELECT
        rt.id AS refresh_token_id,
        rt.tenant_id AS token_tenant_id,
        rt.user_id AS token_user_id,
        rt.expires_at,
        rt.revoked_at,
        u.id,
        u.tenant_id,
        t.tenant_uid,
        u.email,
        u.first_name,
        u.last_name,
        u.phone,
        u.role,
        u.is_active,
        u.created_at,
        u.updated_at,
        u.password_hash
      FROM auth_refresh_tokens rt
      INNER JOIN users u
        ON u.id = rt.user_id
       AND u.tenant_id = rt.tenant_id
      INNER JOIN tenants t
        ON t.id = u.tenant_id
      WHERE rt.token_hash = $1
      LIMIT 1
      FOR UPDATE
      `,
      [refreshTokenHash]
    );

    const session = sessionResult.rows[0];
    if (!session) {
      await client.query('ROLLBACK');
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    if (!session.is_active || session.revoked_at || isExpired(session.expires_at)) {
      await client.query(
        `
        UPDATE auth_refresh_tokens
        SET
          revoked_at = COALESCE(revoked_at, NOW()),
          updated_at = NOW()
        WHERE user_id = $1
          AND tenant_id = $2
          AND revoked_at IS NULL
        `,
        [session.token_user_id, session.token_tenant_id]
      );
      await client.query('COMMIT');
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const response = await buildAuthResponseWithRefreshToken({
      user: session,
      db: client
    });
    const newRefreshTokenHash = hashRefreshToken(response.refresh_token);

    await client.query(
      `
      UPDATE auth_refresh_tokens
      SET
        revoked_at = NOW(),
        last_used_at = NOW(),
        replaced_by_token_hash = $2,
        updated_at = NOW()
      WHERE id = $1
      `,
      [session.refresh_token_id, newRefreshTokenHash]
    );

    await client.query('COMMIT');
    res.json(response);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.post('/logout', authMiddleware, asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const parse = logoutSchema.safeParse((req.body ?? {}) satisfies LogoutRequest);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() });
    return;
  }

  const refreshToken = parse.data.refresh_token?.trim();
  if (refreshToken) {
    await pool.query(
      `
      UPDATE auth_refresh_tokens
      SET
        revoked_at = NOW(),
        updated_at = NOW()
      WHERE token_hash = $1
        AND user_id = $2
        AND tenant_id = $3
        AND revoked_at IS NULL
      `,
      [hashRefreshToken(refreshToken), req.user.userId, req.user.tenantId]
    );
  } else {
    await pool.query(
      `
      UPDATE auth_refresh_tokens
      SET
        revoked_at = NOW(),
        updated_at = NOW()
      WHERE user_id = $1
        AND tenant_id = $2
        AND revoked_at IS NULL
      `,
      [req.user.userId, req.user.tenantId]
    );
  }

  res.status(204).send();
}));

router.get('/me', authMiddleware, asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const result = await pool.query<User>(
    `
    SELECT
      u.id,
      u.tenant_id,
      t.tenant_uid,
      u.email,
      u.first_name,
      u.last_name,
      u.phone,
      u.role,
      u.created_at
    FROM users u
    INNER JOIN tenants t ON t.id = u.tenant_id
    WHERE u.id = $1
      AND u.tenant_id = $2
      AND u.is_active = true
    `,
    [req.user.userId, req.user.tenantId]
  );

  const user = result.rows[0];
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const response: MeResponse = { user };
  res.json(response);
}));

router.get('/engineers', authMiddleware, requireRole(['pm', 'admin']), asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const result = await pool.query<User>(
    `
    SELECT
      u.id,
      u.tenant_id,
      t.tenant_uid,
      u.email,
      u.first_name,
      u.last_name,
      u.phone,
      u.role,
      u.created_at
    FROM users u
    INNER JOIN tenants t ON t.id = u.tenant_id
    WHERE u.role = 'engineer'
      AND u.tenant_id = $1
      AND u.is_active = true
    ORDER BY u.first_name ASC, u.last_name ASC
    `,
    [req.user.tenantId]
  );

  const response: EngineersResponse = { engineers: result.rows };
  res.json(response);
}));

router.get('/microsoft/status', authMiddleware, requireRole(['engineer']), asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const result = await pool.query<MicrosoftConnectionStatusRow>(
    `
    SELECT microsoft_user_email, access_token_expires_at
    FROM microsoft_calendar_connections
    WHERE user_id = $1
      AND app_tenant_id = $2
    LIMIT 1
    `,
    [req.user.userId, req.user.tenantId]
  );

  const row = result.rows[0];
  const response: MicrosoftCalendarStatusResponse = {
    connected: Boolean(row),
    account_email: row?.microsoft_user_email ?? null,
    token_expires_at: row?.access_token_expires_at ?? null
  };
  res.json(response);
}));

router.get('/microsoft/connect', authMiddleware, requireRole(['engineer']), asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const config = getMicrosoftOAuthConfig();
  if (!config.enabled) {
    res.status(503).json({ error: 'Microsoft Calendar sync is disabled' });
    return;
  }

  if (!isMicrosoftOAuthConfigured(config)) {
    res.status(503).json({ error: 'Microsoft OAuth is not configured' });
    return;
  }

  const authorizationUrl = buildMicrosoftAuthorizeUrl({
    userId: req.user.userId,
    config
  });

  const response: MicrosoftCalendarAuthUrlResponse = {
    authorization_url: authorizationUrl
  };
  res.json(response);
}));

router.get('/microsoft/callback', asyncHandler(async (req, res) => {
  const config = getMicrosoftOAuthConfig();
  if (!config.enabled) {
    redirectMicrosoftOAuthError(res, 'integration_disabled');
    return;
  }

  if (!isMicrosoftOAuthConfigured(config)) {
    redirectMicrosoftOAuthError(res, 'oauth_not_configured');
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';

  if (oauthError) {
    redirectMicrosoftOAuthError(res, oauthError);
    return;
  }

  if (!code || !state) {
    redirectMicrosoftOAuthError(res, 'missing_callback_code_or_state');
    return;
  }

  const stateVerification = verifyMicrosoftOAuthState({ state, config });
  if (!stateVerification.ok) {
    redirectMicrosoftOAuthError(res, 'invalid_callback_state');
    return;
  }

  const userResult = await pool.query<UserRoleLookupRow>(
    `
    SELECT u.role, u.tenant_id, t.tenant_uid
    FROM users u
    INNER JOIN tenants t ON t.id = u.tenant_id
    WHERE u.id = $1
      AND u.is_active = true
    LIMIT 1
    `,
    [stateVerification.userId]
  );

  const user = userResult.rows[0];
  if (!user || user.role !== 'engineer') {
    redirectMicrosoftOAuthError(res, 'engineer_account_required');
    return;
  }

  try {
    const tokenResult = await exchangeMicrosoftAuthorizationCode({ code, config });
    const profile = await fetchMicrosoftProfile(tokenResult.accessToken);

    await pool.query(
      `
      INSERT INTO microsoft_calendar_connections (
        user_id,
        app_tenant_id,
        microsoft_user_id,
        microsoft_user_email,
        microsoft_tenant_id,
        scope,
        access_token,
        refresh_token,
        access_token_expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + ($9::int * INTERVAL '1 second'))
      ON CONFLICT (user_id) DO UPDATE
      SET
        app_tenant_id = EXCLUDED.app_tenant_id,
        microsoft_user_id = EXCLUDED.microsoft_user_id,
        microsoft_user_email = EXCLUDED.microsoft_user_email,
        microsoft_tenant_id = EXCLUDED.microsoft_tenant_id,
        scope = EXCLUDED.scope,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        access_token_expires_at = EXCLUDED.access_token_expires_at,
        updated_at = NOW()
      `,
      [
        stateVerification.userId,
        user.tenant_id,
        profile.id,
        profile.email,
        config.tenantId,
        tokenResult.scope,
        tokenResult.accessToken,
        tokenResult.refreshToken,
        tokenResult.expiresInSeconds
      ]
    );

    redirectMicrosoftOAuthSuccess(res);
  } catch (error: unknown) {
    console.error('[microsoft-oauth] callback failed', error);
    redirectMicrosoftOAuthError(res, 'oauth_exchange_failed');
  }
}));

router.delete('/microsoft/connection', authMiddleware, requireRole(['engineer']), asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `
      DELETE FROM microsoft_calendar_events
      WHERE engineer_id = $1
        AND tenant_id = $2
      `,
      [req.user.userId, req.user.tenantId]
    );
    await client.query(
      `
      DELETE FROM microsoft_calendar_connections
      WHERE user_id = $1
        AND app_tenant_id = $2
      `,
      [req.user.userId, req.user.tenantId]
    );
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to disconnect Microsoft Calendar' });
    return;
  } finally {
    client.release();
  }

  res.status(204).send();
}));

// ─── Password Reset ────────────────────────────────────────────────────────

const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const FORGOT_PASSWORD_MAX_PER_HOUR = 3;

function hashResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function resolvePasswordResetBaseUrl(): string {
  const origin = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').trim().replace(/\/+$/, '');
  return `${origin}/reset-password`;
}

router.post('/forgot-password', publicWriteRateLimiter, asyncHandler(async (req, res) => {
  const data: ForgotPasswordRequest = forgotPasswordSchema.parse(req.body);

  // Always return generic success to prevent email enumeration
  const genericResponse = { message: 'If an account with that email exists, a password reset link has been sent.' };

  const userResult = await pool.query<{ id: number; tenant_id: number; first_name: string; is_active: boolean }>(
    'SELECT id, tenant_id, first_name, is_active FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [data.email]
  );

  const user = userResult.rows[0];
  if (!user || !user.is_active) {
    res.json(genericResponse);
    return;
  }

  // Rate-limit: max N requests per email per hour
  const recentCount = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM password_reset_tokens
     WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [user.id]
  );

  if (Number(recentCount.rows[0]?.count ?? 0) >= FORGOT_PASSWORD_MAX_PER_HOUR) {
    res.json(genericResponse);
    return;
  }

  // Invalidate any existing unused tokens for this user
  await pool.query(
    `UPDATE password_reset_tokens SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [user.id]
  );

  // Generate new token
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

  await pool.query(
    `INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [user.tenant_id, user.id, tokenHash, expiresAt.toISOString()]
  );

  // Queue email
  const resetUrl = `${resolvePasswordResetBaseUrl()}/${rawToken}`;
  enqueuePasswordResetEmailJob({
    recipientEmail: data.email,
    recipientFirstName: user.first_name,
    resetUrl
  });

  res.json(genericResponse);
}));

router.post('/reset-password', publicWriteRateLimiter, asyncHandler(async (req, res) => {
  const data: ResetPasswordRequest = resetPasswordSchema.parse(req.body);

  const tokenHash = hashResetToken(data.token);

  const tokenResult = await pool.query<{ id: number; user_id: number; expires_at: string; used_at: string | null }>(
    `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );

  const tokenRow = tokenResult.rows[0];
  if (!tokenRow) {
    res.status(400).json({ error: 'Invalid or expired reset token' });
    return;
  }

  if (tokenRow.used_at) {
    res.status(400).json({ error: 'This reset token has already been used' });
    return;
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    res.status(400).json({ error: 'This reset token has expired' });
    return;
  }

  // Update password and mark token as used in a transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const passwordHash = await hashUserPassword(data.password);
    await client.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, tokenRow.user_id]
    );

    await client.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
      [tokenRow.id]
    );

    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to reset password' });
    return;
  } finally {
    client.release();
  }

  res.json({ message: 'Password has been reset successfully' });
}));

function omitPasswordHash(user: UserRecord): User {
  return {
    id: user.id,
    tenant_id: user.tenant_id,
    tenant_uid: user.tenant_uid,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    phone: user.phone,
    role: user.role,
    created_at: user.created_at
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export default router;
