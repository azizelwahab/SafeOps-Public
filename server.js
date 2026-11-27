import app from './src/app.js';
import { assertProductionDatabaseConfig, env } from './src/config/env.js';
import { disconnectDatabase } from './src/config/database.js';
import { createShutdown } from './src/utils/shutdown.js';

assertProductionDatabaseConfig();

const host = env.nodeEnv === 'development' ? '127.0.0.1' : undefined;
const server = app.listen(env.port, host, () => {
  console.info(`SafeOps listening on port ${env.port}`);
});

server.on('error', (error) => {
  console.error('Could not start the HTTP server:', error);
  process.exitCode = 1;
});

const shutdown = createShutdown(server, disconnectDatabase);
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
