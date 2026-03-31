import type { PoolClient } from 'pg';

import type { UserRole } from '@session-scheduler/shared';

import { pool } from '../db/pool.js';

type Queryable = Pick<PoolClient, 'query'>;

export type AuditEntityType =
  | 'user'
  | 'tenant'
  | 'project'
  | 'time_block'
  | 'booking'
  | 'auth'
  | 'system';

export type RecordAuditEventArgs = {
  tenantId: number;
  actorUserId: number | null;
  actorRole: UserRole | 'system';
  action: string;
  entityType: AuditEntityType;
  entityId: number | null;
  metadata?: Record<string, unknown> | null;
  db?: Queryable;
};

export async function recordAuditEvent(args: RecordAuditEventArgs): Promise<void> {
  const db = args.db ?? pool;

  await db.query(
    `
    INSERT INTO audit_log_events (
      tenant_id,
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      args.tenantId,
      args.actorUserId,
      args.actorRole,
      args.action,
      args.entityType,
      args.entityId,
      JSON.stringify(args.metadata ?? {})
    ]
  );
}

export async function recordAuditEventSafe(args: RecordAuditEventArgs): Promise<void> {
  try {
    await recordAuditEvent(args);
  } catch (error: unknown) {
    console.warn(
      '[audit-log] failed to persist event',
      error instanceof Error ? error.message : 'unknown error'
    );
  }
}
