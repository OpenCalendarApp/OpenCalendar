import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { pool } from './db/pool.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { asyncHandler } from './middleware/asyncHandler.js';
import { requestContextMiddleware } from './middleware/requestContext.js';
import authRoutes from './routes/auth.js';
import bookingRoutes from './routes/booking.js';
import projectRoutes from './routes/projects.js';
import timeBlockRoutes from './routes/timeBlocks.js';

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

  app.get('/api/health/live', (_req, res) => {
    res.json({
      ok: true,
      service: 'server',
      status: 'live',
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/health/ready', asyncHandler(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      service: 'server',
      status: 'ready',
      timestamp: new Date().toISOString()
    });
  }));

  app.get('/api/health', asyncHandler(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      service: 'server',
      status: 'ready',
      uptime_seconds: Number(process.uptime().toFixed(2)),
      timestamp: new Date().toISOString()
    });
  }));

  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/time-blocks', timeBlockRoutes);
  app.use('/api/schedule', bookingRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
