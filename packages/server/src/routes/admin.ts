import { Router } from 'express';

import {
  type AdminAuditEvent,
  type AdminAuditLogResponse,
  type AdminOidcSsoConfig,
  type AdminOidcSsoConfigResponse,
  numericIdParamsSchema,
  updateAdminOidcSsoConfigSchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
  type AdminOverviewResponse,
  type AdminOverviewStats,
  type AdminUserResponse,
  type AdminUsersResponse,
  type AdminUserSummary,
  type UpdateAdminOidcSsoConfigRequest,
  type UserRole
} from '@calendar-genie/shared';

import { pool } from '../db/pool.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { recordAuditEventSafe } from '../utils/audit.js';

const router = Router();

type AdminOverviewRow = AdminOverviewStats;
type AdminAuditEventRow = Omit<AdminAuditEvent, 'metadata'> & { metadata: unknown };
type AdminOidcSsoConfigRow = {
  tenant_id: number;
  enabled: boolean;
  issuer_url: string | null;
  authorization_endpoint: string | null;
  token_endpoint: string | null;
  userinfo_endpoint: string | null;
  client_id: string | null;
  client_secret: string | null;
  scopes: string;
  default_role: 'pm' | 'engineer';
  auto_provision: boolean;
  claim_email: string;
  claim_first_name: string;
  claim_last_name: string;
  success_redirect_url: string | null;
  error_redirect_url: string | null;
};

function normalizeOptionalString(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function mapAdminOidcSsoConfig(row: AdminOidcSsoConfigRow | undefined): AdminOidcSsoConfig {
  if (!row) {
    return {
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
  }

  return {
    enabled: row.enabled,
    issuer_url: normalizeOptionalString(row.issuer_url),
    authorization_endpoint: normalizeOptionalString(row.authorization_endpoint),
    token_endpoint: normalizeOptionalString(row.token_endpoint),
    userinfo_endpoint: normalizeOptionalString(row.userinfo_endpoint),
    client_id: normalizeOptionalString(row.client_id),
    client_secret_configured: Boolean(row.client_secret),
    scopes: row.scopes,
    default_role: row.default_role,
    auto_provision: row.auto_provision,
    claim_email: row.claim_email,
    claim_first_name: row.claim_first_name,
    claim_last_name: row.claim_last_name,
    success_redirect_url: normalizeOptionalString(row.success_redirect_url),
    error_redirect_url: normalizeOptionalString(row.error_redirect_url)
  };
}

router.use(authMiddleware);
router.use(requireRole(['admin']));

router.get('/overview', asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const result = await pool.query<AdminOverviewRow>(
    `
    SELECT
      (
        SELECT COUNT(*)::int
        FROM users
        WHERE tenant_id = $1
      ) AS total_users,
      (
        SELECT COUNT(*)::int
        FROM users
        WHERE tenant_id = $1
          AND is_active = true
      ) AS active_users,
      (
        SELECT COUNT(*)::int
        FROM users
        WHERE tenant_id = $1
          AND role = 'admin'
      ) AS admins,
      (
        SELECT COUNT(*)::int
        FROM users
        WHERE tenant_id = $1
          AND role = 'pm'
      ) AS pms,
      (
        SELECT COUNT(*)::int
        FROM users
        WHERE tenant_id = $1
          AND role = 'engineer'
      ) AS engineers,
      (
        SELECT COUNT(*)::int
        FROM projects
        WHERE tenant_id = $1
      ) AS projects,
      (
        SELECT COUNT(*)::int
        FROM projects
        WHERE tenant_id = $1
          AND is_active = true
      ) AS active_projects,
      (
        SELECT COUNT(*)::int
        FROM time_blocks
        WHERE tenant_id = $1
      ) AS time_blocks,
      (
        SELECT COUNT(*)::int
        FROM bookings
        WHERE tenant_id = $1
          AND cancelled_at IS NULL
      ) AS active_bookings
    `,
    [req.user.tenantId]
  );

  const stats = result.rows[0];
  if (!stats) {
    res.status(500).json({ error: 'Unable to load admin overview' });
    return;
  }

  const response: AdminOverviewResponse = { stats };
  res.json(response);
}));

