import crypto from 'node:crypto';
import type { RequestHandler } from 'express';

function getClientIp(ip: string | undefined): string {
  if (!ip) {
    return 'unknown';
  }

  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }

  return ip;
}

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const incomingRequestId = req.header('x-request-id');
  req.requestId = incomingRequestId && incomingRequestId.trim().length > 0
    ? incomingRequestId.trim()
    : crypto.randomUUID();

  res.setHeader('x-request-id', req.requestId);

  const startTime = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

    const payload = {
      level: 'info',
      request_id: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status_code: res.statusCode,
      duration_ms: Number(durationMs.toFixed(2)),
      ip: getClientIp(req.ip),
      user_id: req.user?.userId ?? null
    };

    console.log(JSON.stringify(payload));
  });

  next();
};
