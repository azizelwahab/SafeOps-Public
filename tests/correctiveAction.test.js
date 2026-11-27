import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transitionAction } from '../src/services/correctiveActionWorkflow.js';
import { createActionSchema, editActionSchema, listActionsSchema, returnActionSchema, submitActionSchema } from '../src/validators/correctiveActionValidator.js';

const assigneeId = 'c8ed8df0-cf5c-4e5c-a814-e7480540bbeb';
const hazardId = 'ec1e86e4-f6e8-440e-8fef-0cc90a2bbc82';
const verifier = 'verifier';

test('corrective action state rules permit exactly the documented transitions', () => {
  const rules = [
    ['STARTED', 'OPEN', 'IN_PROGRESS'], ['SUBMITTED', 'IN_PROGRESS', 'PENDING_VERIFICATION'],
    ['VERIFIED', 'PENDING_VERIFICATION', 'VERIFIED'], ['RETURNED', 'PENDING_VERIFICATION', 'IN_PROGRESS'],
  ];
  for (const [kind, from, to] of rules) {
    for (const status of ['OPEN', 'IN_PROGRESS', 'PENDING_VERIFICATION', 'VERIFIED']) {
      const action = { status, assigneeId, submittedById: assigneeId };
      const change = () => transitionAction(action, kind, verifier, {});
      if (status === from) assert.equal(change().data.status, to);
      else assert.throws(change, { status: 409, code: 'INVALID_CORRECTIVE_ACTION_STATE' });
    }
  }
});

test('verification rules deny the assignee and a different submitter', () => {
  const action = { status: 'PENDING_VERIFICATION', assigneeId, submittedById: 'submitter' };
  for (const actor of [assigneeId, 'submitter']) {
    assert.throws(() => transitionAction(action, 'VERIFIED', actor, {}), { status: 403, code: 'SELF_VERIFICATION_FORBIDDEN' });
  }
});

test('corrective action schemas reject protected fields, malformed dates and missing mutation details', () => {
  const input = { hazardId, assigneeId, title: '  Fix guard  ', description: 'Install a replacement guard.', dueAt: '2026-11-25T18:00:00+05:00' };
  const parsed = createActionSchema.parse(input);
  assert.equal(parsed.title, 'Fix guard');
  assert.equal(parsed.dueAt.toISOString(), '2026-11-25T13:00:00.000Z');
  assert.equal(createActionSchema.safeParse({ ...input, dueAt: '2026-11-25' }).success, false);
  for (const field of ['organizationId', 'createdById', 'status', 'metadata']) {
    assert.equal(createActionSchema.safeParse({ ...input, [field]: 'injected' }).success, false);
  }
  assert.equal(editActionSchema.safeParse({ version: 1 }).success, false);
  assert.equal(editActionSchema.safeParse({ version: '1', workNotes: 'Working' }).success, false);
  assert.equal(editActionSchema.safeParse({ version: 0, workNotes: 'Working' }).success, false);
  assert.equal(submitActionSchema.safeParse({ version: 1 }).success, false);
  assert.equal(returnActionSchema.safeParse({ version: 1, reason: '!!!!!!!!!!' }).success, false);
});

test('overdue filters distinguish false from omitted and reject invalid values', () => {
  assert.equal(listActionsSchema.parse({}).overdue, undefined);
  assert.equal(listActionsSchema.parse({ overdue: 'false' }).overdue, false);
  assert.equal(listActionsSchema.parse({ overdue: 'true' }).overdue, true);
  assert.equal(listActionsSchema.safeParse({ overdue: '1' }).success, false);
  assert.equal(listActionsSchema.safeParse({ limit: '101' }).success, false);
});
