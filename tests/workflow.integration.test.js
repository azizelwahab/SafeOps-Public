import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { bootstrapAdmin } from '../src/services/authService.js';
import { isolatedOrganizations } from './helpers/isolatedOrganizations.js';

const base = '/api/v1';
const options = { skip: env.databaseUrl ? false : 'TEST_DATABASE_URL is unset' };
const fixtures = isolatedOrganizations();
const localSlug = `demo-${fixtures.runId}`;
const api = request(app);

function credentials(label) {
  return { email: fixtures.email(label), password: randomBytes(20).toString('base64url') };
}

const admin = credentials('admin');
const outside = credentials('outside');
const employee = credentials('employee');
const officer = credentials('officer');

function authorized(method, path, token) {
  return api[method](base + path).set('Authorization', `Bearer ${token}`);
}

async function login(account) {
  const { body } = await api.post(base + '/auth/login').send(account).expect(200);
  return body.data.accessToken;
}

async function approve(account, token) {
  const { body } = await authorized('get', `/users?status=PENDING&search=${encodeURIComponent(account.email)}`, token)
    .expect(200);
  assert.equal(body.data.users.length, 1);
  assert.equal(body.data.users[0].email, account.email);
  const id = body.data.users[0].id;
  await authorized('patch', `/users/${id}/approve`, token).expect(200);
  return id;
}

describe('SafeOps workflow demonstration', () => {
  before(async () => {
    if (!env.databaseUrl) return;
    await fixtures.connect();
    for (const [account, organizationSlug] of [[admin, localSlug], [outside, `outside-${fixtures.runId}`]]) {
      const created = await bootstrapAdmin({
        ...account, organizationSlug, organizationName: 'Isolated demo organization', name: 'Demo Administrator',
      }, fixtures.verifyTarget);
      fixtures.organizationIds.push(created.organizationId);
    }
  });

  after(fixtures.cleanup);

  test('signup through independent verification, escalation and administrator acceptance', options, async (t) => {
    const adminToken = await login(admin);
    const outsiderToken = await login(outside);

    for (const [account, name] of [[employee, 'Demo Employee'], [officer, 'Demo Safety Officer']]) {
      await api.post(base + '/auth/signup').send({ ...account, name, organizationSlug: localSlug }).expect(202);
    }
    await api.post(base + '/auth/login').send(employee).expect(401);
    const employeeId = await approve(employee, adminToken);
    const officerId = await approve(officer, adminToken);
    await authorized('patch', `/users/${officerId}/role`, adminToken).send({ role: 'SAFETY_OFFICER' }).expect(200);
    const employeeToken = await login(employee);
    const officerToken = await login(officer);
    t.diagnostic('Signup created pending accounts. The administrator approved both and promoted the safety officer.');

    const reported = await authorized('post', '/hazards', employeeToken).send({
      title: 'Loose machine guard', description: 'The guard moves under normal operation.',
      category: 'MECHANICAL', location: 'Test workshop',
    }).expect(201);
    const hazardId = reported.body.data.id;
    const hazard = `/hazards/${hazardId}`;
    const reviewNotes = 'A site check verified that the guard requires a corrective action.';
    await authorized('get', hazard, outsiderToken).expect(404);
    await authorized('patch', hazard + '/confirm', officerToken).send({ reviewNotes }).expect(409);
    await authorized('patch', hazard + '/review', officerToken).expect(200);
    await authorized('patch', hazard + '/confirm', officerToken).send({ reviewNotes }).expect(200);
    const baseline = await authorized('post', '/risk-assessments', officerToken)
      .send({ hazardId, likelihood: 5, severity: 5 }).expect(201);
    assert.equal(baseline.body.data.level, 'CRITICAL');
    await authorized('post', '/risk-assessments', outsiderToken)
      .send({ hazardId, likelihood: 1, severity: 1 }).expect(404);
    t.diagnostic('The reported hazard entered review before confirmation. A premature confirmation and foreign-tenant access were rejected.');

    const created = await authorized('post', '/corrective-actions', officerToken).send({
      hazardId, assigneeId: employeeId, title: 'Secure guard', description: 'Install and check approved fasteners.',
      dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }).expect(201);
    const action = `/corrective-actions/${created.body.data.id}`;
    const completionDetails = 'The guard was secured and all fastening points were checked.';
    await authorized('patch', action + '/submit', employeeToken)
      .send({ version: created.body.data.version, completionDetails }).expect(409);
    const started = await authorized('patch', action + '/start', employeeToken)
      .send({ version: created.body.data.version }).expect(200);
    const submitted = await authorized('patch', action + '/submit', employeeToken)
      .send({ version: started.body.data.version, completionDetails }).expect(200);
    await authorized('patch', action + '/verify', employeeToken)
      .send({ version: submitted.body.data.version }).expect(403);
    await authorized('patch', action + '/verify', officerToken)
      .send({ version: submitted.body.data.version }).expect(200);
    t.diagnostic('The employee started and submitted the assigned action. The safety officer independently verified it.');

    const rationale = 'Inspection confirmed the control reduced likelihood, while possible harm remains serious.';
    const initial = await authorized('post', hazard + '/residual-risk', officerToken)
      .send({ version: 0, likelihood: 4, severity: 4, rationale }).expect(201);
    assert.equal(initial.body.data.level, 'HIGH');
    await authorized('patch', hazard + '/close', officerToken)
      .send({ residualVersion: 1, rationale }).expect(409);
    await authorized('patch', hazard + '/close', officerToken)
      .send({ residualVersion: 1, rationale, decision: 'ACCEPTED' }).expect(403);
    const escalation = await authorized('patch', hazard + '/close', officerToken)
      .send({ residualVersion: 1, rationale, decision: 'ESCALATED' }).expect(200);
    assert.equal(escalation.body.data.status, 'CONFIRMED');

    const readSummary = (token) => authorized('get', '/dashboard/summary', token).expect(200).then(({ body }) => body.data);
    const beforeClosure = await readSummary(adminToken);
    assert.equal(beforeClosure.unresolvedEscalations, 1);
    assert.deepEqual(beforeClosure.riskLevels, { LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 });
    const reassessed = await authorized('post', hazard + '/residual-risk', adminToken)
      .send({ version: 1, likelihood: 4, severity: 4, rationale }).expect(201);
    const accepted = await authorized('patch', hazard + '/close', adminToken)
      .send({ residualVersion: reassessed.body.data.version, rationale, decision: 'ACCEPTED' }).expect(200);
    assert.equal(accepted.body.data.status, 'CLOSED');
    const closed = await readSummary(employeeToken);
    assert.equal(closed.closedHazards, 1);
    assert.equal(closed.correctiveActionsByStatus.VERIFIED, 1);
    assert.equal(closed.unresolvedEscalations, 0);
    assert.deepEqual(closed.riskSources, { baseline: 0, residual: 1, unassessed: 0 });
    const foreign = await readSummary(outsiderToken);
    assert.ok(Object.values(foreign.hazardsByStatus).every((count) => count === 0));
    assert.ok(Object.values(foreign.correctiveActionsByStatus).every((count) => count === 0));
    t.diagnostic('High residual risk required administrator acceptance. Escalation appeared in the dashboard until closure.');
    t.diagnostic(`Final reporter dashboard metrics: ${JSON.stringify({
      closedHazards: closed.closedHazards, unresolvedEscalations: closed.unresolvedEscalations,
      riskLevels: closed.riskLevels, correctiveActionsByStatus: closed.correctiveActionsByStatus,
    })}`);
  });
});
