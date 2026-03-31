import { createHash } from 'node:crypto';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;

export type ParsedIdempotencyKey =
  | { ok: true; key: string | null }
  | { ok: false; error: string };

export function parseIdempotencyKey(rawKey: string | undefined): ParsedIdempotencyKey {
  if (rawKey === undefined) {
    return { ok: true, key: null };
  }

  const key = rawKey.trim();
  if (key.length === 0) {
    return { ok: false, error: 'Idempotency-Key cannot be empty' };
  }

  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return {
      ok: false,
      error: 'Idempotency-Key must be 8-128 chars and only contain letters, numbers, :, _, or -'
    };
  }

  return { ok: true, key };
}

export function buildBookingIdempotencyFingerprint(args: {
  shareToken: string;
  password: string;
  timeBlockId: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}): string {
  const payload = {
    endpoint: 'POST:/api/schedule/book/:shareToken',
    share_token: args.shareToken,
    password: args.password,
    time_block_id: args.timeBlockId,
    first_name: args.firstName.trim(),
    last_name: args.lastName.trim(),
    email: args.email.trim().toLowerCase(),
    phone: args.phone.trim()
  };

  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

