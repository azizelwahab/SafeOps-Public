import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { assertProductionDatabaseConfig } from '../src/config/env.js';

test('production requires PostgreSQL certificate and hostname verification', () => {
  const base = 'postgresql://runtime@database.example.test/safeops';
  const config = (databaseUrl) => ({ nodeEnv: 'production', databaseUrl });
  assert.doesNotThrow(() => assertProductionDatabaseConfig(config(base + '?sslmode=verify-full'), '1'));
  assert.doesNotThrow(() => assertProductionDatabaseConfig({ nodeEnv: 'development' }, '1'));
  for (const value of [undefined, 'invalid', base, base + '?sslmode=require', base + '?sslmode=verify-full&sslmode=no-verify',
    base + '?sslmode=verify-full&host=other.example.test', base + '?sslmode=verify-full&ssl=0']) {
    assert.throws(() => assertProductionDatabaseConfig(config(value), '1'), /DATABASE_URL.*verify-full/);
  }
  assert.throws(() => assertProductionDatabaseConfig(config(base + '?sslmode=verify-full'), '0'), /TLS verification enabled/);
});

test('the production entry point rejects an insecure URL before listening and does not print it', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgresql://runtime@credential-marker.example.test/safeops' },
    encoding: 'utf8',
    timeout: 3000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Production DATABASE_URL.*verify-full/);
  assert.doesNotMatch(result.stdout + result.stderr, /credential-marker|SafeOps listening/);
});

test('readiness returns 200 after the PostgreSQL probe succeeds', async (t) => {
  const probeDatabase = t.mock.fn(async () => [{ '?column?': 1 }]);
  const app = createApp({ probeDatabase });
  const { body } = await request(app).get('/api/v1/ready').expect(200);
  assert.deepEqual(body, { success: true, data: { status: 'ready' } });
  assert.equal(probeDatabase.mock.callCount(), 1);
});

test('readiness returns a sanitized JSON error when PostgreSQL fails', async () => {
  const app = createApp({
    probeDatabase: async () => { throw new Error('Sensitive connection details'); },
  });
  const { body } = await request(app)
    .get('/api/v1/ready')
    .expect('Content-Type', /application\/json/)
    .expect(503);

  assert.deepEqual(body, {
    success: false,
    error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable.' },
  });
});

test('liveness stays available when the database probe would fail', async (t) => {
  const probeDatabase = t.mock.fn(async () => { throw new Error('Database offline'); });
  const app = createApp({ probeDatabase });
  await request(app).get('/api/v1/health').expect(200);
  assert.equal(probeDatabase.mock.callCount(), 0);
});

test('readiness returns 503 even if the database probe never settles', async () => {
  const probe = Promise.withResolvers();
  const app = createApp({ probeDatabase: () => probe.promise });
  try {
    await request(app).get('/api/v1/ready').timeout({ response: 3500 }).expect(503);
  } finally {
    probe.resolve();
  }
});
