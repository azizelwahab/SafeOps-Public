import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiClient } from '../web/api.js';
import { closureFailure, closureManager, closurePayload, closureReadiness, residualPayload, verifiedActionEvidence } from '../web/closure.js';

const hazard = { status: 'CONFIRMED', organizationId: 'site' };
const officer = { role: 'SAFETY_OFFICER', organizationId: 'site' };
const admin = { ...officer, role: 'ADMIN' };
const baseline = { version: 2 };
const evidence = { count: 3, verified: true };
const residual = { version: 4, level: 'LOW', baselineVersion: 2, verifiedActionCount: 3 };
const form = { likelihood: '2', severity: '3', rationale: ' Guards secured and verified. ', score: 25, version: 999 };

test('residual form requires integer ratings and meaningful rationale and uses version zero for creation', () => {
  assert.deepEqual(residualPayload(form), { version: 0, likelihood: 2, severity: 3, rationale: 'Guards secured and verified.' });
  assert.equal(residualPayload(form, residual).version, 4);
  for (const likelihood of ['0', '6', '2.5', '2e0', '']) assert.throws(() => residualPayload({ ...form, likelihood }), /ratings/);
  for (const rationale of [' short ', '!?!!???a!!', 'Vali\0d reason', 'a'.repeat(4001)]) {
    assert.throws(() => residualPayload({ ...form, rationale }), /rationale/);
  }
  assert.throws(() => residualPayload(form, { version: 2147483647 }), /Reload/);
});

test('closure readiness checks confirmation, baseline, all actions, and current residual evidence', () => {
  assert.deepEqual(closureReadiness(officer, hazard, baseline, evidence, residual, null).decisions, ['close']);
  for (const [risk, actions] of [[null, evidence], [residual, { count: 0, verified: false }], [residual, { count: 1, verified: false }]]) {
    assert.deepEqual(closureReadiness(officer, hazard, baseline, actions, risk, null).decisions, []);
  }
  assert.equal(closureReadiness(officer, hazard, null, evidence, residual, null).canAssess, false);
  assert.equal(closureReadiness(officer, hazard, { version: 3 }, evidence, residual, null).current, false);
  assert.equal(closureReadiness(officer, hazard, baseline, { ...evidence, count: 4 }, residual, null).current, false);
});

test('high and critical risks require explicit escalation or administrator acceptance', () => {
  for (const level of ['HIGH', 'CRITICAL']) {
    const high = { ...residual, level };
    assert.deepEqual(closureReadiness(officer, hazard, baseline, evidence, high, null).decisions, ['escalate']);
    assert.deepEqual(closureReadiness(admin, hazard, baseline, evidence, high, null).decisions, ['escalate', 'accept']);
    const escalated = { outcome: 'ESCALATED', residualVersion: high.version };
    assert.equal(closureReadiness(admin, hazard, baseline, evidence, high, escalated).canAssess, true);
    assert.deepEqual(closureReadiness(admin, hazard, baseline, evidence, high, escalated).decisions, []);
    assert.deepEqual(closureReadiness(admin, hazard, baseline, evidence, { ...high, version: 5 }, escalated).decisions, ['escalate', 'accept']);
  }
  assert.deepEqual(closurePayload(form, residual, 'close'), { residualVersion: 4, rationale: 'Guards secured and verified.' });
  assert.equal(closurePayload(form, residual, 'escalate').decision, 'ESCALATED');
  assert.equal(closurePayload(form, residual, 'accept').decision, 'ACCEPTED');
});

test('closed hazards are terminal and employee or out-of-organization identities have no mutation controls', () => {
  const employee = { role: 'EMPLOYEE', organizationId: 'site' };
  assert.equal(closureManager(employee, hazard), false);
  assert.equal(closureManager({ ...admin, organizationId: 'other' }, hazard), false);
  for (const [user, record] of [[employee, hazard], [admin, { ...hazard, status: 'CLOSED' }], [admin, { ...hazard, status: 'UNDER_REVIEW' }]]) {
    const view = closureReadiness(user, record, baseline, evidence, residual, null);
    assert.equal(view.canAssess, false);
    assert.deepEqual(view.decisions, []);
  }
});

test('closure readiness follows API pages and stops at the first incomplete action', async () => {
  const pages = [
    { actions: [{ id: 'a', status: 'VERIFIED' }, { id: 'b', status: 'VERIFIED' }], limit: 2 },
    { actions: [{ id: 'c', status: 'VERIFIED' }], limit: 2 },
  ];
  assert.deepEqual(await verifiedActionEvidence((page) => pages[page - 1]), { count: 3, verified: true });
  assert.deepEqual(await verifiedActionEvidence(() => ({ actions: [], limit: 100 })), { count: 0, verified: false });
  const loaded = [];
  const incomplete = await verifiedActionEvidence((page) => {
    loaded.push(page);
    return { actions: [{ id: 'open', status: 'OPEN' }], limit: 1 };
  });
  assert.deepEqual(loaded, [1]);
  assert.equal(incomplete.verified, false);
});

test('residual and closure requests use actual API paths and a 409 requires explicit reload', async () => {
  const calls = [];
  const client = createApiClient(async (path, options) => {
    calls.push({ path, method: options.method, body: options.body });
    return options.method === 'PATCH'
      ? Response.json({ error: { code: 'STALE_RESIDUAL_RISK' } }, { status: 409 })
      : Response.json({ success: true, data: { revisions: [] } });
  });
  await client.residualHistory('token', 'hazard', { page: 2, limit: 10 });
  await client.recordResidual('token', 'hazard', residualPayload(form));
  await assert.rejects(client.decideClosure('token', 'hazard', closurePayload(form, residual, 'close')), (error) => {
    assert.match(closureFailure(error).message, /Reload closure data/);
    return closureFailure(error).reload;
  });
  assert.equal(calls[0].path, '/api/v1/hazards/hazard/residual-risk/history?page=2&limit=10');
  assert.equal(calls[1].method, 'POST');
  assert.equal(JSON.parse(calls[1].body).version, 0);
  assert.equal(calls[2].path, '/api/v1/hazards/hazard/close');
  assert.equal(JSON.parse(calls[2].body).residualVersion, 4);
  assert.equal(calls.length, 3);
  assert.match(closureFailure({ status: 409, code: 'CLOSURE_ALREADY_DECIDED' }).message, /fresh residual revision/);
});
