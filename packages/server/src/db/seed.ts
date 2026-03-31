import bcrypt from 'bcrypt';

import { pool } from './pool.js';

const ADMIN_EMAIL = 'admin@example.com';
const PM_EMAIL = 'pm@example.com';
const ENGINEER_EMAIL = 'engineer@example.com';
const DEFAULT_TENANT_UID = process.env.DEFAULT_TENANT_UID ?? '00000000-0000-0000-0000-000000000001';

async function runSeed(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const pmPasswordHash = await bcrypt.hash('password123', 12);
    const adminPasswordHash = await bcrypt.hash('password123', 12);
    const engineerPasswordHash = await bcrypt.hash('password123', 12);
    const projectPasswordHash = await bcrypt.hash('demo1234', 10);

    const tenantResult = await client.query<{ id: number }>(
      `
      INSERT INTO tenants (tenant_uid, name)
      VALUES ($1, $2)
      ON CONFLICT (tenant_uid) DO UPDATE
      SET name = EXCLUDED.name
      RETURNING id
      `,
      [DEFAULT_TENANT_UID, 'Default Tenant']
    );

    const tenantId = tenantResult.rows[0]?.id;
    if (!tenantId) {
      throw new Error('Unable to upsert default tenant');
    }

    await client.query<{ id: number }>(
      `
      INSERT INTO users (tenant_id, email, first_name, last_name, role, password_hash, is_active)
      VALUES ($1, $2, $3, $4, 'admin', $5, true)
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id
      `,
      [tenantId, ADMIN_EMAIL, 'Platform', 'Admin', adminPasswordHash]
    );

    const pmResult = await client.query<{ id: number }>(
      `
      INSERT INTO users (tenant_id, email, first_name, last_name, role, password_hash, is_active)
      VALUES ($1, $2, $3, $4, 'pm', $5, true)
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id
      `,
      [tenantId, PM_EMAIL, 'Project', 'Manager', pmPasswordHash]
    );

    const engineerResult = await client.query<{ id: number }>(
      `
      INSERT INTO users (tenant_id, email, first_name, last_name, role, password_hash, is_active)
      VALUES ($1, $2, $3, $4, 'engineer', $5, true)
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id
      `,
      [tenantId, ENGINEER_EMAIL, 'Field', 'Engineer', engineerPasswordHash]
    );

    const existingProject = await client.query<{ id: number }>(
      `
      SELECT id
      FROM projects
      WHERE name = $1
        AND tenant_id = $2
      LIMIT 1
      `,
      ['Demo Project', tenantId]
    );

    const pmId = pmResult.rows[0]?.id;
    const engineerId = engineerResult.rows[0]?.id;

    if (!pmId || !engineerId) {
      throw new Error('Unable to upsert seed users');
    }

    const projectInsertResult = existingProject.rows[0]
      ? null
      : await client.query<{ id: number }>(
          `
          INSERT INTO projects (
            name,
            description,
            tenant_id,
            created_by,
            signup_password_hash,
            is_group_signup,
            max_group_size,
            session_length_minutes
          )
          VALUES ($1, $2, $3, $4, $5, false, 1, 60)
          RETURNING id
          `,
          ['Demo Project', 'Seeded project for local development', tenantId, pmId, projectPasswordHash]
        );

    const projectId = existingProject.rows[0]?.id ?? projectInsertResult?.rows[0]?.id;

    if (!projectId) {
      throw new Error('Unable to upsert seed project');
    }

    const blockResult = await client.query<{ id: number }>(
      `
      INSERT INTO time_blocks (project_id, tenant_id, start_time, end_time, max_signups, is_personal, created_by)
      VALUES ($1, $2, NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 1 hour', 1, false, $3)
      RETURNING id
      `,
      [projectId, tenantId, pmId]
    );

    const blockId = blockResult.rows[0]?.id;
    if (!blockId) {
      throw new Error('Unable to create seed time block');
    }

    await client.query(
      `
      INSERT INTO time_block_engineers (time_block_id, engineer_id)
      VALUES ($1, $2)
      ON CONFLICT (time_block_id, engineer_id) DO NOTHING
      `,
      [blockId, engineerId]
    );

    await client.query('COMMIT');
    console.log('Seed data loaded');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    console.error('Seed failed', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void runSeed();
