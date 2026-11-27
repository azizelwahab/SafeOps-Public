import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiClient } from '../web/api.js';
import { canWriteRisk, renderRevision, riskPayload, riskSaveError, scoreText } from '../web/risk.js';

test('risk display uses the server score and level across the four bands', () => {
  for (const [level, score, label] of [
    ['LOW', 4, 'Low'], ['MEDIUM', 9, 'Medium'], ['HIGH', 16, 'High'], ['CRITICAL', 25, 'Critical'],
  ]) {
    assert.equal(scoreText({ likelihood: 1, severity: 1, score, level }), `${label} · ${score}/25`);
  }
});

test('risk input validates integer ratings and only sends API fields with the loaded version', () => {
  const values = { likelihood: '1', severity: '5', hazardId: 'selected', version: '99', score: 25 };
  assert.deepEqual(riskPayload(values), { likelihood: 1, severity: 5, hazardId: 'selected' });
  assert.deepEqual(riskPayload(values, { version: 4 }), { likelihood: 1, severity: 5, version: 4 });
  for (const likelihood of ['', '0', '6', '2.5', '2e0']) assert.throws(() => riskPayload({ ...values, likelihood }), RangeError);
  assert.throws(() => riskPayload({ ...values, hazardId: '' }), /confirmed hazard/);
  assert.throws(() => riskPayload(values, { version: 2147483647 }), /Reload/);
});

test('risk write controls are restricted to officers and admins on confirmed hazards', () => {
  for (const role of ['SAFETY_OFFICER', 'ADMIN']) {
    assert.equal(canWriteRisk({ role }), true);
    assert.equal(canWriteRisk({ role }, { status: 'CONFIRMED' }), true);
    assert.equal(canWriteRisk({ role }, { status: 'CLOSED' }), false);
  }
  for (const role of ['EMPLOYEE', 'UNKNOWN', undefined]) assert.equal(canWriteRisk({ role }), false);
});

test('risk history renders API revision fields as text', () => {
  const doc = { createElement: () => ({ append(...children) { this.children = children; } }) };
  const row = renderRevision(doc, {
    version: 2, score: 20, level: 'CRITICAL', likelihood: 4, severity: 5, createdAt: '2026-11-25T12:00:00Z', assessedById: '<literal>',
  }, (value) => value);
  assert.deepEqual(row.children.map(({ textContent }) => textContent), [
    'Version 2 · Critical · 20/25', 'Likelihood 4 · Severity 5', '2026-11-25T12:00:00Z', 'Assessor ID <literal>',
  ]);
});

test('risk client sends paginated history and versioned updates and exposes an explicit reload on stale writes', async () => {
  const requests = [];
  const client = createApiClient(async (path, options) => {
    requests.push([path, options]);
    if (options.method === 'PATCH') return Response.json({ error: { code: 'STALE_RISK_ASSESSMENT' } }, { status: 409 });
    return Response.json({ success: true, data: { revisions: [], page: 2, limit: 10 } });
  });
  await client.assessmentHistory('token', 'record', { page: 2, limit: 10 });
  assert.equal(requests[0][0], '/api/v1/risk-assessments/record/history?page=2&limit=10');
  await assert.rejects(client.updateAssessment('token', 'record', { version: 1, likelihood: 5 }), (error) => {
    assert.equal(riskSaveError(error).reload, true);
    assert.match(riskSaveError(error).message, /Reload the latest/);
    return true;
  });
  assert.deepEqual(JSON.parse(requests[1][1].body), { version: 1, likelihood: 5 });
  assert.equal(requests.length, 2);
  assert.match(riskSaveError({ status: 409, code: 'RISK_ASSESSMENT_EXISTS' }).message, /already/);
});
