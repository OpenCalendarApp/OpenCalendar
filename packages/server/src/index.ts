import 'dotenv/config';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import authRoutes from './routes/auth.js';
import bookingRoutes from './routes/booking.js';
import projectRoutes from './routes/projects.js';
import timeBlockRoutes from './routes/timeBlocks.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173'
  })
);
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'server' });
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/time-blocks', timeBlockRoutes);
app.use('/api/schedule', bookingRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
