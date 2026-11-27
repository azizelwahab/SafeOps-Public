import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import request from 'supertest';
import app from '../src/app.js';
import { disconnectDatabase, getDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { signAccessToken } from '../src/utils/token.js';

const base = '/api/v1';
const options = { skip: env.databaseUrl ? false : 'TEST_DATABASE_URL is unset' };
const runId = randomUUID();
const organizations = [];
const rationale = 'Controls were inspected and the remaining exposure was documented.';
const completionDetails = 'Installed the control and checked all marked mounting points.';
let db;
let employee;
let coworker;
let officer;
let admin;
let outsider;

function authorized(method, path, user) {
  return request(app)[method](base + path).set('Authorization', `Bearer ${signAccessToken(user)}`);
}

async function verifyTestDatabase(client) {
  const [target] = await client.$queryRaw`SELECT current_database() AS name`;
  assert.equal(target.name, 'safeops_test');
}

function user(organizationId, role, label, extra = {}) {
  return db.user.create({ data: {
    organizationId, role, status: 'APPROVED', name: label,
    email: `${label}@${runId}.example.test`, passwordHash: 'unused-in-closure-tests', ...extra,
  } });
}

function hazard(reporter = employee, status = 'CONFIRMED') {
  return db.hazard.create({ data: {
    organizationId: reporter.organizationId, reportedById: reporter.id, status,
    category: 'MECHANICAL', title: 'Loose guard', description: 'A guard was found loose.', location: 'Workshop',
  } });
}

const hazardPath = (target) => `/hazards/${target.id}`;

async function baseline(target, actor = officer) {
  const { body } = await authorized('post', '/risk-assessments', actor)
    .send({ hazardId: target.id, likelihood: 5, severity: 5 }).expect(201);
  return body.data;
}

function openAction(target, actor = officer, assignee = employee) {
  return authorized('post', '/corrective-actions', actor).send({
    hazardId: target.id, assigneeId: assignee.id, title: 'Secure guard',
    description: 'Install and check all mounting points.', dueAt: '2099-01-01T00:00:00Z',
  });
}

async function verifyAction(action, assignee = employee, verifier = officer) {
  const path = `/corrective-actions/${action.id}`;
  const started = await authorized('patch', path + '/start', assignee).send({ version: action.version }).expect(200);
  const submitted = await authorized('patch', path + '/submit', assignee)
    .send({ version: started.body.data.version, completionDetails }).expect(200);
  const verified = await authorized('patch', path + '/verify', verifier)
    .send({ version: submitted.body.data.version }).expect(200);
  return verified.body.data;
}

async function readyHazard(reporter = employee, assessor = officer) {
  const target = await hazard(reporter);
  const assessment = await baseline(target, assessor);
  const { body } = await openAction(target, assessor, reporter).expect(201);
  const action = await verifyAction(body.data, reporter, assessor);
  return { target, assessment, action };
}

function residual(target, version = 0, ratings = {}, actor = officer) {
  return authorized('post', hazardPath(target) + '/residual-risk', actor)
    .send({ version, likelihood: 1, severity: 2, rationale, ...ratings });
}

function close(target, residualVersion = 1, decision, actor = officer) {
  return authorized('patch', hazardPath(target) + '/close', actor)
    .send({ residualVersion, rationale, ...(decision ? { decision } : {}) });
}

describe('Hazard closure and residual risk', () => {
  before(async () => {
    if (!env.databaseUrl) return;
    assert.equal(env.nodeEnv, 'test');
    assert.equal(new URL(env.databaseUrl).pathname, '/safeops_test');
    db = getDatabase();
    await verifyTestDatabase(db);
    for (const name of ['local', 'other']) {
      const record = await db.organization.create({ data: { name, slug: `closure-${name}-${runId}` } });
      organizations.push(record.id);
    }
    employee = await user(organizations[0], 'EMPLOYEE', 'reporter');
    coworker = await user(organizations[0], 'EMPLOYEE', 'coworker');
    officer = await user(organizations[0], 'SAFETY_OFFICER', 'officer');
    admin = await user(organizations[0], 'ADMIN', 'admin');
    outsider = await user(organizations[1], 'ADMIN', 'outsider');
  });

  after(async () => {
    try {
      if (!organizations.length) return;
      await db.$transaction(async (tx) => {
        await verifyTestDatabase(tx);
        const scope = { organizationId: { in: organizations } };
        await tx.auditLog.deleteMany({ where: scope });
        await tx.hazardClosureDecision.deleteMany({ where: scope });
        await tx.residualRiskRevision.deleteMany({ where: scope });
        await tx.correctiveActionEvent.deleteMany({ where: scope });
        await tx.correctiveAction.deleteMany({ where: scope });
        await tx.riskAssessmentRevision.deleteMany({ where: scope });
        await tx.riskAssessment.deleteMany({ where: scope });
        await tx.hazard.deleteMany({ where: scope });
        await tx.user.deleteMany({ where: { ...scope, email: { endsWith: `@${runId}.example.test` } } });
        await tx.organization.deleteMany({ where: { id: { in: organizations } } });
      });
    } finally {
      if (db) await disconnectDatabase();
    }
  });

  test('closes verified hazards and preserves baseline and residual revision history', options, async () => {
    const { target, assessment, action } = await readyHazard();
    const original = await authorized('get', `/risk-assessments/${assessment.id}/history`, officer).expect(200);
    const one = await residual(target).expect(201);
    const two = await residual(target, 1, { likelihood: 2, severity: 3 }, admin).expect(201);
    assert.partialDeepStrictEqual(one.body.data, { version: 1, assessedById: officer.id, score: 2, level: 'LOW' });
    assert.partialDeepStrictEqual(two.body.data, { version: 2, assessedById: admin.id, score: 6, level: 'MEDIUM', baselineVersion: 1, verifiedActionCount: 1 });
    const latest = await authorized('get', hazardPath(target) + '/residual-risk', employee)
      .expect('Cache-Control', 'no-store').expect(200);
    assert.deepEqual(latest.body.data, two.body.data);
    const page = await authorized('get', hazardPath(target) + '/residual-risk/history?page=2&limit=1', employee).expect(200);
    assert.deepEqual(page.body.data.revisions, [one.body.data]);
    await close(target, 1).expect(409);
    const closed = await close(target, 2).expect(200);
    assert.partialDeepStrictEqual(closed.body.data, {
      status: 'CLOSED', outcome: 'NOT_REQUIRED', residualVersion: 2, decidedById: officer.id, rationale,
    });
    assert.equal(new Date(closed.body.data.createdAt).toISOString(), closed.body.data.createdAt);
    const closure = await authorized('get', hazardPath(target) + '/closure', employee).expect(200);
    assert.deepEqual(closure.body, closed.body);
    const list = await authorized('get', '/hazards?status=CLOSED', employee).expect(200);
    assert.ok(list.body.data.hazards.some(({ id }) => id === target.id));
    const after = await authorized('get', `/risk-assessments/${assessment.id}/history`, officer).expect(200);
    assert.deepEqual(after.body.data, original.body.data);
    await authorized('patch', `/risk-assessments/${assessment.id}`, officer).send({ version: 1, severity: 4 }).expect(409);
    await openAction(target).expect(409);
    await authorized('patch', `/corrective-actions/${action.id}`, officer).send({ version: action.version, title: 'Late edit' }).expect(409);
    await residual(target, 2).expect(409);
    await close(target, 2).expect(409);
    const audits = await db.auditLog.findMany({ where: { organizationId: officer.organizationId, entityId: target.id } });
    assert.deepEqual(audits.map(({ action }) => action).sort(), ['HAZARD_CLOSED', 'RESIDUAL_RISK_RECORDED', 'RESIDUAL_RISK_RECORDED']);
    assert.ok(audits.every(({ metadata }) => metadata === null));
  });

  test('requires confirmed status, baseline, at least one verified action, and residual risk', options, async () => {
    const unconfirmed = await hazard(employee, 'REPORTED');
    const noBaseline = await hazard();
    const noActions = await hazard();
    await baseline(noActions);
    const open = await hazard();
    await baseline(open);
    await openAction(open).expect(201);
    for (const [target, code] of [
      [unconfirmed, 'HAZARD_NOT_CONFIRMED'], [noBaseline, 'BASELINE_REQUIRED'],
      [noActions, 'VERIFIED_ACTIONS_REQUIRED'], [open, 'VERIFIED_ACTIONS_REQUIRED'],
    ]) {
      assert.equal((await residual(target).expect(409)).body.error.code, code);
      assert.equal((await close(target).expect(409)).body.error.code, code);
    }
    const { target } = await readyHazard();
    assert.equal((await close(target).expect(409)).body.error.code, 'RESIDUAL_RISK_REQUIRED');
    await authorized('get', hazardPath(target) + '/residual-risk', employee).expect(404);
  });

  test('requires a fresh residual revision after baseline edits or newly verified actions', options, async () => {
    const { target, assessment } = await readyHazard();
    await residual(target).expect(201);
    await authorized('patch', `/risk-assessments/${assessment.id}`, officer).send({ version: 1, severity: 4 }).expect(200);
    assert.equal((await close(target).expect(409)).body.error.code, 'STALE_RESIDUAL_RISK');
    await residual(target, 1).expect(201);
    const { body } = await openAction(target).expect(201);
    await verifyAction(body.data);
    assert.equal((await close(target, 2).expect(409)).body.error.code, 'STALE_RESIDUAL_RISK');
    const refreshed = await residual(target, 2).expect(201);
    assert.partialDeepStrictEqual(refreshed.body.data, { baselineVersion: 2, verifiedActionCount: 2 });
    await close(target, 3).expect(200);
  });

  test('high and critical decisions require explicit action, and escalation never closes a hazard', options, async () => {
    for (const ratings of [{ likelihood: 4, severity: 4 }, { likelihood: 5, severity: 5 }]) {
      const { target } = await readyHazard();
      await residual(target, 0, ratings).expect(201);
      assert.equal((await close(target).expect(409)).body.error.code, 'RISK_DECISION_REQUIRED');
      await close(target, 1, 'ACCEPTED').expect(403);
      const escalated = await close(target, 1, 'ESCALATED').expect(200);
      assert.partialDeepStrictEqual(escalated.body.data, { status: 'CONFIRMED', outcome: 'ESCALATED', decidedById: officer.id });
      assert.equal((await close(target, 1, 'ACCEPTED', admin).expect(409)).body.error.code, 'CLOSURE_ALREADY_DECIDED');
      await residual(target, 1, ratings, admin).expect(201);
      const accepted = await close(target, 2, 'ACCEPTED', admin).expect(200);
      assert.partialDeepStrictEqual(accepted.body.data, { status: 'CLOSED', outcome: 'ACCEPTED', decidedById: admin.id });
      assert.equal(await db.hazardClosureDecision.count({ where: { hazardId: target.id } }), 2);
    }
  });

  test('enforces tenant scope, reporter visibility, authorized roles and current account status', options, async () => {
    const { target } = await readyHazard();
    await request(app).post(base + hazardPath(target) + '/residual-risk').expect(401);
    await residual(target, 0, {}, employee).expect(403);
    await close(target, 1, undefined, employee).expect(403);
    await residual(target, 0, {}, outsider).expect(404);
    await close(target, 1, undefined, outsider).expect(404);
    for (const [label, data] of [
      ['suspended', { status: 'SUSPENDED' }], ['rejected', { status: 'REJECTED' }], ['deleted', { deletedAt: new Date() }],
    ]) {
      const disabled = await user(organizations[0], 'SAFETY_OFFICER', label, data);
      await residual(target, 0, {}, disabled).expect(401);
      await close(target, 1, undefined, disabled).expect(401);
    }
    await residual(target).expect(201);
    await close(target).expect(200);
    for (const actor of [coworker, outsider]) {
      for (const suffix of ['/residual-risk', '/residual-risk/history', '/closure']) {
        await authorized('get', hazardPath(target) + suffix, actor).expect(404);
      }
    }
    await authorized('get', hazardPath(target) + '/closure', employee).expect(200);
    await assert.rejects(db.residualRiskRevision.create({ data: {
      hazardId: target.id, organizationId: officer.organizationId, assessedById: outsider.id, version: 2,
      baselineVersion: 1, verifiedActionCount: 1, likelihood: 1, severity: 2, score: 2, level: 'LOW', rationale,
    } }), { code: 'P2003' });
  });

  test('concurrent risk revisions and conflicting closure decisions each have one winner', options, async () => {
    const { target } = await readyHazard();
    const results = await Promise.all([
      residual(target, 0, { likelihood: 5, severity: 5 }, officer),
      residual(target, 0, { likelihood: 4, severity: 5 }, admin),
    ]);
    assert.deepEqual(results.map(({ status }) => status).sort(), [201, 409]);
    const decisions = await Promise.all([
      close(target, 1, 'ESCALATED', officer), close(target, 1, 'ACCEPTED', admin),
    ]);
    assert.deepEqual(decisions.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(await db.hazardClosureDecision.count({ where: { hazardId: target.id } }), 1);
    const { target: stale } = await readyHazard();
    await residual(stale).expect(201);
    const race = await Promise.all([residual(stale, 1), close(stale, 1)]);
    assert.deepEqual(race.map(({ status }) => status).sort(),
      race[0].status === 201 ? [201, 409] : [200, 409]);
  });

  test('corrective action creation and closure cannot commit in conflict', options, async () => {
    const { target } = await readyHazard();
    await residual(target).expect(201);
    const [action, closure] = await Promise.all([openAction(target), close(target)]);
    assert.deepEqual([action.status, closure.status], action.status === 201 ? [201, 409] : [409, 200]);
    const stored = await db.hazard.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(stored.status, closure.status === 200 ? 'CLOSED' : 'CONFIRMED');
    assert.equal(await db.correctiveAction.count({ where: { hazardId: target.id, status: 'OPEN' } }), action.status === 201 ? 1 : 0);
  });

  test('rechecks account eligibility after waiting for the hazard lock', options, async () => {
    const { target } = await readyHazard();
    const actor = await user(organizations[0], 'SAFETY_OFFICER', 'closure-lock-officer');
    const locked = Promise.withResolvers();
    const release = Promise.withResolvers();
    const entered = Promise.withResolvers();
    const original = db.$transaction;
    const blocker = original.call(db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Hazard" WHERE id = ${target.id}::uuid FOR UPDATE`;
      locked.resolve();
      await release.promise;
    });
    await Promise.race([locked.promise, blocker]);
    db.$transaction = (operation, settings) => original.call(db, (tx) => {
      entered.resolve();
      return operation(tx);
    }, settings);
    const response = residual(target, 0, {}, actor).then((result) => result);
    try {
      await Promise.race([entered.promise, response.then(() => assert.fail('Request did not enter its write transaction.'))]);
      await db.user.update({
        where: { id: actor.id }, data: { status: 'SUSPENDED', authVersion: { increment: 1 } },
      });
    } finally {
      db.$transaction = original;
      release.resolve();
      await blocker;
    }
    assert.equal((await response).status, 401);
    assert.equal(await db.residualRiskRevision.count({ where: { hazardId: target.id } }), 0);
  });

  test('audit foreign-key failures roll back revisions and closure decisions', options, async () => {
    const { target } = await readyHazard();
    const original = db.$transaction;
    const failures = [];
    function failAudit() {
      db.$transaction = (operation, options) => original.call(db, (tx) => operation({
        $queryRaw: tx.$queryRaw.bind(tx), hazard: tx.hazard, riskAssessment: tx.riskAssessment,
        correctiveAction: tx.correctiveAction, residualRiskRevision: tx.residualRiskRevision,
        hazardClosureDecision: tx.hazardClosureDecision,
        auditLog: { create: async ({ data }) => {
          try {
            return await tx.auditLog.create({ data: { ...data, actorId: outsider.id } });
          } catch (error) {
            failures.push(error.code);
            throw error;
          }
        } },
      }), options);
    }
    failAudit();
    try {
      await residual(target).expect(500);
    } finally {
      db.$transaction = original;
    }
    assert.equal(await db.residualRiskRevision.count({ where: { hazardId: target.id } }), 0);
    await residual(target).expect(201);
    failAudit();
    try {
      await close(target).expect(500);
    } finally {
      db.$transaction = original;
    }
    assert.deepEqual(failures, ['P2003', 'P2003']);
    assert.equal(await db.hazardClosureDecision.count({ where: { hazardId: target.id } }), 0);
    assert.equal((await db.hazard.findUniqueOrThrow({ where: { id: target.id } })).status, 'CONFIRMED');
  });
});
