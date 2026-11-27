import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { disconnectDatabase, getDatabase } from '../src/config/database.js';
import { createOrganization as insertOrganization, findOrganizationById } from '../src/models/organizationModel.js';
import { createUser as insertUser, findUserById } from '../src/models/userModel.js';
import { createAuditLog as insertAuditLog } from '../src/models/auditLogModel.js';

const runId = randomUUID();
let db;
let organization;
let otherOrganization;
let actor;
const actorEmail = `actor-${runId}@example.test`;
const fixture = { name: 'Fixture user', passwordHash: 'non-secret-test-fixture' };
const organizationIds = [];
const userIds = [];
const auditIds = [];

function trackFixtures(insert, ids) {
  return async (...args) => {
    const row = await insert(...args);
    ids.push(row.id);
    return row;
  };
}

const createOrganization = trackFixtures(insertOrganization, organizationIds);
const createUser = trackFixtures(insertUser, userIds);
const createAuditLog = trackFixtures(insertAuditLog, auditIds);

async function verifyTestTarget(client) {
  const [target] = await client.$queryRaw`SELECT current_database() AS name`;
  if (target.name !== 'safeops_test') {
    throw new Error('The connected database is not the dedicated test database.');
  }
}

const integrationOptions = { skip: env.databaseUrl ? false : 'TEST_DATABASE_URL is unset' };

describe('PostgreSQL foundation', () => {
  before(async () => {
    if (!env.databaseUrl) return;
    const url = new URL(env.databaseUrl);
    if (env.nodeEnv !== 'test' || url.pathname !== '/safeops_test') {
      throw new Error('Integration tests require a dedicated database named safeops_test.');
    }

    db = getDatabase();
    await verifyTestTarget(db);

    organization = await createOrganization({ name: 'Integration organization', slug: `integration-${runId}` });
    otherOrganization = await createOrganization({ name: 'Other organization', slug: `other-${runId}` });
    actor = await createUser(organization.id, { ...fixture, email: actorEmail });
  });

  after(async () => {
    if (!db) return;
    try {
      if (organizationIds.length || userIds.length || auditIds.length) {
        await db.$transaction(async (transaction) => {
          await verifyTestTarget(transaction);
          await transaction.auditLog.deleteMany({ where: { id: { in: auditIds } } });
          // Clear self-references only on this run's users before deleting those users.
          const users = { id: { in: userIds } };
          await transaction.user.updateMany({ where: users, data: { approvedById: null } });
          await transaction.user.deleteMany({ where: users });
          await transaction.organization.deleteMany({ where: { id: { in: organizationIds } } });
        });
      }
    } finally {
      await disconnectDatabase();
    }
  });

  test('runs the readiness probe against migrated PostgreSQL', integrationOptions, async () => {
    await request(app).get('/api/v1/ready').expect(200);
  });

  test('creates organizations with UUIDs and unique slugs', integrationOptions, async () => {
    assert.match(organization.id, /^[a-f0-9-]{36}$/);
    assert.deepEqual(await findOrganizationById(organization.id), organization);
    await assert.rejects(createOrganization({ name: 'Duplicate', slug: organization.slug }), { code: 'P2002' });
  });

  test('creates users with normalized email, safe fields, and default role and status', integrationOptions, async () => {
    const email = `employee-${runId}@example.test`;
    const user = await createUser(organization.id, {
      ...fixture,
      email: `  ${email.toUpperCase()}  `,
      role: 'ADMIN',
      status: 'APPROVED',
    });

    assert.partialDeepStrictEqual(user, { email, organizationId: organization.id, role: 'EMPLOYEE', status: 'PENDING' });
    assert.equal('passwordHash' in user, false);
    const found = await findUserById(organization.id, user.id);
    assert.deepEqual(found, user);
    assert.equal('passwordHash' in found, false);
  });

  test('rejects duplicate email across organizations after normalization', integrationOptions, async () => {
    await assert.rejects(createUser(otherOrganization.id, { ...fixture, email: actorEmail.toUpperCase() }), { code: 'P2002' });
  });

  test('requires a valid organization and filters reads by organization and soft deletion', integrationOptions, async () => {
    assert.equal(await findUserById(otherOrganization.id, actor.id), null);
    const deleted = await createUser(organization.id, { ...fixture, email: `deleted-${runId}@example.test` });
    await db.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    assert.equal(await findUserById(organization.id, deleted.id), null);

    await assert.rejects(createUser(randomUUID(), { ...fixture, email: `orphan-${runId}@example.test` }), { code: 'P2003' });
  });

  test('allows same-organization approval and rejects a cross-organization approver', integrationOptions, async () => {
    const user = await createUser(organization.id, { ...fixture, email: `approval-${runId}@example.test` });
    const outsider = await createUser(otherOrganization.id, { ...fixture, email: `outsider-${runId}@example.test` });

    const approved = await db.user.update({ where: { id: user.id }, data: { approvedById: actor.id } });
    assert.equal(approved.approvedById, actor.id);
    await assert.rejects(db.user.update({ where: { id: user.id }, data: { approvedById: outsider.id } }), { code: 'P2003' });
  });

  test('creates and preserves audit records with safe metadata and same-organization actors', integrationOptions, async () => {
    const audit = await createAuditLog(organization.id, {
      actorId: actor.id,
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: actor.id,
      metadata: { automated: true, changedFieldCount: 2, token: 'fixture', nested: { password: 'fixture' } },
    });
    assert.partialDeepStrictEqual(audit, {
      organizationId: organization.id,
      actorId: actor.id,
      entityId: actor.id,
    });
    assert.deepEqual(audit.metadata, { automated: true, changedFieldCount: 2 });
    const systemEvent = await createAuditLog(organization.id, { action: 'SYSTEM_EVENT', entityType: 'Organization' });
    assert.partialDeepStrictEqual(systemEvent, { actorId: null, metadata: null });
    await assert.rejects(createAuditLog(otherOrganization.id, {
      actorId: actor.id, action: 'USER_CREATED', entityType: 'User',
    }), { code: 'P2003' });
    await assert.rejects(db.user.delete({ where: { id: actor.id } }), { code: 'P2003' });
    await assert.rejects(db.organization.delete({ where: { id: organization.id } }), { code: 'P2003' });
  });
});
