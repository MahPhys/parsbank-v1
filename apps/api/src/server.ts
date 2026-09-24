/**
 * BANK PARS — process entry point.
 *
 *   npm run api:dev     (tsx watch)
 *   npm run api:start   (tsx)
 */
import { startServer } from './http/server.ts';
import { closeDatabase } from './db/index.ts';

async function main(): Promise<void> {
  const app = await startServer();

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('BANK PARS failed to start:', error);
  process.exit(1);
});
