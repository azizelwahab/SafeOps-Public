import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closureOutcome } from '../src/services/hazardClosurePolicy.js';
import { closureSchema, residualRiskSchema } from '../src/validators/hazardClosureValidator.js';

const rationale = 'Controls were inspected and the remaining exposure was documented.';

test('closure policy requires explicit high-risk decisions and administrator acceptance', () => {
  for (const level of ['LOW', 'MEDIUM']) {
    assert.equal(closureOutcome(level, undefined, false), 'NOT_REQUIRED');
    assert.throws(() => closureOutcome(level, 'ACCEPTED', true), { status: 409, code: 'RISK_DECISION_NOT_APPLICABLE' });
  }
  for (const level of ['HIGH', 'CRITICAL']) {
    assert.throws(() => closureOutcome(level, undefined, true), { status: 409, code: 'RISK_DECISION_REQUIRED' });
    assert.throws(() => closureOutcome(level, 'ACCEPTED', false), { status: 403, code: 'RISK_ACCEPTANCE_FORBIDDEN' });
    assert.equal(closureOutcome(level, 'ACCEPTED', true), 'ACCEPTED');
    assert.equal(closureOutcome(level, 'ESCALATED', false), 'ESCALATED');
  }
});

test('residual risk and closure validators reject invalid ratings, versions and injected fields', () => {
  const residual = { version: 0, likelihood: 1, severity: 5, rationale };
  assert.equal(residualRiskSchema.safeParse(residual).success, true);
  for (const invalid of [
    { likelihood: 6 }, { severity: '1' }, { severity: 1.2 }, { version: -1 },
    { rationale: '!!!!!!!!!!' }, { score: 5 }, { assessedById: 'injected' },
  ]) {
    assert.equal(residualRiskSchema.safeParse({ ...residual, ...invalid }).success, false);
  }
  const close = { residualVersion: 1, rationale };
  assert.equal(closureSchema.safeParse(close).success, true);
  for (const invalid of [
    { residualVersion: 0 }, { decision: 'NOT_REQUIRED' }, { status: 'CLOSED' },
    { decidedById: 'injected' }, { rationale: 'too short' },
  ]) {
    assert.equal(closureSchema.safeParse({ ...close, ...invalid }).success, false);
  }
});
