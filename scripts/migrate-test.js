import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });

async function migrateTestDatabase() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || new URL(connectionString).pathname !== '/safeops_test') {
    throw new Error('Expected a dedicated TEST_DATABASE_URL');
  }

  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    const { rows: [target] } = await client.query('SELECT current_database() AS name');
    if (target.name !== 'safeops_test') {
      throw new Error('Unexpected target database');
    }
  } finally {
    await client.end();
  }

  const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  process.exitCode = migration.status ?? 1;
}

try {
  await migrateTestDatabase();
} catch {
  console.error('Could not verify the PostgreSQL target. TEST_DATABASE_URL must connect to safeops_test.');
  process.exitCode = 1;
}
