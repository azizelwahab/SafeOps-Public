import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { signAccessToken } from '../src/utils/token.js';
import { isolatedOrganizations } from './helpers/isolatedOrganizations.js';

const endpoint = '/api/v1/dashboard/summary';
const options = { skip: env.databaseUrl ? false : 'TEST_DATABASE_URL is unset' };
const fixtures = isolatedOrganizations();
const january = new Date('2025-01-01T00:00:00.000Z');
const february = new Date('2025-02-01T00:00:00.000Z');
const december = new Date('2024-12-31T23:59:59.999Z');
const inRange = new Date('2025-01-02T00:00:00.000Z');
const pastDue = new Date('2000-01-01T00:00:00.000Z');
const futureDue = new Date('2099-01-01T00:00:00.000Z');

let db;
let admin;
let officer;
let reporter;
let coworker;
let outsider;
let empty;
let suspended;

function summary(user, query = '') {
  return request(app).get(endpoint + query).set('Authorization', `Bearer ${signAccessToken(user)}`);
}

function counts(body) {
  const { asOf, range, ...metrics } = body.data;
  assert.equal(new Date(asOf).toISOString(), asOf);
  return metrics;
}

function user(organizationId, role, label, status = 'APPROVED') {
  return db.user.create({ data: {
    organizationId, role, name: label, status, email: fixtures.email(label),
    passwordHash: 'unused-in-dashboard-tests',
  } });
}

function hazard(reportedBy, status, createdAt = inRange) {
  return db.hazard.create({ data: {
    organizationId: reportedBy.organizationId, reportedById: reportedBy.id, status, createdAt,
    title: 'Dashboard fixture', description: 'A synthetic report for metric verification.',
    location: 'Test workshop', category: 'PHYSICAL',
  } });
}

async function baseline(target, actor, version, [likelihood, severity, level]) {
  const { id } = await db.riskAssessment.create({ data: {
    organizationId: target.organizationId, hazardId: target.id, version,
  } });
  const rating = { organizationId: target.organizationId, assessmentId: id, assessedById: actor.id };
  if (version > 1) {
    await db.riskAssessmentRevision.create({ data: {
      ...rating, version: 1, likelihood: 5, severity: 5, score: 25, level: 'CRITICAL',
    } });
  }
  await db.riskAssessmentRevision.create({ data: {
    ...rating, version, likelihood, severity, score: likelihood * severity, level,
  } });
}

function action(target, actor, assignee, status, dueAt = pastDue, createdAt = inRange) {
  const submitted = ['VERIFIED', 'PENDING_VERIFICATION'].includes(status);
  return db.correctiveAction.create({ data: {
    organizationId: target.organizationId, hazardId: target.id, createdById: actor.id,
    assigneeId: assignee.id, status, dueAt, createdAt,
    submittedById: submitted ? assignee.id : null,
    completionDetails: submitted ? 'Synthetic verification evidence.' : null,
    title: 'Dashboard action fixture', description: 'Synthetic action used only in PostgreSQL tests.',
  } });
}

async function residual(target, actor, version, baselineVersion, [likelihood, severity, level], outcome) {
  await db.residualRiskRevision.create({ data: {
    organizationId: target.organizationId, hazardId: target.id, version, baselineVersion,
    assessedById: actor.id, verifiedActionCount: 1, likelihood, severity, score: likelihood * severity,
    level, rationale: 'Synthetic residual-risk evidence for aggregation tests.',
  } });
  if (outcome) await db.hazardClosureDecision.create({ data: {
    organizationId: target.organizationId, hazardId: target.id, residualVersion: version, decidedById: actor.id,
    outcome, rationale: 'Synthetic closure decision for aggregation tests.',
  } });
}

const managerCounts = {
  hazardsByStatus: { REPORTED: 1, UNDER_REVIEW: 1, CONFIRMED: 3, DISMISSED: 1, CLOSED: 1 },
  riskLevels: { LOW: 2, MEDIUM: 1, HIGH: 0, CRITICAL: 1 },
  riskSources: { baseline: 3, residual: 1, unassessed: 3 },
  correctiveActionsByStatus: { OPEN: 2, IN_PROGRESS: 1, PENDING_VERIFICATION: 0, VERIFIED: 3 },
  overdueActions: 2, closedHazards: 1, unresolvedEscalations: 1,
};

