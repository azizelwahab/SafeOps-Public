import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiClient } from '../web/api.js';
import { createSession } from '../web/session.js';
import {
  hazardCapabilities, hazardFilters, renderHazardList, validateHazardForm, validateReviewNotes,
} from '../web/hazards.js';

test('hazard rows render API status, fields and dates as text and open the selected ID', () => {
  const doc = {
    createElement: (tagName) => ({
      tagName, children: [], attributes: {}, events: {},
      append(...children) { this.children.push(...children); },
      addEventListener(event, handler) { this.events[event] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
      set innerHTML(_) { assert.fail('Rendering must use text content.'); },
    }),
  };
  const title = '<img src=x onerror=alert(1)>';
  const hazard = { id: 'hazard-1', title, status: 'UNDER_REVIEW', category: 'FIRE', location: '<Loading bay>', createdAt: '2026-11-25T10:00:00Z' };
  const picked = [];
  const list = renderHazardList(doc, [hazard], (id) => picked.push(id));
  const [[button, status, category, location, time]] = list.children.map((row) => row.children);
  assert.equal(button.textContent, title);
  assert.equal(status.textContent, 'Under review');
  assert.equal(category.textContent, 'Fire');
  assert.equal(location.textContent, '<Loading bay>');
  assert.equal(time.dateTime, hazard.createdAt);
  button.events.click();
  assert.deepEqual(picked, [hazard.id]);
});

test('filters use the real hazard query and pagination bounds', () => {
  assert.deepEqual(hazardFilters({ search: '  loose guard ', status: 'CLOSED', category: 'MECHANICAL', location: ' Bay 2 ' }, 2), {
    search: 'loose guard', status: 'CLOSED', category: 'MECHANICAL', location: 'Bay 2', page: 2, limit: 10,
  });
  assert.deepEqual(hazardFilters({ status: 'invented', category: 'constructor', location: '  ' }, 20_000), { page: 10_000, limit: 10 });
  assert.equal(hazardFilters({}, 0).page, 1);
});

test('hazard forms match backend field rules, including meaningful decision notes', () => {
  const fields = { title: ' Loose guard ', description: 'Fence needs repair', location: ' Yard ', category: 'PHYSICAL' };
  assert.deepEqual(validateHazardForm(fields).data, {
    title: 'Loose guard', description: 'Fence needs repair', location: 'Yard', category: 'PHYSICAL',
  });
  assert.equal(validateHazardForm({ ...fields, title: ' '.repeat(10) }).field, 'title');
  assert.equal(validateHazardForm({ ...fields, description: 'x'.repeat(4001) }).field, 'description');
  assert.equal(validateHazardForm({ ...fields, location: 'Yard\0' }).field, 'location');
  assert.equal(validateHazardForm({ ...fields, category: 'ADMIN' }).field, 'category');
  assert.equal(validateReviewNotes('!!!!!!!!!!!!').field, 'reviewNotes');
  assert.equal(validateReviewNotes('too short').field, 'reviewNotes');
  assert.deepEqual(validateReviewNotes(' Confirmed guard defect. ').data, { reviewNotes: 'Confirmed guard defect.' });
});

test('UI capabilities require tenant scope, ownership, status and investigator role', () => {
  const user = { id: 'employee', organizationId: 'org', role: 'EMPLOYEE' };
  const own = { reportedById: user.id, organizationId: 'org', status: 'REPORTED' };
  const officer = { ...user, id: 'officer', role: 'SAFETY_OFFICER' };
  const admin = { ...officer, role: 'ADMIN' };
  assert.deepEqual(hazardCapabilities(user, own), { edit: true, startReview: false, decide: false });
  assert.equal(hazardCapabilities(user, { ...own, status: 'UNDER_REVIEW' }).edit, false);
  for (const reviewer of [officer, admin]) {
    assert.deepEqual(hazardCapabilities(reviewer, own), { edit: false, startReview: true, decide: false });
    assert.equal(hazardCapabilities(reviewer, { ...own, status: 'UNDER_REVIEW' }).decide, true);
    assert.equal(hazardCapabilities(reviewer, { ...own, status: 'CONFIRMED' }).decide, false);
    assert.equal(hazardCapabilities(reviewer, { ...own, organizationId: 'other' }).startReview, false);
  }
});

test('hazard client uses actual methods and envelopes and expires shared sessions on 401', async () => {
  const calls = [];
  const api = createApiClient(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/dismiss')) return Response.json({ success: false, error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
    return Response.json({ success: true, data: url.endsWith('/login')
      ? { user: { role: 'EMPLOYEE' }, accessToken: 'fixture-token', expiresIn: 60 } : { id: 'fixture-id' } });
  });
  const endings = [];
  const session = createSession(api, { onEnd: (reason) => endings.push(reason) });
  try {
    await session.signIn({});
    await session.loadHazards({ page: 2, limit: 10, search: 'guard panel' });
    await session.loadHazard('fixture-id');
    await session.reportHazard({ title: 'Report' });
    await session.editHazard('fixture-id', { title: 'Edit' });
    await session.startHazardReview('fixture-id');
    await session.confirmHazard('fixture-id', { reviewNotes: 'Confirmed fixture' });
    assert.equal(await session.dismissHazard('fixture-id', { reviewNotes: 'Dismissed fixture' }), null);
    assert.deepEqual(endings, ['expired']);
    assert.deepEqual(calls.filter(({ url }) => url.includes('/hazards')).map(({ url, options }) => [
      url, options.method, options.body && JSON.parse(options.body), options.headers.Authorization,
    ]), [
      ['/api/v1/hazards?page=2&limit=10&search=guard+panel', 'GET', undefined, 'Bearer fixture-token'],
      ['/api/v1/hazards/fixture-id', 'GET', undefined, 'Bearer fixture-token'],
      ['/api/v1/hazards', 'POST', { title: 'Report' }, 'Bearer fixture-token'],
      ['/api/v1/hazards/fixture-id', 'PATCH', { title: 'Edit' }, 'Bearer fixture-token'],
      ['/api/v1/hazards/fixture-id/review', 'PATCH', undefined, 'Bearer fixture-token'],
      ['/api/v1/hazards/fixture-id/confirm', 'PATCH', { reviewNotes: 'Confirmed fixture' }, 'Bearer fixture-token'],
      ['/api/v1/hazards/fixture-id/dismiss', 'PATCH', { reviewNotes: 'Dismissed fixture' }, 'Bearer fixture-token'],
    ]);
  } finally {
    session.end();
  }
});
