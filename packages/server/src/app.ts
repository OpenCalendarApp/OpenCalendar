import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { pool } from './db/pool.js';
import { jobQueue } from './jobs/queue.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { asyncHandler } from './middleware/asyncHandler.js';
import { requestContextMiddleware } from './middleware/requestContext.js';
import { getMetricsSnapshot } from './observability/metrics.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import bookingRoutes from './routes/booking.js';
import brandingRoutes from './routes/branding.js';
import dashboardRoutes from './routes/dashboard.js';
import projectRoutes from './routes/projects.js';
import setupRoutes from './routes/setup.js';
import timeBlockRoutes from './routes/timeBlocks.js';

function mountApiVersionRoutes(app: express.Express, basePath: '/api' | '/api/v1'): void {
  app.get(`${basePath}/health/live`, (_req, res) => {
    res.json({
      ok: true,
      service: 'server',
      status: 'live',
      timestamp: new Date().toISOString()
    });
  });

  app.get(`${basePath}/health/ready`, asyncHandler(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      service: 'server',
      status: 'ready',
      timestamp: new Date().toISOString()
    });
  }));

  app.get(`${basePath}/health`, asyncHandler(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      service: 'server',
      status: 'ready',
      uptime_seconds: Number(process.uptime().toFixed(2)),
      timestamp: new Date().toISOString()
    });
  }));

  app.get(`${basePath}/metrics`, (req, res) => {
    const configuredToken = process.env.METRICS_TOKEN;
    const incomingToken = req.header('x-metrics-token');

    if (configuredToken && incomingToken !== configuredToken) {
      res.status(401).json({ error: 'Unauthorized metrics access' });
      return;
    }

    res.json({
      ok: true,
      service: 'server',
      timestamp: new Date().toISOString(),
      metrics: getMetricsSnapshot(),
      queue: jobQueue.getSnapshot()
    });
  });

  app.use(`${basePath}/auth`, authRoutes);
  app.use(`${basePath}/setup`, setupRoutes);
  app.use(`${basePath}/admin`, adminRoutes);
  app.use(`${basePath}/projects`, projectRoutes);
  app.use(`${basePath}/time-blocks`, timeBlockRoutes);
  app.use(`${basePath}/schedule`, bookingRoutes);
  app.use(`${basePath}/branding`, brandingRoutes);
  app.use(`${basePath}/dashboard`, dashboardRoutes);
}

export function createApp(): express.Express {
  const app = express();
  const trustProxySettingRaw = process.env.TRUST_PROXY ?? '1';
  const trustProxySetting =
    trustProxySettingRaw === 'true'
      ? true
      : trustProxySettingRaw === 'false'
        ? false
        : Number.isNaN(Number(trustProxySettingRaw))
          ? trustProxySettingRaw
          : Number(trustProxySettingRaw);

  app.set('trust proxy', trustProxySetting);
  app.use(requestContextMiddleware);
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173'
    })
  );
  app.use(express.json());

  app.use('/api/v1', (_req, res, next) => {
    res.setHeader('x-api-version', 'v1');
    next();
  });

  app.use('/api', (req, res, next) => {
    if (!req.path.startsWith('/v1/')) {
      res.setHeader('x-api-version', 'legacy');
      res.setHeader('x-api-latest-version', 'v1');
    }
    next();
  });

  mountApiVersionRoutes(app, '/api');
  mountApiVersionRoutes(app, '/api/v1');

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