describe('Dashboard summary', () => {
  before(async () => {
    if (!env.databaseUrl) return;
    db = await fixtures.connect();
    for (const name of ['main', 'other', 'empty']) {
      const organization = await db.organization.create({
        data: { name, slug: `dashboard-${name}-${fixtures.runId}` },
      });
      fixtures.organizationIds.push(organization.id);
    }
    const [local, foreign, noRecords] = fixtures.organizationIds;
    admin = await user(local, 'ADMIN', 'admin');
    officer = await user(local, 'SAFETY_OFFICER', 'officer');
    reporter = await user(local, 'EMPLOYEE', 'reporter');
    coworker = await user(local, 'EMPLOYEE', 'coworker');
    outsider = await user(foreign, 'ADMIN', 'outsider');
    empty = await user(noRecords, 'ADMIN', 'empty');
    suspended = await user(local, 'ADMIN', 'suspended', 'SUSPENDED');

    const closed = await hazard(reporter, 'CLOSED');
    const staleActions = await hazard(reporter, 'CONFIRMED');
    const staleBaseline = await hazard(coworker, 'CONFIRMED');
    const older = await hazard(coworker, 'CONFIRMED', december);
    const foreignHazard = await hazard(outsider, 'CONFIRMED');
    await hazard(reporter, 'REPORTED', january);
    await hazard(coworker, 'UNDER_REVIEW', february);
    await hazard(coworker, 'DISMISSED', december);

    await baseline(closed, officer, 1, [5, 5, 'CRITICAL']);
    await baseline(staleActions, officer, 1, [5, 5, 'CRITICAL']);
    await baseline(staleBaseline, officer, 2, [2, 4, 'MEDIUM']);
    await baseline(older, officer, 1, [1, 4, 'LOW']);
    await baseline(foreignHazard, outsider, 1, [5, 5, 'CRITICAL']);
    await action(closed, officer, reporter, 'VERIFIED');
    await action(staleActions, officer, coworker, 'VERIFIED');
    await action(staleActions, officer, coworker, 'OPEN');
    await action(staleBaseline, officer, coworker, 'VERIFIED');
    await action(older, officer, reporter, 'IN_PROGRESS');
    await action(older, officer, coworker, 'OPEN', futureDue, february);
    await action(foreignHazard, outsider, outsider, 'PENDING_VERIFICATION');
    await residual(closed, officer, 1, 1, [4, 4, 'HIGH'], 'ESCALATED');
    await residual(closed, admin, 2, 1, [1, 2, 'LOW'], 'NOT_REQUIRED');
    await residual(staleActions, officer, 1, 1, [4, 4, 'HIGH'], 'ESCALATED');
    await residual(staleBaseline, officer, 1, 1, [1, 2, 'LOW']);
  });

  after(fixtures.cleanup);

  test('counts current states, deduplicates risk and falls back when residual risk is stale', options, async () => {
    for (const actor of [admin, officer]) {
      const { body } = await summary(actor).expect('Cache-Control', 'no-store').expect(200);
      assert.equal(body.success, true);
      assert.deepEqual(body.data.range, { from: null, to: null });
      assert.deepEqual(counts(body), managerCounts);
    }
  });

  test('an employee sees only their hazards and actions they own or are assigned', options, async () => {
    const { body } = await summary(reporter).expect(200);
    assert.deepEqual(counts(body), {
      hazardsByStatus: { REPORTED: 1, UNDER_REVIEW: 0, CONFIRMED: 1, DISMISSED: 0, CLOSED: 1 },
      riskLevels: { LOW: 1, MEDIUM: 0, HIGH: 0, CRITICAL: 1 },
      riskSources: { baseline: 1, residual: 1, unassessed: 1 },
      correctiveActionsByStatus: { OPEN: 1, IN_PROGRESS: 1, PENDING_VERIFICATION: 0, VERIFIED: 2 },
      overdueActions: 2, closedHazards: 1, unresolvedEscalations: 1,
    });
    const { body: other } = await summary(coworker).expect(200);
    assert.equal(other.data.closedHazards, 0);
    assert.equal(other.data.unresolvedEscalations, 0);
    assert.equal(other.data.correctiveActionsByStatus.OPEN, 2);
  });

  test('isolates other organizations and preserves all zero buckets for an empty organization', options, async () => {
    const { body } = await summary(outsider).expect(200);
    assert.deepEqual(counts(body), {
      hazardsByStatus: { REPORTED: 0, UNDER_REVIEW: 0, CONFIRMED: 1, DISMISSED: 0, CLOSED: 0 },
      riskLevels: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 1 },
      riskSources: { baseline: 1, residual: 0, unassessed: 0 },
      correctiveActionsByStatus: { OPEN: 0, IN_PROGRESS: 0, PENDING_VERIFICATION: 1, VERIFIED: 0 },
      overdueActions: 1, closedHazards: 0, unresolvedEscalations: 0,
    });
    const { body: zero } = await summary(empty).expect(200);
    const zeroCounts = counts(zero);
    assert.deepEqual(Object.keys(zeroCounts).sort(), Object.keys(managerCounts).sort());
    for (const [metric, value] of Object.entries(zeroCounts)) {
      if (typeof value === 'object') {
        assert.deepEqual(Object.keys(value).sort(), Object.keys(managerCounts[metric]).sort());
        assert.ok(Object.values(value).every((number) => number === 0));
      } else assert.equal(value, 0);
    }
  });

  test('applies inclusive from and exclusive to to each creation cohort', options, async () => {
    const query = '?from=2025-01-01T05:00:00%2B05:00&to=2025-02-01T00:00:00Z';
    const { body } = await summary(admin, query).expect(200);
    assert.deepEqual(body.data.range, { from: january.toISOString(), to: february.toISOString() });
    assert.deepEqual(counts(body), {
      ...managerCounts,
      hazardsByStatus: { REPORTED: 1, UNDER_REVIEW: 0, CONFIRMED: 2, DISMISSED: 0, CLOSED: 1 },
      riskLevels: { LOW: 1, MEDIUM: 1, HIGH: 0, CRITICAL: 1 },
      riskSources: { baseline: 2, residual: 1, unassessed: 1 },
      correctiveActionsByStatus: { OPEN: 1, IN_PROGRESS: 1, PENDING_VERIFICATION: 0, VERIFIED: 3 },
    });
  });

  test('requires eligible authentication and validates dates, bounds and trusted inputs', options, async () => {
    await request(app).get(endpoint).expect(401);
    await summary(suspended).expect(401);
    await summary(admin, '?from=2024-01-01T00:00:00Z&to=2025-01-01T00:00:00Z').expect(200);
    for (const query of [
      '?from=2025-01-01T00:00:00Z', '?to=2025-01-01T00:00:00Z', '?from=abc&to=def',
      '?from=2024-01-01T00:00:00Z&to=2025-01-01T00:00:00.001Z',
      '?from=2025-01-01T00:00:00Z&to=2025-01-01T00:00:00Z',
      '?from=2025-02-01T00:00:00Z&to=2025-01-01T00:00:00Z',
      '?organizationId=other', '?overdueActions=1000',
    ]) await summary(admin, query).expect(400);
  });
});
