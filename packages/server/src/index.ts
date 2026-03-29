import 'dotenv/config';

import { pool } from './db/pool.js';
import { createApp } from './app.js';

const app = createApp();

const port = Number(process.env.PORT ?? 4000);

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}. Shutting down server...`);

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
