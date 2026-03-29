import rateLimit from 'express-rate-limit';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

const publicWindowMs = parsePositiveInt(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS, 60_000);
const publicReadLimit = parsePositiveInt(process.env.PUBLIC_READ_RATE_LIMIT_MAX, 120);
const publicWriteLimit = parsePositiveInt(process.env.PUBLIC_WRITE_RATE_LIMIT_MAX, 30);

function buildRateLimiter(limit: number) {
  return rateLimit({
    windowMs: publicWindowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many requests',
      details: 'Please wait and try again.'
    }
  });
}

export const publicReadRateLimiter = buildRateLimiter(publicReadLimit);
export const publicWriteRateLimiter = buildRateLimiter(publicWriteLimit);
