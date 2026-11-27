import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import request from 'supertest';
import app from '../src/app.js';
import { disconnectDatabase, getDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { signAccessToken } from '../src/utils/token.js';

const base = '/api/v1/hazards';
const runId = randomUUID();
const options = { skip: env.databaseUrl ? false : 'TEST_DATABASE_URL is unset' };
const payload = { title: 'Damaged work light', description: 'The protective light cover is loose.', category: 'ELECTRICAL', location: 'Loading bay' };
const notes = { reviewNotes: 'The inspection verified the loose protective cover.' };

let db;
const organizations = [];
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

async function report(user, fields = {}) {
  const { body } = await authorized('post', base, user).send({ ...payload, ...fields }).expect(201);
  return body.data;
}

async function account(organizationId, role, label) {
  return db.user.create({ data: {
    organizationId, role, name: label, status: 'APPROVED',
    email: `${label}@${runId}.example.test`, passwordHash: 'unused-in-hazard-tests',
  } });
}

describe('Hazard management', () => {
  before(async () => {
    if (!env.databaseUrl) return;
    assert.equal(env.nodeEnv, 'test');
    assert.equal(new URL(env.databaseUrl).pathname, '/safeops_test');
    db = getDatabase();
    await verifyTarget(db);
    for (const suffix of ['local', 'other']) {
      const organization = await db.organization.create({
        data: { name: suffix, slug: `hazard-${suffix}-${runId}` },
      });
      organizations.push(organization.id);
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
        await tx.hazard.deleteMany({ where: scope });
        await tx.user.deleteMany({ where: { ...scope, email: { endsWith: `@${runId}.example.test` } } });
        await tx.organization.deleteMany({ where: { id: { in: organizations } } });
        assert.equal(await tx.hazard.count({ where: scope }), 0);
      });
    } finally {
      if (db) await disconnectDatabase();
    }
  });

  test('requires authentication and denies an existing token for a suspended account', options, async () => {
    await request(app).post(base).send(payload).expect(401);
    await request(app).get(base).expect('Cache-Control', 'no-store').expect(401);
    await request(app).patch(`${base}/${randomUUID()}/review`).expect(401);
    const suspended = await account(organizations[0], 'EMPLOYEE', 'suspended');
    await db.user.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } });
    await authorized('post', base, suspended).send(payload).expect(401);
  });

  test('all roles can report a hazard and receive only safe fields with a transactional audit event', options, async () => {
    for (const user of [employee, officer, admin]) {
      const response = await authorized('post', base, user).send({ ...payload, title: '  Damaged work light  ' })
        .expect('Cache-Control', 'no-store').expect(201);
      const hazard = response.body.data;
      assert.deepEqual(Object.keys(hazard).sort(), [
        'category', 'createdAt', 'description', 'id', 'location', 'organizationId', 'reportedById',
        'reviewNotes', 'reviewedAt', 'reviewedById', 'status', 'title', 'updatedAt',
      ]);
      assert.partialDeepStrictEqual(hazard, {
        ...payload, organizationId: user.organizationId, reportedById: user.id, status: 'REPORTED',
        reviewedById: null, reviewNotes: null, reviewedAt: null,
      });
      const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: hazard.id } });
      assert.partialDeepStrictEqual(audit, {
        actorId: user.id, organizationId: user.organizationId, entityType: 'Hazard', action: 'HAZARD_REPORTED', metadata: null,
      });
    }
  });

  test('rejects invalid input, protected fields, malformed IDs and invalid filters', options, async () => {
    for (const invalid of [
      { title: ' ' }, { description: 'x'.repeat(4001) }, { category: 'INVALID' }, { location: 'x'.repeat(201) },
      { status: 'CONFIRMED' }, { organizationId: outsider.organizationId }, { reportedById: coworker.id },
      { reviewedById: officer.id }, { reviewNotes: notes.reviewNotes },
    ]) {
      await authorized('post', base, employee).send({ ...payload, ...invalid }).expect(400);
    }
    const hazard = await report(employee);
    await authorized('patch', `${base}/${hazard.id}`, employee).send({}).expect(400);
    await authorized('patch', `${base}/${hazard.id}`, employee).send({ title: 'Changed', status: 'DISMISSED' }).expect(400);
    await authorized('patch', `${base}/${hazard.id}/review`, officer).send({ reviewedById: admin.id }).expect(400);
    await authorized('get', `${base}/invalid`, employee).expect(400);
    for (const query of ['page=0', 'limit=101', 'status=INVALID', 'category=INVALID', 'search=', 'organizationId=1', 'from=2020-02-02T00:00:00Z&to=2020-02-01T00:00:00Z']) {
      await authorized('get', `${base}?${query}`, employee).expect(400);
    }
  });

  test('applies employee ownership, investigator visibility, and organization isolation', options, async () => {
    const own = await report(employee, { title: 'Scope marker - employee' });
    const other = await report(coworker, { title: 'Scope marker - coworker' });
    const foreign = await report(outsider, { title: 'Scope marker - outsider' });
    const path = `${base}/${other.id}`;
    const listPath = `${base}?search=Scope%20marker`;
    const mine = await authorized('get', listPath, employee).expect(200);
    assert.deepEqual(mine.body.data.hazards.map(({ id }) => id), [own.id]);
    await authorized('get', `${base}/${own.id}`, employee).expect(200);
    await authorized('get', path, employee).expect(404);
    await authorized('patch', path, employee).send({ title: 'Forbidden' }).expect(404);
    await authorized('patch', `${base}/${own.id}/review`, employee).expect(403);
    await authorized('patch', `${base}/${own.id}/confirm`, employee).send(notes).expect(403);
    await authorized('patch', `${base}/${own.id}/dismiss`, employee).send(notes).expect(403);
    for (const reviewer of [officer, admin]) {
      const result = await authorized('get', listPath, reviewer).expect(200);
      assert.deepEqual(new Set(result.body.data.hazards.map(({ id }) => id)), new Set([own.id, other.id]));
      await authorized('get', path, reviewer).expect(200);
      await authorized('patch', path, reviewer).send({ title: 'Forbidden' }).expect(404);
      await authorized('get', `${base}/${foreign.id}`, reviewer).expect(404);
      for (const suffix of ['review', 'confirm', 'dismiss']) {
        const transition = authorized('patch', `${base}/${foreign.id}/${suffix}`, reviewer);
        if (suffix !== 'review') transition.send(notes);
        await transition.expect(404);
      }
    }
    await authorized('get', `${base}/${randomUUID()}`, admin).expect(404);
  });

  test('filters title, description, location, status, category and dates with deterministic pagination', options, async () => {
    const fields = { title: 'Filter marker', category: 'FIRE', location: 'Section_A' };
    const first = await report(employee, fields);
    const second = await report(employee, { ...fields, title: 'Different title', description: 'Filter marker in the description' });
    const excluded = await report(employee, { ...fields, location: 'SectionXA' });
    const wrongStatus = await report(employee, fields);
    await authorized('patch', `${base}/${wrongStatus.id}/review`, officer).expect(200);
    const date = new Date('2020-01-01T00:00:00.000Z');
    await db.hazard.updateMany({ where: { id: { in: [first.id, second.id, excluded.id, wrongStatus.id] } }, data: { createdAt: date } });
    const query = 'search=FILTER%20MARKER&location=section_&category=FIRE&status=REPORTED&from=2020-01-01T00:00:00Z&to=2020-01-01T00:00:00Z&limit=1';
    const ids = [];
    for (const page of [1, 2, 3]) {
      const { body } = await authorized('get', `${base}?${query}&page=${page}`, officer).expect(200);
      assert.deepEqual([body.data.page, body.data.limit], [page, 1]);
      ids.push(...body.data.hazards.map(({ id }) => id));
    }
    assert.deepEqual(ids, [first.id, second.id].sort().reverse());
  });

  test('edits are audited and review blocks later edits, with notes required for a final decision', options, async () => {
    const hazard = await report(officer);
    const path = `${base}/${hazard.id}`;
    const edit = await authorized('patch', path, officer).send({ title: 'Updated lamp', category: 'PHYSICAL' }).expect(200);
    assert.partialDeepStrictEqual(edit.body.data, { title: 'Updated lamp', category: 'PHYSICAL', status: 'REPORTED' });
    await authorized('patch', path + '/confirm', admin).send(notes).expect(409);
    const review = await authorized('patch', path + '/review', officer).expect(200);
    assert.partialDeepStrictEqual(review.body.data, { reviewedById: officer.id, reviewedAt: null, status: 'UNDER_REVIEW' });
    await authorized('patch', path, officer).send({ title: 'Too late' }).expect(409);
    await authorized('patch', path + '/review', admin).expect(409);
    for (const body of [{}, { reviewNotes: 'Too short' }, { reviewNotes: '!!!!!!!!!!!!' }, { ...notes, reviewedById: officer.id }]) {
      await authorized('patch', path + '/confirm', admin).send(body).expect(400);
    }
    const confirmed = await authorized('patch', path + '/confirm', admin).send(notes).expect(200);
    assert.partialDeepStrictEqual(confirmed.body.data, { ...notes, status: 'CONFIRMED', reviewedById: admin.id });
    assert.equal(new Date(confirmed.body.data.reviewedAt).toISOString(), confirmed.body.data.reviewedAt);
    await authorized('patch', path + '/dismiss', officer).send(notes).expect(409);
    await authorized('delete', path, admin).expect(404);
    const events = await db.auditLog.findMany({ where: { entityId: hazard.id } });
    assert.deepEqual(events.map(({ action }) => action).sort(), [
      'HAZARD_CONFIRMED', 'HAZARD_REPORTED', 'HAZARD_REVIEW_STARTED', 'HAZARD_UPDATED',
    ]);
    assert.ok(events.every(({ metadata }) => metadata === null));
    const dismissed = await report(employee);
    await authorized('patch', `${base}/${dismissed.id}/review`, admin).expect(200);
    const result = await authorized('patch', `${base}/${dismissed.id}/dismiss`, officer).send(notes).expect(200);
    assert.partialDeepStrictEqual(result.body.data, { ...notes, status: 'DISMISSED', reviewedById: officer.id });
    assert.ok(result.body.data.reviewedAt);
  });

  test('concurrent confirmation and dismissal produce only one final decision and audit event', options, async () => {
    const hazard = await report(employee);
    const path = `${base}/${hazard.id}`;
    await authorized('patch', path + '/review', officer).expect(200);
    const decisions = await Promise.all([
      authorized('patch', path + '/confirm', admin).send(notes),
      authorized('patch', path + '/dismiss', officer).send(notes),
    ]);
    assert.deepEqual(decisions.map(({ status }) => status).sort(), [200, 409]);
    const [confirmed] = decisions;
    const final = await db.hazard.findUniqueOrThrow({ where: { id: hazard.id } });
    assert.equal(final.status, confirmed.status === 200 ? 'CONFIRMED' : 'DISMISSED');
    assert.equal(final.reviewedById, confirmed.status === 200 ? admin.id : officer.id);
    assert.equal(await db.auditLog.count({ where: { entityId: hazard.id, action: { in: ['HAZARD_CONFIRMED', 'HAZARD_DISMISSED'] } } }), 1);
  });

  test('an edit racing the start of review can succeed only before review starts', options, async () => {
    const hazard = await report(employee);
    const path = `${base}/${hazard.id}`;
    const [edit, review] = await Promise.all([
      authorized('patch', path, employee).send({ title: 'Edited before review' }),
      authorized('patch', path + '/review', officer),
    ]);
    assert.equal(review.status, 200);
    assert.ok([200, 409].includes(edit.status));
    assert.equal(review.body.data.title, edit.status === 200 ? 'Edited before review' : hazard.title);
    await authorized('patch', path, employee).send({ title: 'After review' }).expect(409);
    assert.equal(await db.auditLog.count({ where: { entityId: hazard.id, action: 'HAZARD_UPDATED' } }), edit.status === 200 ? 1 : 0);
  });

  test('audit foreign-key failures roll back hazard creation and investigation', options, async () => {
    const hazard = await report(employee);
    const runTransaction = db.$transaction;
    const auditErrors = [];
    // Use a real transaction, replacing only the audit actor with one PostgreSQL must reject.
    db.$transaction = (operation) => runTransaction.call(db, (tx) => operation({
      hazard: tx.hazard,
      auditLog: { create: async ({ data }) => {
        try {
          return await tx.auditLog.create({ data: { ...data, actorId: outsider.id } });
        } catch (error) {
          auditErrors.push(error.code);
          throw error;
        }
      } },
    }));
    try {
      const response = await authorized('post', base, employee).send({ ...payload, title: 'Audit rollback marker' }).expect(500);
      assert.equal(response.body.error.code, 'INTERNAL_ERROR');
      await authorized('patch', `${base}/${hazard.id}/review`, officer).expect(500);
    } finally {
      db.$transaction = runTransaction;
    }
    assert.deepEqual(auditErrors, ['P2003', 'P2003']);
    assert.equal(await db.hazard.count({ where: { organizationId: employee.organizationId, title: 'Audit rollback marker' } }), 0);
    const unchanged = await db.hazard.findUniqueOrThrow({ where: { id: hazard.id } });
    assert.partialDeepStrictEqual(unchanged, { status: 'REPORTED', reviewedById: null, reviewedAt: null });
    assert.equal(await db.auditLog.count({ where: { entityId: hazard.id } }), 1);
  });

  test('database foreign keys reject cross-organization reporters and reviewers and restrict historical deletions', options, async () => {
    const hazard = await report(employee);
    await assert.rejects(db.hazard.create({
      data: { ...payload, organizationId: employee.organizationId, reportedById: outsider.id },
    }), { code: 'P2003' });
    await assert.rejects(db.hazard.update({
      where: { id: hazard.id }, data: { reviewedById: outsider.id },
    }), { code: 'P2003' });
    await assert.rejects(db.user.delete({ where: { id: employee.id } }), { code: 'P2003' });
    await assert.rejects(db.organization.delete({ where: { id: employee.organizationId } }), { code: 'P2003' });
    assert.equal((await db.hazard.findUniqueOrThrow({ where: { id: hazard.id } })).reportedById, employee.id);
  });
});
