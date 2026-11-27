import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

let database;

export function getDatabase() {
  if (!env.databaseUrl) {
    throw new Error('A database URL is required');
  }

  // Lazily share one Prisma client and connection pool per process.
  database ??= new PrismaClient({
    adapter: new PrismaPg({
      connectionString: env.databaseUrl,
      connectionTimeoutMillis: 1500,
      statement_timeout: 3000,
      query_timeout: 4500,
    }),
    omit: { user: { passwordHash: true } },
  });

  return database;
}

export async function disconnectDatabase() {
  await database?.$disconnect();
}
