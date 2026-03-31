import { createHash, randomBytes } from 'node:crypto';

const REFRESH_TOKEN_TTL_DAYS_DEFAULT = 30;
const REFRESH_TOKEN_TTL_DAYS_MIN = 1;
const REFRESH_TOKEN_TTL_DAYS_MAX = 365;

export function resolveRefreshTokenTtlDays(
  rawValue: string | undefined = process.env.REFRESH_TOKEN_TTL_DAYS
): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return REFRESH_TOKEN_TTL_DAYS_DEFAULT;
  }

  const normalized = Math.floor(parsed);
  if (normalized < REFRESH_TOKEN_TTL_DAYS_MIN) {
    return REFRESH_TOKEN_TTL_DAYS_MIN;
  }
  if (normalized > REFRESH_TOKEN_TTL_DAYS_MAX) {
    return REFRESH_TOKEN_TTL_DAYS_MAX;
  }

  return normalized;
}

export function buildRefreshTokenExpiresAt(
  ttlDays: number = resolveRefreshTokenTtlDays(),
  nowMs: number = Date.now()
): Date {
  return new Date(nowMs + ttlDays * 24 * 60 * 60 * 1000);
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}
