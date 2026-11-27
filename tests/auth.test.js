import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { authConfig } from '../src/config/auth.js';
import { hasPermission, Permission } from '../src/config/permissions.js';
import { env } from '../src/config/env.js';
import { signAccessToken } from '../src/utils/token.js';
import { isValidPassword } from '../src/utils/password.js';

test('permission policies deny unknown roles, unknown permissions and out-of-scope resources', () => {
  const admin = { id: randomUUID(), organizationId: randomUUID(), role: 'ADMIN' };
  const owner = { ...admin, role: 'SAFETY_OFFICER' };
  const self = { id: owner.id, organizationId: owner.organizationId };
  assert.equal(hasPermission(admin, 'user:unknown'), false);
  assert.equal(hasPermission(null, Permission.USER_LIST), false);
  assert.equal(hasPermission({ ...owner, role: 'UNKNOWN' }, Permission.USER_READ, self), false);
  assert.equal(hasPermission(admin, Permission.USER_UPDATE), false);
  assert.equal(hasPermission(admin, Permission.USER_READ, { ...self, organizationId: randomUUID() }), false);
  assert.equal(hasPermission(owner, Permission.USER_READ, self), true);
  assert.equal(hasPermission(owner, Permission.USER_UPDATE, { ...self, id: randomUUID() }), false);
  assert.equal(hasPermission(owner, Permission.USER_REJECT), false);
});

for (const [route, limit] of [['signup', authConfig.signupLimit], ['login', authConfig.loginLimit]]) {
  test(`${route} rate limit uses the connected IP and is isolated per app`, async () => {
    const app = createApp();
    const path = `/api/v1/auth/${route}`;
    for (let index = 0; index < limit; index++) {
      await request(app).post(path).set('X-Forwarded-For', `198.51.100.${index + 1}`).send({}).expect(400);
    }
    const response = await request(app).post(path).set('X-Forwarded-For', '203.0.113.1').send({}).expect(429);
    assert.deepEqual(response.body, {
      success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
    });
    assert.ok(Number(response.headers['retry-after']) > 0);
    await request(createApp()).post(path).send({}).expect(400);
  });
}

test('password validation rejects oversized login passwords and hides submitted values', async () => {
  const password = '🙂'.repeat(19);
  const response = await request(createApp()).post('/api/v1/auth/login')
    .send({ email: 'user@example.test', password }).expect(400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(JSON.stringify(response.body).includes(password), false);
});

test('password validation accepts exactly 72 UTF-8 bytes and rejects unpaired surrogates', () => {
  assert.equal(isValidPassword('🙂'.repeat(18)), true);
  assert.equal(isValidPassword('🙂'.repeat(18) + 'a'), false);
  assert.equal(isValidPassword('a'.repeat(12) + '\ud800'), false);
});

test('production access logs omit client-provided URLs and credential headers', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8',
    input: `
      import request from 'supertest';
      import app from './src/app.js';
      await request(app).get('/api/v1/users/${randomUUID()}?token=query-credential-marker')
        .set('Referer', 'https://example.test/?token=referrer-credential-marker')
        .set('Authorization', 'Bearer header-credential-marker')
        .expect(401);
      await request(app).get('/unmatched-path-credential-marker').expect(404);
    `,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GET \/:id 401/);
  assert.match(result.stdout, /GET \[unmatched\] 404/);
  assert.doesNotMatch(result.stdout + result.stderr, /credential-marker/);
});

test('authentication infrastructure failures are sanitized HTTP 500 responses', async () => {
  const token = signAccessToken({ id: randomUUID(), organizationId: randomUUID(), authVersion: 0 });
  const databaseUrl = env.databaseUrl;
  try {
    env.databaseUrl = undefined;
    const result = await request(createApp()).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`).expect(500);
    assert.deepEqual(result.body, {
      success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
  } finally {
    env.databaseUrl = databaseUrl;
  }
});

for (const [name, value] of [
  ['JWT_SECRET', 'invalid-secret-value'],
  ['JWT_EXPIRES_IN', '2h'],
  ['JWT_ISSUER', ''],
  ['JWT_AUDIENCE', ''],
  ['BCRYPT_ROUNDS', '4'],
  ['AUTH_RATE_WINDOW_MS', '0'],
  ['AUTH_SIGNUP_LIMIT', '-1'],
  ['AUTH_LOGIN_LIMIT', 'not-a-number'],
]) {
  test(`rejects invalid ${name} configuration`, () => {
    const result = spawnSync(process.execPath, ['src/config/auth.js'], {
      env: { ...process.env, NODE_ENV: 'production', [name]: value }, encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(name));
    if (name === 'JWT_SECRET') assert.equal(result.stderr.includes(value), false);
  });
}
