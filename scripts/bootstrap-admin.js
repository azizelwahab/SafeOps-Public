import { env } from '../src/config/env.js';
import { disconnectDatabase } from '../src/config/database.js';
import { bootstrapAdmin } from '../src/services/authService.js';
import { bootstrapSchema } from '../src/validators/authValidator.js';

async function run() {
  const url = new URL(env.databaseUrl ?? '');
  if (env.nodeEnv !== 'development' || !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' || url.pathname !== '/safeops_dev' || url.search || url.hash) {
    throw new Error('Unsupported bootstrap database.');
  }
  const port = Number(url.port || '5432');
  if (process.env.BOOTSTRAP_DATABASE_TARGET !== `127.0.0.1:${port}/safeops_dev`) {
    throw new Error('Database target not confirmed.');
  }

  const input = bootstrapSchema.safeParse({
    organizationName: process.env.BOOTSTRAP_ORGANIZATION_NAME,
    organizationSlug: process.env.BOOTSTRAP_ORGANIZATION_SLUG,
    name: process.env.BOOTSTRAP_ADMIN_NAME,
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  });
  if (!input.success) {
    const fields = [...new Set(input.error.issues.map((issue) => issue.path.join('.')))];
    console.error('Bootstrap validation failed for: ' + fields.join(', ') + '. See the README for input requirements.');
    process.exitCode = 1;
    return;
  }

  await bootstrapAdmin(input.data, async (db) => {
    const [target] = await db.$queryRaw`SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port`;
    if (target.name !== 'safeops_dev' || target.host !== '127.0.0.1' || target.port !== port) {
      throw new Error('Unexpected database target.');
    }
  });
  console.info('Created the organization and its approved administrator.');
}

try {
  await run();
} catch (error) {
  console.error(error.code === 'P2002'
    ? 'Bootstrap refused: the organization slug or administrator email already exists.'
    : 'Bootstrap failed. Verify the local development target, migrations, and administrator configuration.');
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
