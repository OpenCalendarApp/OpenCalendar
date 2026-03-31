import crypto from 'node:crypto';
import type { RequestHandler } from 'express';

import { recordHttpRequestMetric } from '../observability/metrics.js';

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
  const traceId = req.requestId;

  const startTime = process.hrtime.bigint();
  console.log(JSON.stringify({
    level: 'info',
    event: 'request_started',
    request_id: req.requestId,
    trace_id: traceId,
    method: req.method,
    path: req.originalUrl.split('?')[0] ?? req.originalUrl,
    ip: getClientIp(req.ip),
    user_id: req.user?.userId ?? null,
    tenant_id: req.user?.tenantId ?? null,
    tenant_uid: req.user?.tenantUid ?? null
  }));

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    const normalizedPath = req.originalUrl.split('?')[0] ?? req.originalUrl;

    const payload = {
      level: 'info',
      event: 'request_finished',
      request_id: req.requestId,
      trace_id: traceId,
      method: req.method,
      path: normalizedPath,
      status_code: res.statusCode,
      duration_ms: Number(durationMs.toFixed(2)),
      ip: getClientIp(req.ip),
      user_id: req.user?.userId ?? null,
      tenant_id: req.user?.tenantId ?? null,
      tenant_uid: req.user?.tenantUid ?? null
    };

    console.log(JSON.stringify(payload));

    recordHttpRequestMetric({
      method: req.method,
      path: normalizedPath,
      statusCode: res.statusCode,
      durationMs
    });
  });

  next();
};
