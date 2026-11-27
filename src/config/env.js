import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port,
  databaseUrl: process.env.NODE_ENV === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL,
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export function assertProductionDatabaseConfig(config = env, tlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  if (config.nodeEnv !== 'production') return;
  const url = URL.parse(config.databaseUrl ?? '');
  const sslModes = url?.searchParams.getAll('sslmode');
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
      !url.username || !url.pathname.slice(1) || url.hash ||
      sslModes.length !== 1 || sslModes[0] !== 'verify-full' ||
      url.searchParams.has('ssl') || url.searchParams.has('host') || url.searchParams.has('hostaddr') ||
      tlsSetting === '0') {
    throw new Error('Production DATABASE_URL must specify a PostgreSQL host, user and database with sslmode=verify-full and TLS verification enabled.');
  }
}
