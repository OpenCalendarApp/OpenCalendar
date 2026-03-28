import bcrypt from 'bcrypt';

import { pool } from './pool.js';

const PM_EMAIL = 'pm@example.com';
const ENGINEER_EMAIL = 'engineer@example.com';

async function runSeed(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const pmPasswordHash = await bcrypt.hash('password123', 12);
    const engineerPasswordHash = await bcrypt.hash('password123', 12);
    const projectPasswordHash = await bcrypt.hash('demo1234', 10);

    const pmResult = await client.query<{ id: number }>(
      `
      INSERT INTO users (email, first_name, last_name, role, password_hash)
      VALUES ($1, $2, $3, 'pm', $4)
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id
      `,
      [PM_EMAIL, 'Project', 'Manager', pmPasswordHash]
    );

    const engineerResult = await client.query<{ id: number }>(
      `
      INSERT INTO users (email, first_name, last_name, role, password_hash)
      VALUES ($1, $2, $3, 'engineer', $4)
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id
      `,
      [ENGINEER_EMAIL, 'Field', 'Engineer', engineerPasswordHash]
    );

    const existingProject = await client.query<{ id: number }>(
      `
      SELECT id
      FROM projects
      WHERE name = $1
      LIMIT 1
      `,
      ['Demo Project']
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
            created_by,
            signup_password_hash,
            is_group_signup,
            max_group_size,
            session_length_minutes
          )
          VALUES ($1, $2, $3, $4, false, 1, 60)
          RETURNING id
          `,
          ['Demo Project', 'Seeded project for local development', pmId, projectPasswordHash]
        );

    const projectId = existingProject.rows[0]?.id ?? projectInsertResult?.rows[0]?.id;

    if (!projectId) {
      throw new Error('Unable to upsert seed project');
    }

    const blockResult = await client.query<{ id: number }>(
      `
      INSERT INTO time_blocks (project_id, start_time, end_time, max_signups, is_personal, created_by)
      VALUES ($1, NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 1 hour', 1, false, $2)
      RETURNING id
      `,
      [projectId, pmId]
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