router.get('/users', asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const roleRaw = typeof req.query.role === 'string' ? req.query.role.trim() : '';
  const isActiveRaw = typeof req.query.is_active === 'string' ? req.query.is_active.trim().toLowerCase() : '';
  const roleFilter = roleRaw.length > 0 ? updateUserRoleSchema.shape.role.safeParse(roleRaw) : null;

  if (roleFilter && !roleFilter.success) {
    res.status(400).json({ error: 'Invalid role filter' });
    return;
  }

  let isActiveFilter: boolean | null = null;
  if (isActiveRaw.length > 0) {
    if (isActiveRaw === 'true' || isActiveRaw === '1') {
      isActiveFilter = true;
    } else if (isActiveRaw === 'false' || isActiveRaw === '0') {
      isActiveFilter = false;
    } else {
      res.status(400).json({ error: 'Invalid is_active filter' });
      return;
    }
  }

  const whereClauses: string[] = ['u.tenant_id = $1'];
  const values: Array<string | number | boolean> = [req.user.tenantId];

  if (roleFilter?.success) {
    values.push(roleFilter.data);
    whereClauses.push(`u.role = $${values.length}`);
  }
  if (isActiveFilter !== null) {
    values.push(isActiveFilter);
    whereClauses.push(`u.is_active = $${values.length}`);
  }

  const result = await pool.query<AdminUserSummary>(
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
      u.updated_at
    FROM users u
    INNER JOIN tenants t ON t.id = u.tenant_id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY u.created_at DESC, u.id DESC
    `,
    values
  );

  const response: AdminUsersResponse = { users: result.rows };
  res.json(response);
}));

router.get('/audit', asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const limitRaw = typeof req.query.limit === 'string' ? req.query.limit.trim() : '';
  const parsedLimit = Number(limitRaw);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(200, Math.floor(parsedLimit)))
    : 50;

  const result = await pool.query<AdminAuditEventRow>(
    `
    SELECT
      ae.id,
      ae.tenant_id,
      ae.actor_user_id,
      ae.actor_role,
      CASE
        WHEN u.id IS NULL THEN NULL
        ELSE CONCAT(u.first_name, ' ', u.last_name)
      END AS actor_name,
      u.email AS actor_email,
      ae.action,
      ae.entity_type,
      ae.entity_id,
      ae.metadata,
      ae.created_at
    FROM audit_log_events ae
    LEFT JOIN users u ON u.id = ae.actor_user_id
    WHERE ae.tenant_id = $1
    ORDER BY ae.created_at DESC, ae.id DESC
    LIMIT $2
    `,
    [req.user.tenantId, limit]
  );

  const events: AdminAuditEvent[] = result.rows.map((row) => ({
    ...row,
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : {}
  }));

  const response: AdminAuditLogResponse = { events };
  res.json(response);
}));

router.get('/sso/oidc', asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const result = await pool.query<AdminOidcSsoConfigRow>(
    `
    SELECT
      tenant_id,
      enabled,
      issuer_url,
      authorization_endpoint,
      token_endpoint,
      userinfo_endpoint,
      client_id,
      client_secret,
      scopes,
      default_role,
      auto_provision,
      claim_email,
      claim_first_name,
      claim_last_name,
      success_redirect_url,
      error_redirect_url
    FROM tenant_oidc_sso_configs
    WHERE tenant_id = $1
    LIMIT 1
    `,
    [req.user.tenantId]
  );

  const response: AdminOidcSsoConfigResponse = {
    config: mapAdminOidcSsoConfig(result.rows[0])
  };
  res.json(response);
}));

router.put('/sso/oidc', asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const bodyParse = updateAdminOidcSsoConfigSchema.safeParse(req.body satisfies UpdateAdminOidcSsoConfigRequest);
  if (!bodyParse.success) {
    res.status(400).json({ error: 'Validation failed', details: bodyParse.error.flatten() });
    return;
  }

  const data = bodyParse.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingResult = await client.query<AdminOidcSsoConfigRow>(
      `
      SELECT
        tenant_id,
        enabled,
        issuer_url,
        authorization_endpoint,
        token_endpoint,
        userinfo_endpoint,
        client_id,
        client_secret,
        scopes,
        default_role,
        auto_provision,
        claim_email,
        claim_first_name,
        claim_last_name,
        success_redirect_url,
        error_redirect_url
      FROM tenant_oidc_sso_configs
      WHERE tenant_id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [req.user.tenantId]
    );

    const existing = existingResult.rows[0];
    const incomingClientSecret = data.client_secret.trim();
    const resolvedClientSecret = incomingClientSecret.length > 0
      ? incomingClientSecret
      : (existing?.client_secret ?? null);

    if (data.enabled && !resolvedClientSecret) {
      await client.query('ROLLBACK');
      res.status(400).json({
        error: 'client_secret is required when SSO is enabled'
      });
      return;
    }

    const upsertResult = await client.query<AdminOidcSsoConfigRow>(
      `
      INSERT INTO tenant_oidc_sso_configs (
        tenant_id,
        enabled,
        issuer_url,
        authorization_endpoint,
        token_endpoint,
        userinfo_endpoint,
        client_id,
        client_secret,
        scopes,
        default_role,
        auto_provision,
        claim_email,
        claim_first_name,
        claim_last_name,
        success_redirect_url,
        error_redirect_url
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16
      )
      ON CONFLICT (tenant_id) DO UPDATE
      SET
        enabled = EXCLUDED.enabled,
        issuer_url = EXCLUDED.issuer_url,
        authorization_endpoint = EXCLUDED.authorization_endpoint,
        token_endpoint = EXCLUDED.token_endpoint,
        userinfo_endpoint = EXCLUDED.userinfo_endpoint,
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        scopes = EXCLUDED.scopes,
        default_role = EXCLUDED.default_role,
        auto_provision = EXCLUDED.auto_provision,
        claim_email = EXCLUDED.claim_email,
        claim_first_name = EXCLUDED.claim_first_name,
        claim_last_name = EXCLUDED.claim_last_name,
        success_redirect_url = EXCLUDED.success_redirect_url,
        error_redirect_url = EXCLUDED.error_redirect_url,
        updated_at = NOW()
      RETURNING
        tenant_id,
        enabled,
        issuer_url,
        authorization_endpoint,
        token_endpoint,
        userinfo_endpoint,
        client_id,
        client_secret,
        scopes,
        default_role,
        auto_provision,
        claim_email,
        claim_first_name,
        claim_last_name,
        success_redirect_url,
        error_redirect_url
      `,
      [
        req.user.tenantId,
        data.enabled,
        data.issuer_url.trim() || null,
        data.authorization_endpoint.trim() || null,
        data.token_endpoint.trim() || null,
        data.userinfo_endpoint.trim() || null,
        data.client_id.trim() || null,
        resolvedClientSecret,
        data.scopes.trim(),
        data.default_role,
        data.auto_provision,
        data.claim_email.trim(),
        data.claim_first_name.trim(),
        data.claim_last_name.trim(),
        data.success_redirect_url.trim() || null,
        data.error_redirect_url.trim() || null
      ]
    );

    const row = upsertResult.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Unable to update OIDC SSO configuration' });
      return;
    }

    await recordAuditEventSafe({
      tenantId: req.user.tenantId,
      actorUserId: req.user.userId,
      actorRole: req.user.role,
      action: 'admin.sso.oidc_config_updated',
      entityType: 'tenant',
      entityId: req.user.tenantId,
      metadata: {
        enabled: row.enabled,
        default_role: row.default_role,
        auto_provision: row.auto_provision,
        client_secret_updated: incomingClientSecret.length > 0
      },
      db: client
    });

    await client.query('COMMIT');

    const response: AdminOidcSsoConfigResponse = {
      config: mapAdminOidcSsoConfig(row)
    };
    res.json(response);
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to update OIDC SSO configuration' });
  } finally {
    client.release();
  }
}));

