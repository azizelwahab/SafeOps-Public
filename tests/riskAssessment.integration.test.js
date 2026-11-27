import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import request from 'supertest';
import app from '../src/app.js';
import { disconnectDatabase, getDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { signAccessToken } from '../src/utils/token.js';

const base = '/api/v1/risk-assessments';
const runId = randomUUID();
const options = { skip: env.databaseUrl ? false : 'TEST_DATABASE_URL is unset' };
const organizations = [];
let db;
let employee;
let coworker;
let officer;
let admin;
let outsider;

async function verifyTarget(client) {
  const [target] = await client.$queryRaw`SELECT current_database() AS name`;
  assert.equal(target.name, 'safeops_test');
}

function authorized(method, path, user) {
  return request(app)[method](path).set('Authorization', `Bearer ${signAccessToken(user)}`);
}

function hazard(reporter = employee, status = 'CONFIRMED') {
  return db.hazard.create({ data: {
    organizationId: reporter.organizationId, reportedById: reporter.id, status, category: 'PHYSICAL',
    title: 'Uneven walkway', description: 'A raised edge crosses the walkway.', location: 'Loading bay',
  } });
}

async function assess(target, actor = officer, likelihood = 2, severity = 3) {
  const { body } = await authorized('post', base, actor).send({ hazardId: target.id, likelihood, severity }).expect(201);
  return body.data;
}

function account(organizationId, role, label) {
  return db.user.create({ data: {
    organizationId, role, name: label, status: 'APPROVED',
    email: `${label}@${runId}.example.test`, passwordHash: 'unused-in-risk-tests',
  } });
}

describe('Risk assessment management', () => {
  before(async () => {
    if (!env.databaseUrl) return;
    assert.equal(env.nodeEnv, 'test');
    assert.equal(new URL(env.databaseUrl).pathname, '/safeops_test');
    db = getDatabase();
    await verifyTarget(db);
    for (const label of ['local', 'foreign']) {
      const org = await db.organization.create({ data: { name: label, slug: `risk-${label}-${runId}` } });
      organizations.push(org.id);
    }
    employee = await account(organizations[0], 'EMPLOYEE', 'employee');
    coworker = await account(organizations[0], 'EMPLOYEE', 'coworker');
    officer = await account(organizations[0], 'SAFETY_OFFICER', 'officer');
    admin = await account(organizations[0], 'ADMIN', 'admin');
    outsider = await account(organizations[1], 'ADMIN', 'outsider');
  });

  after(async () => {
    try {
      if (!organizations.length) return;
      await db.$transaction(async (tx) => {
        await verifyTarget(tx);
        const scope = { organizationId: { in: organizations } };
        await tx.auditLog.deleteMany({ where: scope });
        await tx.riskAssessmentRevision.deleteMany({ where: scope });
        await tx.riskAssessment.deleteMany({ where: scope });
        await tx.hazard.deleteMany({ where: scope });
        await tx.user.deleteMany({ where: { ...scope, email: { endsWith: `@${runId}.example.test` } } });
        await tx.organization.deleteMany({ where: { id: { in: organizations } } });
        assert.equal(await tx.riskAssessment.count({ where: scope }), 0);
        assert.equal(await tx.riskAssessmentRevision.count({ where: scope }), 0);
      });
    } finally {
      if (db) await disconnectDatabase();
    }
  });

  test('calculates all four levels server-side and returns only safe fields', options, async () => {
    for (const [likelihood, severity, score, level] of [
      [1, 4, 4, 'LOW'], [1, 5, 5, 'MEDIUM'], [3, 3, 9, 'MEDIUM'],
      [2, 5, 10, 'HIGH'], [4, 4, 16, 'HIGH'], [4, 5, 20, 'CRITICAL'], [5, 5, 25, 'CRITICAL'],
    ]) {
      const target = await hazard();
      const assessment = await assess(target, officer, likelihood, severity);
      assert.partialDeepStrictEqual(assessment, {
        organizationId: employee.organizationId, hazardId: target.id, version: 1,
        assessedById: officer.id, likelihood, severity, score, level,
      });
      assert.deepEqual(Object.keys(assessment).sort(), [
        'assessedAt', 'assessedById', 'createdAt', 'hazardId', 'id', 'level', 'likelihood',
        'organizationId', 'score', 'severity', 'updatedAt', 'version',
      ]);
      assert.equal(new Date(assessment.assessedAt).toISOString(), assessment.assessedAt);
      const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: assessment.id } });
      assert.partialDeepStrictEqual(audit, {
        action: 'RISK_ASSESSMENT_CREATED', entityType: 'RiskAssessment', actorId: officer.id, metadata: null,
      });
    }
  });

  test('requires confirmed hazards and permits only one concurrent creation per hazard', options, async () => {
    for (const state of ['REPORTED', 'UNDER_REVIEW', 'DISMISSED']) {
      const target = await hazard(employee, state);
      const { body } = await authorized('post', base, admin).send({ hazardId: target.id, likelihood: 2, severity: 2 }).expect(409);
      assert.equal(body.error.code, 'HAZARD_NOT_CONFIRMED');
    }
    const target = await hazard();
    const responses = await Promise.all([officer, admin].map((actor) =>
      authorized('post', base, actor).send({ hazardId: target.id, likelihood: 2, severity: 2 })));
    assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
    const created = responses.find(({ status }) => status === 201).body.data;
    assert.equal(await db.riskAssessmentRevision.count({ where: { assessmentId: created.id } }), 1);
    assert.equal(await db.auditLog.count({ where: { entityId: created.id } }), 1);
  });

  test('enforces authentication, role permissions, hazard ownership and organization isolation on all IDs', options, async () => {
    const mine = await hazard(employee);
    const theirs = await hazard(coworker);
    const foreign = await hazard(outsider);
    const ownAssessment = await assess(mine);
    const otherAssessment = await assess(theirs, admin);
    const foreignAssessment = await assess(foreign, outsider);
    const ownPath = `${base}/${ownAssessment.id}`;
    await request(app).get(base).expect(401);
    await authorized('post', base, employee).send({ hazardId: mine.id, likelihood: 2, severity: 2 }).expect(403);
    await authorized('patch', ownPath, employee).send({ version: 1, likelihood: 4 }).expect(403);
    await authorized('get', ownPath, employee).expect('Cache-Control', 'no-store').expect(200);
    await authorized('get', ownPath + '/history', employee).expect(200);
    for (const entry of [otherAssessment, foreignAssessment]) {
      await authorized('get', `${base}/${entry.id}`, employee).expect(404);
      await authorized('get', `${base}/${entry.id}/history`, employee).expect(404);
      await authorized('get', `${base}?hazardId=${entry.hazardId}`, employee).expect(404);
    }
    for (const actor of [officer, admin]) {
      await authorized('get', `${base}/${otherAssessment.id}`, actor).expect(200);
      await authorized('get', `${base}/${foreignAssessment.id}`, actor).expect(404);
      await authorized('get', `${base}/${foreignAssessment.id}/history`, actor).expect(404);
      await authorized('get', `${base}?hazardId=${foreign.id}`, actor).expect(404);
      await authorized('patch', `${base}/${foreignAssessment.id}`, actor).send({ version: 1, severity: 5 }).expect(404);
      await authorized('post', base, actor).send({ hazardId: foreign.id, likelihood: 2, severity: 2 }).expect(404);
    }
    const list = await authorized('get', base, employee).expect(200);
    assert.ok(list.body.data.assessments.some(({ id }) => id === ownAssessment.id));
    assert.ok(list.body.data.assessments.every(({ id }) => id !== otherAssessment.id && id !== foreignAssessment.id));
    const filtered = await authorized('get', `${base}?hazardId=${mine.id}`, employee).expect(200);
    assert.deepEqual(filtered.body.data.assessments.map(({ id }) => id), [ownAssessment.id]);
  });

  test('rejects invalid ratings, unsafe fields, invalid IDs and pagination', options, async () => {
    const target = await hazard();
    const input = { hazardId: target.id, likelihood: 2, severity: 3 };
    for (const invalid of [
      { likelihood: '2' }, { severity: 0 }, { likelihood: 6 }, { severity: 1.5 }, { score: 5 },
      { organizationId: outsider.organizationId }, { assessedById: employee.id }, { level: 'LOW' }, { hazardId: 'invalid' },
    ]) await authorized('post', base, officer).send({ ...input, ...invalid }).expect(400);
    const assessment = await assess(target);
    const path = `${base}/${assessment.id}`;
    for (const body of [
      { likelihood: 2 }, { version: 1 }, { version: 0, likelihood: 1 },
      { version: 1, likelihood: 2, hazardId: target.id }, { version: 1, severity: 6 },
    ]) await authorized('patch', path, officer).send(body).expect(400);
    await authorized('get', base + '/invalid', officer).expect(400);
    await authorized('get', base + '?limit=101', officer).expect(400);
    await authorized('get', base + '?organizationId=' + officer.organizationId, officer).expect(400);
    await authorized('get', path + '/history?page=0', officer).expect(400);
  });

  test('preserves prior ratings, assessor identities and paginated revision history', options, async () => {
    const target = await hazard();
    const original = await assess(target);
    const path = `${base}/${original.id}`;
    const { body: changed } = await authorized('patch', path, admin).send({ version: 1, severity: 5 }).expect(200);
    assert.partialDeepStrictEqual(changed.data, {
      version: 2, likelihood: 2, severity: 5, score: 10, level: 'HIGH', assessedById: admin.id, createdAt: original.createdAt,
    });
    const { body: detail } = await authorized('get', path, employee).expect(200);
    assert.deepEqual(detail.data, changed.data);
    for (const [page, expected] of [[1, changed.data], [2, original]]) {
      const { body: history } = await authorized('get', `${path}/history?page=${page}&limit=1`, employee).expect(200);
      assert.equal(history.data.revisions.length, 1);
      const [{ version, assessedById, score, createdAt }] = history.data.revisions;
      assert.deepEqual([version, assessedById, score, createdAt],
        [expected.version, expected.assessedById, expected.score, expected.assessedAt]);
    }
    const event = await db.auditLog.findFirstOrThrow({ where: { entityId: original.id, action: 'RISK_ASSESSMENT_UPDATED' } });
    assert.equal(event.actorId, admin.id);
    assert.equal(event.metadata, null);
  });

  test('one concurrent update wins and stale versions cannot create another revision', options, async () => {
    const assessment = await assess(await hazard());
    const path = `${base}/${assessment.id}`;
    const result = await Promise.all([
      authorized('patch', path, officer).send({ version: 1, likelihood: 4 }),
      authorized('patch', path, admin).send({ version: 1, severity: 5 }),
    ]);
    assert.deepEqual(result.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(result.find(({ status }) => status === 409).body.error.code, 'STALE_RISK_ASSESSMENT');
    await authorized('patch', path, officer).send({ version: 1, likelihood: 1 }).expect(409);
    assert.equal(await db.riskAssessmentRevision.count({ where: { assessmentId: assessment.id } }), 2);
    assert.equal(await db.auditLog.count({ where: { entityId: assessment.id, action: 'RISK_ASSESSMENT_UPDATED' } }), 1);
  });

  test('list uses bounded pagination and descending IDs when timestamps tie', options, async () => {
    const pair = [await assess(await hazard()), await assess(await hazard())];
    const ids = pair.map(({ id }) => id).sort().reverse();
    await db.riskAssessment.updateMany({
      where: { organizationId: officer.organizationId, id: { in: ids } },
      data: { createdAt: new Date('2099-01-01T00:00:00Z') },
    });
    for (const [index, expected] of ids.entries()) {
      const { body } = await authorized('get', `${base}?limit=1&page=${index + 1}`, officer).expect(200);
      assert.deepEqual(body.data.assessments.map(({ id }) => id), [expected]);
    }
  });

  test('database restrictions reject cross-organization hazard and assessor references and invalid ratings', options, async () => {
    const foreign = await hazard(outsider);
    const target = await hazard();
    const assessment = await assess(target);
    await assert.rejects(db.riskAssessment.create({
      data: { organizationId: officer.organizationId, hazardId: foreign.id },
    }), { code: 'P2003' });
    const revision = {
      organizationId: officer.organizationId, assessmentId: assessment.id, version: 2,
      assessedById: officer.id, likelihood: 2, severity: 3, score: 6, level: 'MEDIUM',
    };
    await assert.rejects(db.riskAssessmentRevision.create({
      data: { ...revision, assessedById: outsider.id },
    }), { code: 'P2003' });
    await assert.rejects(db.riskAssessmentRevision.create({
      data: { ...revision, score: 7 },
    }), /RiskAssessmentRevision_rating_check/);
    await assert.rejects(db.hazard.delete({ where: { id: target.id } }), { code: 'P2003' });
  });

  test('a real audit failure rolls back initial creation and a version advance', options, async () => {
    const target = await hazard();
    const existing = await assess(await hazard());
    const original = db.$transaction;
    const failures = [];
    db.$transaction = (operation) => original.call(db, (tx) => operation({
      hazard: tx.hazard, riskAssessment: tx.riskAssessment, riskAssessmentRevision: tx.riskAssessmentRevision,
      $queryRaw: tx.$queryRaw.bind(tx),
      auditLog: { create: async ({ data }) => {
        try {
          return await tx.auditLog.create({ data: { ...data, actorId: outsider.id } });
        } catch (error) {
          failures.push(error.code);
          throw error;
        }
      } },
    }));
    try {
      await authorized('post', base, officer).send({ hazardId: target.id, likelihood: 2, severity: 2 }).expect(500);
      await authorized('patch', `${base}/${existing.id}`, officer).send({ version: 1, likelihood: 4 }).expect(500);
    } finally {
      db.$transaction = original;
    }
    assert.deepEqual(failures, ['P2003', 'P2003']);
    assert.equal(await db.riskAssessment.count({ where: { hazardId: target.id } }), 0);
    assert.equal((await db.riskAssessment.findUniqueOrThrow({ where: { id: existing.id } })).version, 1);
    assert.equal(await db.riskAssessmentRevision.count({ where: { assessmentId: existing.id } }), 1);
    assert.equal(await db.auditLog.count({ where: { entityId: existing.id } }), 1);
  });
});
