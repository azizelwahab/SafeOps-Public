import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { after, before, describe, test } from 'node:test';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { authConfig } from '../src/config/auth.js';
import { getDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { bootstrapAdmin } from '../src/services/authService.js';
import { changeName, changeRole, rejectAccount, suspendAccount } from '../src/services/userService.js';
import { signAccessToken } from '../src/utils/token.js';

const runId = randomUUID();
const slug = `auth-${runId}`;
const secondSlug = `second-${runId}`;
const password = ` ${randomBytes(16).toString('hex')} `;
const email = (prefix) => `${prefix}@${runId}.example.test`;
const options = { skip: env.databaseUrl ? false : 'TEST_DATABASE_URL is unset' };
const api = () => request(createApp());
const withToken = (req, token) => req.set('Authorization', `Bearer ${token}`);
const signup = (prefix, overrides = {}) => ({
  name: 'New Employee', organizationSlug: slug, email: email(prefix), password, ...overrides,
});

let db;
let admin;
let employee;
let outsider;
let passwordHash;
const organizationIds = [];
const statuses = {
  pending: 'PENDING', rejected: 'REJECTED', suspended: 'SUSPENDED', deleted: 'APPROVED',
};
const genericLoginError = {
  success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
};

async function verifyTestDatabase(client) {
  const [target] = await client.$queryRaw`SELECT current_database() AS name`;
  assert.equal(target.name, 'safeops_test');
}

async function fixtureUser(prefix, fields = {}) {
  return db.user.create({
    data: {
      organizationId: admin.organizationId, status: 'APPROVED', name: prefix,
      email: email(prefix), passwordHash, ...fields,
    },
  });
}

function assertSafe(body) {
  assert.doesNotMatch(JSON.stringify(body), /passwordHash|JWT_SECRET|Authorization/);
  assert.equal(JSON.stringify(body).includes(password), false);
}

describe('Phase 3 authentication and user management', () => {
  before(async () => {
    if (!env.databaseUrl) return;
    assert.equal(env.nodeEnv, 'test');
    assert.equal(new URL(env.databaseUrl).pathname, '/safeops_test');
    db = getDatabase();
    await verifyTestDatabase(db);

    for (const [prefix, organizationSlug] of [['admin', slug], ['outside', secondSlug]]) {
      const identity = await bootstrapAdmin({
        organizationSlug, organizationName: prefix, name: prefix, email: email(prefix), password,
      }, verifyTestDatabase);
      organizationIds.push(identity.organizationId);
      const user = await db.user.findUniqueOrThrow({ where: { id: identity.administratorId } });
      if (prefix === 'admin') admin = user;
      else outsider = user;
    }

    passwordHash = await bcrypt.hash(password, authConfig.bcryptRounds);
    employee = await fixtureUser('employee');
    for (const [prefix, status] of Object.entries(statuses)) {
      await fixtureUser(prefix, { status, deletedAt: prefix === 'deleted' ? new Date() : null });
    }
  });

  after(async () => {
    if (!db) return;
    try {
      if (!organizationIds.length) return;
      await db.$transaction(async (tx) => {
        await verifyTestDatabase(tx);
        const owned = { organizationId: { in: organizationIds } };
        const users = { ...owned, email: { endsWith: `@${runId}.example.test` } };
        await tx.auditLog.deleteMany({ where: owned });
        await tx.user.updateMany({ where: users, data: { approvedById: null } });
        await tx.user.deleteMany({ where: users });
        await tx.organization.deleteMany({ where: { id: { in: organizationIds } } });
      });
    } finally {
      await disconnectDatabase();
    }
  });

  test('bootstraps an approved administrator atomically and refuses an existing organization or user', options, async () => {
    assert.equal(admin.role, 'ADMIN');
    assert.equal(admin.status, 'APPROVED');
    assert.ok(admin.approvedAt);
    const actions = await db.auditLog.findMany({ where: { organizationId: admin.organizationId } });
    assert.deepEqual(new Set(actions.map(({ action }) => action)), new Set(['ORGANIZATION_BOOTSTRAPPED', 'ADMIN_CREATED']));
    assert.ok(actions.every(({ actorId, metadata }) => actorId === admin.id && metadata === null));
    const input = { name: 'Admin', email: email('admin'), password, organizationName: 'Duplicate' };
    await assert.rejects(bootstrapAdmin({ ...input, organizationSlug: slug }, verifyTestDatabase), { code: 'P2002' });
    const unusedSlug = `rollback-${runId}`;
    await assert.rejects(bootstrapAdmin({ ...input, organizationSlug: unusedSlug }, verifyTestDatabase), { code: 'P2002' });
    assert.equal(await db.organization.findUnique({ where: { slug: unusedSlug } }), null);

    const run = spawnSync(process.execPath, ['scripts/bootstrap-admin.js'], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Bootstrap failed/);
    assertSafe(run.stderr);
  });

  test('registers normalized pending employees with a bcrypt hash and one audit event under concurrent signup', options, async () => {
    const service = api();
    const input = signup('registered', {
      email: ` ${email('registered').toUpperCase()} `,
      organizationSlug: ` ${slug.toUpperCase()} `,
    });
    const [first, duplicate] = await Promise.all([
      service.post('/api/v1/auth/signup').send(input).expect(202),
      service.post('/api/v1/auth/signup').send(input).expect(202),
    ]);
    assert.deepEqual(first.body, duplicate.body);
    assertSafe(first.body);
    assert.deepEqual(Object.keys(first.body.data), ['message']);

    const user = await db.user.findUniqueOrThrow({
      where: { email: email('registered') }, omit: { passwordHash: false },
    });
    assert.equal(user.role, 'EMPLOYEE');
    assert.equal(user.status, 'PENDING');
    assert.equal(user.organizationId, admin.organizationId);
    assert.notEqual(user.passwordHash, password);
    assert.equal(await bcrypt.compare(password, user.passwordHash), true);
    const events = await db.auditLog.findMany({
      where: { organizationId: admin.organizationId, entityId: user.id },
    });
    assert.equal(events.length, 1);
    assert.partialDeepStrictEqual(events[0], { action: 'EMPLOYEE_REGISTERED', actorId: null, metadata: null });

    const crossOrgDuplicate = await service.post('/api/v1/auth/signup')
      .send({ ...input, organizationSlug: secondSlug }).expect(202);
    assert.deepEqual(first.body, crossOrgDuplicate.body);
  });

  for (const [label, fields] of [
    ['invalid email', { email: 'invalid' }],
    ['short password', { password: 'short' }],
    ['password exceeding 72 UTF-8 bytes', { password: '🙂'.repeat(19) }],
    ['administrator role injection', { role: 'ADMIN' }],
    ['account status injection', { status: 'APPROVED' }],
    ['organization and approver injection', { organizationId: randomUUID(), approvedById: randomUUID() }],
  ]) {
    test(`signup rejects ${label}`, options, async () => {
      const result = await api().post('/api/v1/auth/signup').send(signup('invalid', fields)).expect(400);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
      assertSafe(result.body);
      assert.equal(await db.user.count({ where: { email: email('invalid') } }), 0);
    });
  }

  test('signup rejects a missing organization', options, async () => {
    const result = await api().post('/api/v1/auth/signup')
      .send(signup('missing', { organizationSlug: `unknown-${runId}` })).expect(404);
    assert.equal(result.body.error.code, 'ORGANIZATION_NOT_FOUND');
  });

  test('approved login returns a short-lived HS256 token and safe profile, and audits the login', options, async () => {
    const service = api();
    const result = await service.post('/api/v1/auth/login')
      .send({ email: ` ${email('employee').toUpperCase()} `, password }).expect(200);
    const { accessToken, tokenType, expiresIn, user } = result.body.data;
    assert.equal(tokenType, 'Bearer');
    assert.equal(expiresIn, 900);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(user.id, employee.id);
    assert.equal(user.organization.slug, slug);
    assertSafe(result.body);
    const decoded = jwt.decode(accessToken, { complete: true });
    assert.equal(decoded.header.alg, 'HS256');
    assert.deepEqual(Object.keys(decoded.payload).sort(), ['aud', 'authVersion', 'exp', 'iat', 'iss', 'organizationId', 'sub']);
    assert.equal(decoded.payload.exp - decoded.payload.iat, expiresIn);
    assert.partialDeepStrictEqual(decoded.payload, {
      sub: employee.id, organizationId: admin.organizationId, iss: authConfig.issuer, aud: authConfig.audience,
    });
    const profile = await withToken(service.get('/api/v1/auth/me'), accessToken).expect(200);
    assert.deepEqual(profile.body.data, user);
    const event = await db.auditLog.findFirstOrThrow({
      where: { organizationId: admin.organizationId, actorId: employee.id, action: 'LOGIN_SUCCEEDED' },
    });
    assert.equal(event.metadata, null);
    assert.equal(JSON.stringify(event).includes(accessToken), false);
  });

  for (const prefix of ['incorrect', 'unknown', ...Object.keys(statuses)]) {
    test(`login responds generically for ${prefix} credentials or account`, options, async () => {
      const result = await api().post('/api/v1/auth/login').send({
        email: email(prefix === 'incorrect' ? 'employee' : prefix),
        password: prefix === 'incorrect' ? password.trim() : password,
      }).expect(401);
      assert.deepEqual(result.body, genericLoginError);
    });
  }

  for (const [label, makeToken] of [
    ['missing token', () => null],
    ['malformed token', () => 'junk'],
    ['expired token', () => makeSigned({ expiresIn: -5 })],
    ['invalid signature', () => makeSigned({}, randomBytes(32))],
    ['invalid issuer', () => makeSigned({ issuer: 'unknown' })],
    ['invalid audience', () => makeSigned({ audience: 'unknown' })],
    ['unsupported algorithm', () => makeSigned({ algorithm: 'HS384' })],
    ['wrong organization claim', () => signAccessToken({ ...employee, organizationId: outsider.organizationId })],
    ['invalid claim type', () => makeSigned({ subject: 'not-a-uuid' })],
    ['future issued-at claim', () => jwt.sign({
      organizationId: employee.organizationId, authVersion: employee.authVersion, iat: Math.floor(Date.now() / 1000) + 3600,
    }, authConfig.secret, {
      algorithm: 'HS256', subject: employee.id, issuer: authConfig.issuer,
      audience: authConfig.audience, expiresIn: 900,
    })],
  ]) {
    test(`protected profile rejects ${label}`, options, async () => {
      const token = makeToken();
      const route = api().get('/api/v1/auth/me');
      const result = await (token ? withToken(route, token) : route).expect(401);
      assert.equal(result.body.error.code, 'UNAUTHENTICATED');
      if (token) assert.equal(JSON.stringify(result.body).includes(token), false);
    });
  }

  function makeSigned(overrides = {}, secret = authConfig.secret) {
    return jwt.sign({ organizationId: employee.organizationId, authVersion: employee.authVersion }, secret, {
      algorithm: 'HS256', subject: employee.id, issuer: authConfig.issuer,
      audience: authConfig.audience, expiresIn: 900, ...overrides,
    });
  }

  test('authorization uses current roles, denies ineligible tokens, and allows own profile', options, async () => {
    const service = api();
    const user = await fixtureUser('role-change', { role: 'ADMIN' });
    const token = signAccessToken(user);
    const path = `/api/v1/users/${user.id}`;
    const own = await withToken(service.get(path), token).expect(200);
    assert.equal(own.body.data.id, user.id);
    await withToken(service.get('/api/v1/users'), token).expect(200);
    await db.user.update({ where: { id: user.id }, data: { role: 'EMPLOYEE' } });
    await withToken(service.get('/api/v1/users'), token).expect(403);
    await withToken(service.delete(`/api/v1/users/${employee.id}`), token).expect(403);
    await withToken(service.patch(`/api/v1/users/${employee.id}/approve`), token).expect(403);
    await db.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    await withToken(service.get('/api/v1/auth/me'), token).expect(401);
  });

  test('administrator list enforces tenant, status, bounded pagination, and safe data', options, async () => {
    const service = api();
    const token = signAccessToken(admin);
    const result = await withToken(service.get('/api/v1/users?status=APPROVED&limit=2&page=1'), token).expect(200);
    const { users, page, limit } = result.body.data;
    assert.deepEqual([page, limit, users.length], [1, 2, 2]);
    assert.ok(users.every((user) => user.organizationId === admin.organizationId && user.status === 'APPROVED' && !user.deletedAt));
    assert.ok(!users.some((user) => user.id === outsider.id || user.email === email('deleted')));
    assertSafe(result.body);
    await withToken(service.get('/api/v1/users?limit=101'), token).expect(400);
    await withToken(service.get('/api/v1/users?status=UNKNOWN'), token).expect(400);
    await withToken(service.get(`/api/v1/users?organizationId=${outsider.organizationId}`), token).expect(400);
    const defaults = await withToken(service.get('/api/v1/users'), token).expect(200);
    assert.deepEqual([defaults.body.data.page, defaults.body.data.limit], [1, 20]);
  });

  test('cross-organization detail, modification, deletion and approval return 404', options, async () => {
    const service = api();
    const path = `/api/v1/users/${outsider.id}`;
    for (const user of [admin, employee]) {
      const token = signAccessToken(user);
      await withToken(service.get(path), token).expect(404);
      await withToken(service.patch(path), token).send({ name: 'Cross-tenant' }).expect(404);
    }
    const token = signAccessToken(admin);
    await withToken(service.delete(path), token).expect(404);
    await withToken(service.patch(path + '/approve'), token).expect(404);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: outsider.id } })).name, outsider.name);
  });

  test('name updates are authorized and audited, while protected fields and invalid IDs are rejected', options, async () => {
    const service = api();
    const token = signAccessToken(employee);
    const path = `/api/v1/users/${employee.id}`;
    for (const [key, value] of Object.entries({
      email: email('new'), password, role: 'ADMIN', organizationId: admin.organizationId, status: 'APPROVED',
    })) {
      await withToken(service.patch(path), token).send({ name: 'New', [key]: value }).expect(400);
    }
    await withToken(service.patch('/api/v1/users/bad-id'), token).send({ name: 'New' }).expect(400);
    await withToken(service.patch(`/api/v1/users/${admin.id}`), token).send({ name: 'New' }).expect(403);
    const self = await withToken(service.patch(path), token).send({ name: 'My new name' }).expect(200);
    assert.equal(self.body.data.name, 'My new name');
    const adminEdit = await withToken(service.patch(path), signAccessToken(admin)).send({ name: 'Admin edit' }).expect(200);
    assert.equal(adminEdit.body.data.name, 'Admin edit');
    const events = await db.auditLog.findMany({ where: { entityId: employee.id, action: 'USER_PROFILE_UPDATED' } });
    assert.deepEqual(new Set(events.map(({ actorId }) => actorId)), new Set([employee.id, admin.id]));
  });

  test('only one concurrent approval succeeds and subsequent or self-approval returns 409', options, async () => {
    const user = await fixtureUser('approval', { status: 'PENDING', role: 'SAFETY_OFFICER' });
    const service = api();
    const token = signAccessToken(admin);
    const path = `/api/v1/users/${user.id}/approve`;
    const results = await Promise.all([1, 2].map(() => withToken(service.patch(path), token)));
    assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
    const approved = results.find(({ status }) => status === 200).body.data;
    assert.partialDeepStrictEqual(approved, { status: 'APPROVED', role: 'SAFETY_OFFICER', approvedById: admin.id });
    assert.ok(approved.approvedAt);
    await withToken(service.patch(path), token).expect(409);
    await withToken(service.patch(`/api/v1/users/${admin.id}/approve`), token).expect(409);
    assert.equal(await db.auditLog.count({ where: { entityId: user.id, action: 'ACCOUNT_APPROVED' } }), 1);
  });

  test('soft deletion invalidates tokens and preserves history, while administrator targets are protected', options, async () => {
    const service = api();
    const token = signAccessToken(admin);
    const user = await fixtureUser('soft-delete');
    const anotherAdmin = await fixtureUser('another-admin', { role: 'ADMIN' });
    await withToken(service.delete(`/api/v1/users/${admin.id}`), token).expect(403);
    await withToken(service.delete(`/api/v1/users/${anotherAdmin.id}`), token).expect(403);
    const path = `/api/v1/users/${user.id}`;
    const userToken = signAccessToken(user);
    await withToken(service.get('/api/v1/auth/me'), userToken).expect(200);
    await withToken(service.delete(path), token).expect(200);
    await withToken(service.get(path), token).expect(404);
    await withToken(service.get('/api/v1/auth/me'), userToken).expect(401);
    assert.ok((await db.user.findUniqueOrThrow({ where: { id: user.id } })).deletedAt);
    assert.equal(await db.auditLog.count({ where: { entityId: user.id, action: 'USER_SOFT_DELETED' } }), 1);
  });

  test('a failed audit foreign key rolls back the associated profile update', options, async () => {
    const user = await fixtureUser('audit-rollback');
    const vanishedActor = { id: randomUUID(), organizationId: admin.organizationId, role: 'ADMIN' };
    await assert.rejects(changeName(vanishedActor, user.id, 'Should roll back'), { code: 'P2003' });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).name, user.name);
    assert.equal(await db.auditLog.count({ where: { entityId: user.id, action: 'USER_PROFILE_UPDATED' } }), 0);
  });

  test('a newly registered employee completes the approval-to-deletion workflow', options, async () => {
    const service = api();
    const input = signup('full-workflow');
    const credentials = { email: input.email, password };
    await service.post('/api/v1/auth/signup').send(input).expect(202);
    await service.post('/api/v1/auth/login').send(credentials).expect(401);

    const adminLogin = await service.post('/api/v1/auth/login')
      .send({ email: admin.email, password }).expect(200);
    const adminToken = adminLogin.body.data.accessToken;
    const pending = await withToken(service.get('/api/v1/users?status=PENDING'), adminToken)
      .expect('Cache-Control', 'no-store').expect(200);
    const record = pending.body.data.users.find((user) => user.email === input.email);
    assert.ok(record);
    const path = `/api/v1/users/${record.id}`;
    await withToken(service.patch(path + '/approve'), adminToken).expect(200);

    const session = await service.post('/api/v1/auth/login').send(credentials).expect(200);
    const token = session.body.data.accessToken;
    const profile = await withToken(service.get('/api/v1/auth/me'), token)
      .expect('Cache-Control', 'no-store').expect(200);
    assert.equal(profile.body.data.id, record.id);
    const detail = await withToken(service.get(path), token).expect('Cache-Control', 'no-store').expect(200);
    assert.deepEqual(detail.body, profile.body);
    const updated = await withToken(service.patch(path), token).send({ name: 'Updated Employee' }).expect(200);
    assert.equal(updated.body.data.name, 'Updated Employee');
    assertSafe(updated.body);

    await withToken(service.delete(path), adminToken).expect(200);
    await withToken(service.get(path), adminToken).expect(404);
    await withToken(service.get('/api/v1/auth/me'), token).expect(401);
    await service.post('/api/v1/auth/login').send(credentials).expect(401);
    const events = await db.auditLog.findMany({ where: { organizationId: admin.organizationId, entityId: record.id } });
    assert.deepEqual(events.map(({ action }) => action).sort(), [
      'ACCOUNT_APPROVED', 'EMPLOYEE_REGISTERED', 'LOGIN_SUCCEEDED', 'USER_PROFILE_UPDATED', 'USER_SOFT_DELETED',
    ]);
    assert.ok(events.every(({ metadata }) => metadata === null));
  });

  test('only one concurrent rejection wins and denied attempts leave no audit events', options, async () => {
    const pending = await fixtureUser('rejection', { status: 'PENDING' });
    const service = api();
    const path = `/api/v1/users/${pending.id}/reject`;
    const token = signAccessToken(admin);
    await service.patch(path).expect(401);
    await withToken(service.patch(path), signAccessToken(employee)).expect(403);
    await withToken(service.patch(path), signAccessToken(outsider)).expect(404);
    await withToken(service.patch(path), token).send({ status: 'APPROVED' }).expect(400);
    const responses = await Promise.all([1, 2].map(() => withToken(service.patch(path), token)));
    assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 409]);
    const rejected = responses.find(({ status }) => status === 200).body.data;
    assert.partialDeepStrictEqual(rejected, { id: pending.id, status: 'REJECTED', role: 'EMPLOYEE', approvedAt: null, approvedById: null });
    assertSafe(rejected);
    const events = await db.auditLog.findMany({ where: { entityId: pending.id } });
    assert.equal(events.length, 1);
    assert.partialDeepStrictEqual(events[0], { organizationId: admin.organizationId, actorId: admin.id, action: 'ACCOUNT_REJECTED' });
  });

  test('rejection cannot modify approved, suspended, deleted or administrator accounts', options, async () => {
    const service = api();
    const token = signAccessToken(admin);
    for (const [prefix, fields, expected] of [
      ['approved', { status: 'APPROVED' }, 409],
      ['suspended', { status: 'SUSPENDED' }, 409],
      ['deleted', { status: 'PENDING', deletedAt: new Date() }, 404],
      ['administrator', { status: 'PENDING', role: 'ADMIN' }, 409],
    ]) {
      const user = await fixtureUser(`reject-${prefix}`, fields);
      await withToken(service.patch(`/api/v1/users/${user.id}/reject`), token).expect(expected);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).status, user.status);
      assert.equal(await db.auditLog.count({ where: { entityId: user.id } }), 0);
    }
  });

  test('rejection rolls back if its audit write fails', options, async () => {
    const pending = await fixtureUser('reject-rollback', { status: 'PENDING' });
    await assert.rejects(rejectAccount({ ...admin, id: randomUUID() }, pending.id), { code: 'P2003' });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: pending.id } })).status, 'PENDING');
  });

  test('suspension denies access and restoration preserves approval without reviving old tokens', options, async () => {
    const approvedAt = new Date('2020-01-01T00:00:00.000Z');
    const user = await fixtureUser('suspend-restore', { approvedAt, approvedById: admin.id });
    const service = api();
    const adminToken = signAccessToken(admin);
    const oldToken = signAccessToken(user);
    const path = `/api/v1/users/${user.id}`;
    await withToken(service.get('/api/v1/auth/me'), oldToken).expect(200);
    const results = await Promise.all([1, 2].map(() => withToken(service.patch(path + '/suspend'), adminToken)));
    assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
    await withToken(service.get('/api/v1/auth/me'), oldToken).expect(401);
    await service.post('/api/v1/auth/login').send({ email: user.email, password }).expect(401);
    const restored = await withToken(service.patch(path + '/restore'), adminToken).expect(200);
    assert.partialDeepStrictEqual(restored.body.data, { status: 'APPROVED', approvedAt: approvedAt.toISOString(), approvedById: admin.id });
    assert.equal('authVersion' in restored.body.data, false);
    await withToken(service.patch(path + '/restore'), adminToken).expect(409);
    await withToken(service.get('/api/v1/auth/me'), oldToken).expect(401);
    const login = await service.post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
    await withToken(service.get('/api/v1/auth/me'), login.body.data.accessToken).expect(200);

    const legacy = jwt.sign({ organizationId: user.organizationId }, authConfig.secret, {
      algorithm: 'HS256', subject: user.id, issuer: authConfig.issuer, audience: authConfig.audience, expiresIn: 900,
    });
    await withToken(service.get('/api/v1/auth/me'), legacy).expect(401);
    const events = await db.auditLog.findMany({ where: { organizationId: admin.organizationId, entityId: user.id } });
    assert.deepEqual(events.map(({ action }) => action).sort(), ['ACCOUNT_RESTORED', 'ACCOUNT_SUSPENDED', 'LOGIN_SUCCEEDED']);
  });

  test('lifecycle and role endpoints enforce permissions, tenant scope, and target eligibility', options, async () => {
    const officer = await fixtureUser('denied-officer', { role: 'SAFETY_OFFICER' });
    const service = api();
    const path = `/api/v1/users/${employee.id}`;
    const adminToken = signAccessToken(admin);
    for (const action of ['suspend', 'restore', 'role']) {
      for (const caller of [employee, officer, outsider]) {
        await withToken(service.patch(`${path}/${action}`), signAccessToken(caller))
          .send(action === 'role' ? { role: 'SAFETY_OFFICER' } : {}).expect(caller === outsider ? 404 : 403);
      }
    }
    const secondAdmin = await fixtureUser('protected-admin', { role: 'ADMIN' });
    for (const protectedId of [admin.id, secondAdmin.id]) {
      await withToken(service.patch(`/api/v1/users/${protectedId}/suspend`), adminToken).expect(409);
      await withToken(service.patch(`/api/v1/users/${protectedId}/role`), adminToken).send({ role: 'EMPLOYEE' }).expect(409);
    }
    for (const status of ['PENDING', 'REJECTED']) {
      const target = await fixtureUser(`ineligible-${status.toLowerCase()}`, { status });
      const path = `/api/v1/users/${target.id}`;
      await withToken(service.patch(path + '/suspend'), adminToken).expect(409);
      await withToken(service.patch(path + '/restore'), adminToken).expect(409);
      await withToken(service.patch(path + '/role'), adminToken).send({ role: 'SAFETY_OFFICER' }).expect(409);
    }
    const deleted = await fixtureUser('deleted-suspended', { status: 'SUSPENDED', deletedAt: new Date() });
    await withToken(service.patch(`/api/v1/users/${deleted.id}/restore`), adminToken).expect(404);
    await withToken(service.patch(path + '/role'), adminToken).send({ role: 'ADMIN' }).expect(400);
    await withToken(service.patch(path + '/role'), adminToken).send({ role: 'SAFETY_OFFICER', organizationId: outsider.organizationId }).expect(400);
  });

  test('approved users can be promoted and demoted with accurate audit metadata', options, async () => {
    const user = await fixtureUser('role-roundtrip', { name: 'Crane_Operator' });
    const service = api();
    const token = signAccessToken(admin);
    const path = `/api/v1/users/${user.id}/role`;
    const promoted = await withToken(service.patch(path), token).send({ role: 'SAFETY_OFFICER' }).expect(200);
    assert.equal(promoted.body.data.role, 'SAFETY_OFFICER');
    assertSafe(promoted.body);
    await withToken(service.patch(path), token).send({ role: 'SAFETY_OFFICER' }).expect(409);
    const list = await withToken(service.get('/api/v1/users?search=crane_&status=APPROVED&role=SAFETY_OFFICER'), token).expect(200);
    assert.deepEqual(list.body.data.users.map(({ id }) => id), [user.id]);
    const byEmail = await withToken(service.get('/api/v1/users?search=ROLE-ROUNDTRIP'), token).expect(200);
    assert.deepEqual(byEmail.body.data.users.map(({ id }) => id), [user.id]);
    const wildcard = await withToken(service.get('/api/v1/users?search=%25'), token).expect(200);
    assert.deepEqual(wildcard.body.data.users, []);
    await withToken(service.get('/api/v1/users?role=UNKNOWN'), token).expect(400);
    await withToken(service.get('/api/v1/users?search='), token).expect(400);
    const demoted = await withToken(service.patch(path), token).send({ role: 'EMPLOYEE' }).expect(200);
    assert.equal(demoted.body.data.role, 'EMPLOYEE');
    const events = await db.auditLog.findMany({ where: { entityId: user.id } });
    assert.equal(events.length, 2);
    assert.ok(events.every(({ action, actorId }) => action === 'USER_ROLE_CHANGED' && actorId === admin.id));
    assert.deepEqual(events.map(({ metadata }) => metadata.newRole).sort(), ['EMPLOYEE', 'SAFETY_OFFICER']);
    assert.ok(events.every(({ metadata }) => metadata.previousRole !== metadata.newRole));
  });

  test('opposing account transitions and concurrent suspension and role changes preserve eligibility', options, async () => {
    const pending = await fixtureUser('opposing-transitions', { status: 'PENDING' });
    const user = await fixtureUser('suspend-role-race');
    const service = api();
    const token = signAccessToken(admin);
    const results = await Promise.all(['approve', 'reject'].map((action) =>
      withToken(service.patch(`/api/v1/users/${pending.id}/${action}`), token)));
    assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(await db.auditLog.count({ where: { entityId: pending.id } }), 1);
    const path = `/api/v1/users/${user.id}`;
    const [suspend, role] = await Promise.all([
      withToken(service.patch(path + '/suspend'), token),
      withToken(service.patch(path + '/role'), token).send({ role: 'SAFETY_OFFICER' }),
    ]);
    assert.equal(suspend.status, 200);
    assert.ok([200, 409].includes(role.status));
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(after.status, 'SUSPENDED');
    assert.equal(after.role, role.status === 200 ? 'SAFETY_OFFICER' : 'EMPLOYEE');
    await withToken(service.patch(path + '/role'), token).send({ role: 'EMPLOYEE' }).expect(409);
    assert.equal(await db.auditLog.count({ where: { entityId: user.id, action: 'USER_ROLE_CHANGED' } }), role.status === 200 ? 1 : 0);
  });

  test('a failing audit write rolls back a suspension, token version, and role change', options, async () => {
    const user = await fixtureUser('lifecycle-rollback');
    const missingActor = { ...admin, id: randomUUID() };
    await assert.rejects(suspendAccount(missingActor, user.id), { code: 'P2003' });
    await assert.rejects(changeRole(missingActor, user.id, 'SAFETY_OFFICER'), { code: 'P2003' });
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.partialDeepStrictEqual(after, { status: 'APPROVED', authVersion: user.authVersion, role: 'EMPLOYEE' });
    assert.equal(await db.auditLog.count({ where: { entityId: user.id } }), 0);
  });

  test('audit retrieval is scoped, read-only, validated and strips unsafe stored metadata', options, async () => {
    const officer = await fixtureUser('audit-officer', { role: 'SAFETY_OFFICER' });
    const event = {
      organizationId: admin.organizationId, actorId: admin.id, action: 'USER_ROLE_CHANGED', entityType: 'User',
      createdAt: new Date('2020-01-02T00:00:00.000Z'),
      metadata: { previousRole: 'EMPLOYEE', newRole: 'SAFETY_OFFICER', token: 'fixture-secret', nested: { secret: 'fixture' } },
    };
    const tied = await Promise.all([db.auditLog.create({ data: event }), db.auditLog.create({ data: event })]);
    await db.auditLog.create({ data: { ...event, createdAt: new Date('2020-01-01T00:00:00Z') } });
    const foreign = await db.auditLog.create({ data: { ...event, organizationId: outsider.organizationId, actorId: outsider.id } });
    const service = api();
    const token = signAccessToken(admin);
    const path = '/api/v1/audit-logs';
    const detailPath = `${path}/${tied[0].id}`;
    await service.get(path).expect(401);
    for (const caller of [employee, officer]) {
      await withToken(service.get(path), signAccessToken(caller)).expect(403);
      await withToken(service.get(detailPath), signAccessToken(caller)).expect(403);
    }
    await withToken(service.get(`${path}/${foreign.id}`), token).expect(404);
    await withToken(service.get(`${path}/${randomUUID()}`), token).expect(404);
    await withToken(service.delete(detailPath), token).expect(404);
    const detail = await withToken(service.get(detailPath), token).expect('Cache-Control', 'no-store').expect(200);
    assert.deepEqual(detail.body.data.metadata, { previousRole: 'EMPLOYEE', newRole: 'SAFETY_OFFICER' });
    assert.equal(JSON.stringify(detail.body).includes('fixture-secret'), false);
    const query = `action=USER_ROLE_CHANGED&entityType=User&actorId=${admin.id}&from=2020-01-02T00:00:00Z&to=2020-01-02T00:00:00Z&limit=1`;
    const ids = [];
    for (const page of [1, 2, 3]) {
      const list = await withToken(service.get(`${path}?${query}&page=${page}`), token).expect('Cache-Control', 'no-store').expect(200);
      assert.ok(list.body.data.auditLogs.every(({ organizationId }) => organizationId === admin.organizationId));
      assert.equal(JSON.stringify(list.body).includes('fixture-secret'), false);
      ids.push(...list.body.data.auditLogs.map(({ id }) => id));
    }
    assert.deepEqual(ids, tied.map(({ id }) => id).sort().reverse());
    for (const query of ['limit=101', 'actorId=invalid', 'action=%21', 'from=2020-01-02', 'from=2020-01-03T00:00:00Z&to=2020-01-02T00:00:00Z', 'organizationId=foreign']) {
      await withToken(service.get(`${path}?${query}`), token).expect(400);
    }
  });
});