router.patch('/users/:id/role', asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const paramsParse = numericIdParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid user id', details: paramsParse.error.flatten() });
    return;
  }

  const bodyParse = updateUserRoleSchema.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: 'Validation failed', details: bodyParse.error.flatten() });
    return;
  }

  const userId = paramsParse.data.id;
  const role = bodyParse.data.role as UserRole;

  const result = await pool.query<AdminUserSummary>(
    `
    UPDATE users u
    SET
      role = $1,
      updated_at = NOW()
    FROM tenants t
    WHERE u.id = $2
      AND u.tenant_id = $3
      AND t.id = u.tenant_id
    RETURNING
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
      u.updated_at
    `,
    [role, userId, req.user.tenantId]
  );

  const user = result.rows[0];
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const response: AdminUserResponse = { user };
  await recordAuditEventSafe({
    tenantId: req.user.tenantId,
    actorUserId: req.user.userId,
    actorRole: req.user.role,
    action: 'admin.user.role_updated',
    entityType: 'user',
    entityId: user.id,
    metadata: {
      new_role: user.role
    }
  });
  res.json(response);
}));

router.patch('/users/:id/status', asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Missing authenticated user' });
    return;
  }

  const paramsParse = numericIdParamsSchema.safeParse(req.params);
  if (!paramsParse.success) {
    res.status(400).json({ error: 'Invalid user id', details: paramsParse.error.flatten() });
    return;
  }

  const bodyParse = updateUserStatusSchema.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: 'Validation failed', details: bodyParse.error.flatten() });
    return;
  }

  const userId = paramsParse.data.id;
  const isActive = bodyParse.data.is_active;

  if (userId === req.user.userId && !isActive) {
    res.status(400).json({ error: 'Cannot deactivate your own account' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<AdminUserSummary>(
      `
      UPDATE users u
      SET
        is_active = $1,
        updated_at = NOW()
      FROM tenants t
      WHERE u.id = $2
        AND u.tenant_id = $3
        AND t.id = u.tenant_id
      RETURNING
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
        u.updated_at
      `,
      [isActive, userId, req.user.tenantId]
    );

    const user = result.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!isActive) {
      await client.query(
        `
        UPDATE auth_refresh_tokens
        SET
          revoked_at = NOW(),
          updated_at = NOW()
        WHERE user_id = $1
          AND tenant_id = $2
          AND revoked_at IS NULL
        `,
        [userId, req.user.tenantId]
      );
    }

    await recordAuditEventSafe({
      tenantId: req.user.tenantId,
      actorUserId: req.user.userId,
      actorRole: req.user.role,
      action: 'admin.user.status_updated',
      entityType: 'user',
      entityId: user.id,
      metadata: {
        is_active: user.is_active
      },
      db: client
    });

    await client.query('COMMIT');
    const response: AdminUserResponse = { user };
    res.json(response);
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Unable to update user status' });
  } finally {
    client.release();
  }
}));

export default router;
