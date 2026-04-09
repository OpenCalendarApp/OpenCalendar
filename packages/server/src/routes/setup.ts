import { Router } from 'express';

import {
  setupInitializeSchema,
  type AuthResponse,
  type SetupInitializeRequest,
  type SetupInitializeResponse,
  type SetupStatusResponse,
  type User,
  type UserRecord
} from '@opencalendar/shared';

import { pool } from '../db/pool.js';
import { signToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { publicReadRateLimiter, publicWriteRateLimiter } from '../middleware/rateLimit.js';
import { hashUserPassword } from '../utils/auth.js';
import {
  buildRefreshTokenExpiresAt,
  generateRefreshToken,
  hashRefreshToken
} from '../utils/refreshTokens.js';

const router = Router();

const defaultTenantUid = process.env.DEFAULT_TENANT_UID ?? '00000000-0000-0000-0000-000000000001';

type SetupStatusRow = {
  admin_user_count: number;
  tenant_count: number;
};

type TenantRow = {
  id: number;
  tenant_uid: string;
};

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

async function buildAuthResponseWithRefreshToken(args: {
  user: UserRecord;
  db: { query: (text: string, values?: unknown[]) => Promise<unknown> };
}): Promise<AuthResponse> {
  const token = signToken({
    userId: args.user.id,
    tenantId: args.user.tenant_id,
    tenantUid: args.user.tenant_uid,
    email: args.user.email,
    role: args.user.role
  });

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
    [args.user.tenant_id, args.user.id, refreshTokenHash, expiresAt]
  );

  return {
    token,
    refresh_token: refreshToken,
    user: omitPasswordHash(args.user)
  };
}

router.get('/status', publicReadRateLimiter, asyncHandler(async (_req, res) => {
  const result = await pool.query<SetupStatusRow>(
    `
    SELECT
      (
        SELECT COUNT(*)::int
        FROM users
        WHERE role = 'admin'
      ) AS admin_user_count,
      (
        SELECT COUNT(*)::int
        FROM tenants
      ) AS tenant_count
    `
  );

  const row = result.rows[0];
  const adminUserCount = row?.admin_user_count ?? 0;
  const tenantCount = row?.tenant_count ?? 0;

  const response: SetupStatusResponse = {
    is_initialized: adminUserCount > 0,
    requires_setup: adminUserCount === 0,
    admin_user_count: adminUserCount,
    tenant_count: tenantCount
  };

  res.json(response);
}));

router.post('/initialize', publicWriteRateLimiter, asyncHandler(async (req, res) => {
  const parse = setupInitializeSchema.safeParse(req.body satisfies SetupInitializeRequest);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() });
    return;
  }

  const data = parse.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');

    const existingAdminsResult = await client.query<{ admin_user_count: number }>(
      `
      SELECT COUNT(*)::int AS admin_user_count
      FROM users
      WHERE role = 'admin'
      `
    );
    const existingAdminCount = existingAdminsResult.rows[0]?.admin_user_count ?? 0;
    if (existingAdminCount > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Initial setup has already been completed' });
      return;
    }

    const tenantResult = await client.query<TenantRow>(
      `
      INSERT INTO tenants (tenant_uid, name)
      VALUES ($1::uuid, $2)
      ON CONFLICT (tenant_uid) DO UPDATE
      SET
        name = EXCLUDED.name,
        updated_at = NOW()
      RETURNING id, tenant_uid
      `,
      [defaultTenantUid, data.tenant_name]
    );

    const tenant = tenantResult.rows[0];
    if (!tenant) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Unable to initialize tenant' });
      return;
    }

    const passwordHash = await hashUserPassword(data.password);
    const userResult = await client.query<UserRecord>(
      `
      INSERT INTO users (
        tenant_id,
        email,
        first_name,
        last_name,
        phone,
        role,
        is_active,
        password_hash
      )
      VALUES ($1, $2, $3, $4, $5, 'admin', true, $6)
      RETURNING
        id,
        tenant_id,
        $7::uuid::text AS tenant_uid,
        email,
        first_name,
        last_name,
        phone,
        role,
        created_at,
        updated_at,
        password_hash
      `,
      [
        tenant.id,
        data.email.toLowerCase(),
        data.first_name,
        data.last_name,
        data.phone ?? null,
        passwordHash,
        tenant.tenant_uid
      ]
    );

    const user = userResult.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Unable to initialize admin account' });
      return;
    }

    const authResponse = await buildAuthResponseWithRefreshToken({
      user,
      db: client
    });

    await client.query('COMMIT');

    const response: SetupInitializeResponse = {
      ...authResponse,
      message: 'Initial setup completed'
    };
    res.status(201).json(response);
  } catch (error) {
    await client.query('ROLLBACK');

    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'Email already exists' });
      return;
    }

    res.status(500).json({ error: 'Unable to complete initial setup' });
  } finally {
    client.release();
  }
}));

export default router;
