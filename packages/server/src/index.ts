import 'dotenv/config';

import { pool } from './db/pool.js';
import { recoverPendingReminders, registerBookingReminderQueueHandlers } from './jobs/bookingReminders.js';
import { createDataRetentionScheduler } from './jobs/dataRetention.js';
import { registerEmailQueueHandlers } from './jobs/emailNotifications.js';
import { registerMicrosoftCalendarQueueHandlers } from './jobs/microsoftCalendar.js';
import { jobQueue } from './jobs/queue.js';
import { createApp } from './app.js';

const app = createApp();
registerEmailQueueHandlers();
registerMicrosoftCalendarQueueHandlers();
registerBookingReminderQueueHandlers();
jobQueue.start();
const dataRetentionScheduler = createDataRetentionScheduler({ db: pool });
dataRetentionScheduler.start();

const port = Number(process.env.PORT ?? 4000);

async function handleStartupError(error: NodeJS.ErrnoException): Promise<never> {
  jobQueue.stop();
  await dataRetentionScheduler.stop();
  await pool.end().catch(() => undefined);

  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${port} is already in use. Stop the existing process or restart Calendar Genie with PORT set to a different value.`
    );
  } else {
    console.error('Server failed to start.', error);
  }

  process.exit(1);
}

const server = app.listen(port);

server.once('error', (error) => {
  void handleStartupError(error as NodeJS.ErrnoException);
});

server.once('listening', () => {
  console.log(`Server listening on port ${port}`);
  void recoverPendingReminders().catch((error) => {
    console.error(JSON.stringify({
      level: 'error',
      event: 'booking_reminders_recovery_failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }));
  });
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
