import rateLimit from 'express-rate-limit';

import { recordRateLimitMetric } from '../observability/metrics.js';

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

function buildRateLimiter(limit: number, bucket: string) {
  return rateLimit({
    windowMs: publicWindowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler(req, res, _next, options) {
      recordRateLimitMetric(bucket);
      const rateLimitState = (req as typeof req & { rateLimit?: { resetTime?: Date } }).rateLimit;

      const retryAfterMs = rateLimitState?.resetTime
        ? Math.max(rateLimitState.resetTime.getTime() - Date.now(), 0)
        : publicWindowMs;
      const retryAfterSeconds = Math.max(Math.ceil(retryAfterMs / 1000), 1);

      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(options.statusCode).json({
        error: 'Too many requests',
        details: `Please wait ${retryAfterSeconds} second(s) and try again.`
      });
    }
  });
}

export const publicReadRateLimiter = buildRateLimiter(publicReadLimit, 'public-read');
export const publicWriteRateLimiter = buildRateLimiter(publicWriteLimit, 'public-write');
