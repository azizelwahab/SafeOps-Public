import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import request from 'supertest';
import app from '../src/app.js';
import { disconnectDatabase, getDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { signAccessToken } from '../src/utils/token.js';

const base = '/api/v1/corrective-actions';
const runId = randomUUID();
const options = { skip: env.databaseUrl ? false : 'TEST_DATABASE_URL is unset' };
const organizations = [];
const completionDetails = 'The replacement guard was fitted and the work area was checked.';
const reason = 'Please confirm the replacement is secured at all mounting points.';
let db;
let employee;
let reporter;
let unrelated;
let officer;
let admin;
let outsider;
let localHazard;
let foreignHazard;

async function verifyTarget(client) {
  const [target] = await client.$queryRaw`SELECT current_database() AS name`;
  assert.equal(target.name, 'safeops_test');
}

function authorized(method, path, user) {
  return request(app)[method](path).set('Authorization', `Bearer ${signAccessToken(user)}`);
}

function account(organizationId, role, label, fields = {}) {
  return db.user.create({ data: {
    organizationId, role, name: label, status: 'APPROVED',
    email: `${label}@${runId}.example.test`, passwordHash: 'unused-in-action-tests', ...fields,
  } });
}

async function hazard(actor, status = 'CONFIRMED', assessed = true) {
  const result = await db.hazard.create({ data: {
    organizationId: actor.organizationId, reportedById: actor.id, status, category: 'MECHANICAL',
    title: 'Hazard details outside the action', description: 'Private hazard description.', location: 'Workshop',
  } });
  if (assessed) {
    const assessment = await db.riskAssessment.create({ data: {
      organizationId: actor.organizationId, hazardId: result.id,
    } });
    await db.riskAssessmentRevision.create({ data: {
      organizationId: actor.organizationId, assessmentId: assessment.id, version: 1, assessedById: actor.id,
      likelihood: 2, severity: 5, score: 10, level: 'HIGH',
    } });
  }
  return result;
}

function payload(overrides = {}) {
  return { hazardId: localHazard.id, assigneeId: employee.id, title: 'Replace machine guard',
    description: 'Fit a new guard using the approved work plan.', dueAt: '2099-01-01T00:00:00Z', ...overrides };
}

async function create(overrides = {}, actor = officer) {
  const { body } = await authorized('post', base, actor).send(payload(overrides)).expect(201);
  return body.data;
}

function transition(action, operation, user, body = {}) {
  return authorized('patch', `${base}/${action.id}/${operation}`, user).send({ version: action.version, ...body });
}

async function advance(action, operation, user, body) {
  const response = await transition(action, operation, user, body).expect(200);
  return response.body.data;
}

describe('Corrective action management', () => {
  before(async () => {
    if (!env.databaseUrl) return;
    assert.equal(env.nodeEnv, 'test');
    assert.equal(new URL(env.databaseUrl).pathname, '/safeops_test');
    db = getDatabase();
    await verifyTarget(db);
    for (const label of ['local', 'foreign']) {
      const org = await db.organization.create({ data: { name: label, slug: `action-${label}-${runId}` } });
      organizations.push(org.id);
    }
    employee = await account(organizations[0], 'EMPLOYEE', 'assignee');
    reporter = await account(organizations[0], 'EMPLOYEE', 'reporter');
    unrelated = await account(organizations[0], 'EMPLOYEE', 'unrelated');
    officer = await account(organizations[0], 'SAFETY_OFFICER', 'officer');
    admin = await account(organizations[0], 'ADMIN', 'admin');
    outsider = await account(organizations[1], 'ADMIN', 'outsider');
    localHazard = await hazard(reporter);
    foreignHazard = await hazard(outsider);
  });

  after(async () => {
    try {
      if (!organizations.length) return;
      await db.$transaction(async (tx) => {
        await verifyTarget(tx);
        const scope = { organizationId: { in: organizations } };
        await tx.auditLog.deleteMany({ where: scope });
        await tx.correctiveActionEvent.deleteMany({ where: scope });
        await tx.correctiveAction.deleteMany({ where: scope });
        await tx.riskAssessmentRevision.deleteMany({ where: scope });
        await tx.riskAssessment.deleteMany({ where: scope });
        await tx.hazard.deleteMany({ where: scope });
        await tx.user.deleteMany({ where: { ...scope, email: { endsWith: `@${runId}.example.test` } } });
        await tx.organization.deleteMany({ where: { id: { in: organizations } } });
        assert.equal(await tx.correctiveAction.count({ where: scope }), 0);
        assert.equal(await tx.correctiveActionEvent.count({ where: scope }), 0);
      });
    } finally {
      if (db) await disconnectDatabase();
    }
  });

  test('requires confirmed and assessed hazards and creates multiple actions with history and audit', options, async () => {
    await request(app).post(base).send(payload()).expect(401);
    await authorized('post', base, employee).send(payload()).expect(403);
    for (const target of [await hazard(reporter, 'REPORTED'), await hazard(reporter, 'CONFIRMED', false)]) {
      const response = await authorized('post', base, officer).send(payload({ hazardId: target.id })).expect(409);
      assert.equal(response.body.error.code, 'HAZARD_NOT_ELIGIBLE');
    }
    const first = await create();
    const second = await create({ title: 'Inspect replacement' }, admin);
    assert.notEqual(first.id, second.id);
    assert.partialDeepStrictEqual(first, {
      hazardId: localHazard.id, organizationId: officer.organizationId, createdById: officer.id,
      assigneeId: employee.id, status: 'OPEN', version: 1, dueAt: '2099-01-01T00:00:00.000Z',
    });
    assert.equal(second.createdById, admin.id);
    const event = await db.correctiveActionEvent.findFirstOrThrow({ where: { actionId: first.id } });
    assert.partialDeepStrictEqual(event, { kind: 'CREATED', actorId: officer.id, fromStatus: null, toStatus: 'OPEN', version: 1 });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: first.id } });
    assert.partialDeepStrictEqual(audit, { action: 'CORRECTIVE_ACTION_CREATED', actorId: officer.id, metadata: null });
  });

  test('assignees can see their action without hazard access, while reporters get read-only access', options, async () => {
    const action = await create();
    const path = `${base}/${action.id}`;
    await authorized('get', `/api/v1/hazards/${localHazard.id}`, employee).expect(404);
    await authorized('get', `/api/v1/risk-assessments?hazardId=${localHazard.id}`, employee).expect(404);
    for (const user of [employee, reporter, officer, admin]) {
      const { body } = await authorized('get', path, user).expect('Cache-Control', 'no-store').expect(200);
      assert.deepEqual(Object.keys(body.data).sort(), [
        'assigneeId', 'completionDetails', 'createdAt', 'createdById', 'description', 'dueAt', 'hazardId',
        'id', 'organizationId', 'status', 'submittedById', 'title', 'updatedAt', 'version', 'workNotes',
      ]);
      assert.doesNotMatch(JSON.stringify(body), /Private hazard description|passwordHash|authVersion/);
      const list = await authorized('get', `${base}?hazardId=${localHazard.id}&assigneeId=${employee.id}`, user).expect(200);
      assert.ok(list.body.data.actions.some(({ id }) => id === action.id));
      await authorized('get', path + '/history', user).expect(200);
    }
    await authorized('get', path, unrelated).expect(404);
    await authorized('get', path + '/history', unrelated).expect(404);
    await transition(action, 'start', reporter).expect(403);
    const list = await authorized('get', `${base}?hazardId=${localHazard.id}`, unrelated).expect(200);
    assert.deepEqual(list.body.data.actions, []);
    const sibling = await create({ assigneeId: unrelated.id });
    await authorized('get', `${base}/${sibling.id}`, employee).expect(404);
    const reassigned = await authorized('patch', path, officer)
      .send({ version: action.version, assigneeId: unrelated.id }).expect(200);
    assert.equal(reassigned.body.data.assigneeId, unrelated.id);
    await authorized('get', path, employee).expect(404);
    await authorized('get', path, unrelated).expect(200);
  });

  test('rejects cross-organization access and requires an approved, undeleted assignee', options, async () => {
    const local = await create();
    const foreign = await create({ hazardId: foreignHazard.id, assigneeId: outsider.id }, outsider);
    await authorized('post', base, officer).send(payload({ hazardId: foreignHazard.id })).expect(404);
    await authorized('post', base, officer).send(payload({ assigneeId: outsider.id })).expect(404);
    await authorized('patch', `${base}/${local.id}`, admin).send({ version: local.version, assigneeId: outsider.id }).expect(404);
    await authorized('get', `${base}/${foreign.id}`, officer).expect(404);
    await authorized('get', `${base}/${foreign.id}/history`, officer).expect(404);
    await authorized('patch', `${base}/${foreign.id}`, officer).send({ version: foreign.version, title: 'Different' }).expect(404);
    await transition(foreign, 'verify', officer).expect(404);
    const scoped = await authorized('get', `${base}?hazardId=${foreignHazard.id}`, officer).expect(200);
    assert.deepEqual(scoped.body.data.actions, []);
    for (const [label, data] of [
      ['pending', { status: 'PENDING' }], ['rejected', { status: 'REJECTED' }],
      ['suspended', { status: 'SUSPENDED' }], ['deleted', { deletedAt: new Date() }],
    ]) {
      const ineligible = await account(organizations[0], 'EMPLOYEE', label, data);
      await authorized('post', base, officer).send(payload({ assigneeId: ineligible.id })).expect(409);
      await authorized('patch', `${base}/${local.id}`, admin).send({ version: local.version, assigneeId: ineligible.id }).expect(409);
    }
    const assigned = await account(organizations[0], 'EMPLOYEE', 'later-suspended');
    const action = await create({ assigneeId: assigned.id });
    await authorized('patch', `/api/v1/users/${assigned.id}/suspend`, admin).expect(200);
    await transition(action, 'start', assigned).expect(401);
    await transition(action, 'start', officer).expect(409);
    const changed = await authorized('patch', `${base}/${action.id}`, admin)
      .send({ version: action.version, assigneeId: employee.id }).expect(200);
    await transition(changed.body.data, 'start', employee).expect(200);
  });

  test('assignee starts, edits and submits, manager returns with reason, and independent manager verifies', options, async () => {
    const action = await create();
    const path = `${base}/${action.id}`;
    await transition(action, 'submit', employee, { completionDetails }).expect(409);
    let current = await advance(action, 'start', employee);
    await authorized('patch', path, employee).send({ version: current.version, assigneeId: unrelated.id }).expect(403);
    const worked = await authorized('patch', path, employee).send({ version: current.version, workNotes: 'Guard is ready for review.' }).expect(200);
    current = await advance(worked.body.data, 'submit', employee, { completionDetails });
    assert.partialDeepStrictEqual(current, { status: 'PENDING_VERIFICATION', submittedById: employee.id, completionDetails });
    await transition(current, 'verify', employee).expect(403);
    await transition(current, 'return', employee, { reason }).expect(403);
    await transition(current, 'return', admin).expect(400);
    await authorized('patch', path, officer).send({ version: current.version, assigneeId: admin.id }).expect(409);
    current = await advance(current, 'return', admin, { reason });
    assert.partialDeepStrictEqual(current, { status: 'IN_PROGRESS', submittedById: null, completionDetails: null });
    current = await advance(current, 'submit', employee, { completionDetails });
    current = await advance(current, 'verify', officer);
    assert.equal(current.status, 'VERIFIED');
    await transition(current, 'return', admin, { reason }).expect(409);
    await authorized('patch', path, officer).send({ version: current.version, title: 'Changed' }).expect(409);
    const history = await authorized('get', path + '/history?limit=100', employee).expect(200);
    const events = history.body.data.events;
    assert.deepEqual(events.map(({ kind }) => kind), ['VERIFIED', 'SUBMITTED', 'RETURNED', 'SUBMITTED', 'UPDATED', 'STARTED', 'CREATED']);
    assert.deepEqual(events.map(({ version }) => version), [7, 6, 5, 4, 3, 2, 1]);
    assert.partialDeepStrictEqual(events[0], { actorId: officer.id, fromStatus: 'PENDING_VERIFICATION', toStatus: 'VERIFIED' });
    assert.equal(events[2].reason, reason);
    assert.equal(events[3].completionDetails, completionDetails);
    assert.ok(events.every(({ createdAt }) => new Date(createdAt).toISOString() === createdAt));
    const audits = await db.auditLog.findMany({ where: { entityId: action.id } });
    assert.equal(audits.length, 7);
    assert.ok(audits.every(({ metadata }) => metadata === null));
  });

  test('a manager cannot verify their own submission or an action assigned to them', options, async () => {
    const own = await create({ assigneeId: officer.id });
    const started = await advance(own, 'start', officer);
    const submitted = await advance(started, 'submit', admin, { completionDetails });
    for (const actor of [officer, admin]) {
      const response = await transition(submitted, 'verify', actor).expect(403);
      assert.equal(response.body.error.code, 'SELF_VERIFICATION_FORBIDDEN');
    }
  });

  test('invalid versions and fields return 400 and conditional writes reject concurrent and stale mutations', options, async () => {
    const initial = await create();
    const path = `${base}/${initial.id}`;
    await authorized('post', base, officer).send(payload({ status: 'VERIFIED' })).expect(400);
    await authorized('patch', path, officer).send({ version: 1, auditMetadata: {} }).expect(400);
    await authorized('patch', path + '/start', employee).send({ version: '1' }).expect(400);
    await authorized('get', base + '?overdue=1', officer).expect(400);
    const results = await Promise.all([
      transition(initial, 'start', employee),
      authorized('patch', path, admin).send({ version: initial.version, title: 'Updated by manager' }),
    ]);
    assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(results.find(({ status }) => status === 409).body.error.code, 'STALE_CORRECTIVE_ACTION');
    const current = results.find(({ status }) => status === 200).body.data;
    await transition(initial, 'start', employee).expect(409);
    const started = current.status === 'OPEN' ? await advance(current, 'start', employee) : current;
    const pending = await advance(started, 'submit', employee, { completionDetails });
    const decisions = await Promise.all([
      transition(pending, 'verify', officer),
      transition(pending, 'return', admin, { reason }),
    ]);
    assert.deepEqual(decisions.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(await db.correctiveActionEvent.count({
      where: { actionId: initial.id, kind: { in: ['VERIFIED', 'RETURNED'] } },
    }), 1);
  });

  test('filters hazard, assignee, status and overdue, with deterministic pagination', options, async () => {
    const target = await hazard(reporter);
    const filters = { hazardId: target.id, dueAt: '2000-01-01T00:00:00Z' };
    const first = await create(filters);
    const second = await create(filters);
    const future = await create({ hazardId: target.id });
    const completed = await create(filters);
    const started = await advance(completed, 'start', employee);
    const pending = await advance(started, 'submit', employee, { completionDetails });
    await advance(pending, 'verify', admin);
    await create({ ...filters, assigneeId: unrelated.id });
    const ids = [first.id, second.id].sort().reverse();
    await db.correctiveAction.updateMany({ where: { id: { in: ids } }, data: { createdAt: new Date('2020-01-01T00:00:00Z') } });
    const query = `hazardId=${target.id}&assigneeId=${employee.id}&status=OPEN&overdue=true&limit=1`;
    for (const [index, id] of ids.entries()) {
      const { body } = await authorized('get', `${base}?${query}&page=${index + 1}`, officer).expect(200);
      assert.deepEqual(body.data.actions.map((action) => action.id), [id]);
    }
    const notOverdue = await authorized('get', `${base}?hazardId=${target.id}&overdue=false`, officer).expect(200);
    assert.deepEqual(new Set(notOverdue.body.data.actions.map(({ id }) => id)), new Set([future.id, completed.id]));
    await authorized('get', base + '?limit=101', officer).expect(400);
  });

  test('database rejects foreign references and an audit failure rolls back action and history', options, async () => {
    const action = await create();
    await assert.rejects(db.correctiveAction.update({ where: { id: action.id }, data: { assigneeId: outsider.id } }), { code: 'P2003' });
    await assert.rejects(db.correctiveAction.update({ where: { id: action.id }, data: { hazardId: foreignHazard.id } }), { code: 'P2003' });
    await assert.rejects(db.correctiveAction.update({
      where: { id: action.id }, data: { status: 'PENDING_VERIFICATION', submittedById: outsider.id, completionDetails },
    }), { code: 'P2003' });
    await assert.rejects(db.correctiveAction.update({
      where: { id: action.id }, data: { status: 'VERIFIED' },
    }), /CorrectiveAction_submission_check/);
    const original = db.$transaction;
    const failures = [];
    db.$transaction = (operation) => original.call(db, (tx) => operation({
      hazard: tx.hazard, correctiveAction: tx.correctiveAction, correctiveActionEvent: tx.correctiveActionEvent,
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
      const response = await authorized('post', base, officer).send(payload({ title: 'Audit rollback marker' })).expect(500);
      assert.equal(response.body.error.code, 'INTERNAL_ERROR');
      await transition(action, 'start', employee).expect(500);
    } finally {
      db.$transaction = original;
    }
    assert.deepEqual(failures, ['P2003', 'P2003']);
    assert.equal(await db.correctiveAction.count({ where: { organizationId: officer.organizationId, title: 'Audit rollback marker' } }), 0);
    assert.partialDeepStrictEqual(await db.correctiveAction.findUniqueOrThrow({ where: { id: action.id } }), { status: 'OPEN', version: 1 });
    assert.equal(await db.correctiveActionEvent.count({ where: { actionId: action.id } }), 1);
    assert.equal(await db.auditLog.count({ where: { entityId: action.id } }), 1);
  });
});
