import 'dotenv/config';

import { pool } from './db/pool.js';
import { createDataRetentionScheduler } from './jobs/dataRetention.js';
import { registerEmailQueueHandlers } from './jobs/emailNotifications.js';
import { registerMicrosoftCalendarQueueHandlers } from './jobs/microsoftCalendar.js';
import { jobQueue } from './jobs/queue.js';
import { createApp } from './app.js';

const app = createApp();
registerEmailQueueHandlers();
registerMicrosoftCalendarQueueHandlers();
jobQueue.start();
const dataRetentionScheduler = createDataRetentionScheduler({ db: pool });
dataRetentionScheduler.start();

const port = Number(process.env.PORT ?? 4000);

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}. Shutting down server...`);
  jobQueue.stop();
  await dataRetentionScheduler.stop();

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
