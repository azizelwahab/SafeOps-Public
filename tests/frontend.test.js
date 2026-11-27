import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import app from '../src/app.js';
import { ApiError, createApiClient } from '../web/api.js';
import { dashboardNavigation, dashboardStats, dateRange } from '../web/dashboard.js';
import { readPage } from '../web/pagination.js';
import { accountActions } from '../web/user-view.js';

test('user management is admin-only and actions mirror account eligibility', () => {
  const admin = { id: 'actor', role: 'ADMIN', organizationId: 'org' };
  const employee = { id: 'target', role: 'EMPLOYEE', organizationId: 'org', status: 'PENDING' };
  assert.deepEqual(accountActions(admin, employee), ['approve', 'reject']);
  assert.deepEqual(accountActions(admin, { ...employee, status: 'APPROVED' }), ['suspend', 'role']);
  assert.deepEqual(accountActions(admin, { ...employee, status: 'SUSPENDED' }), ['restore']);
  for (const account of [{ ...employee, status: 'REJECTED' },
    { ...employee, status: 'APPROVED', role: 'ADMIN' }, { ...employee, id: 'actor' },
    { ...employee, organizationId: 'other' }]) assert.deepEqual(accountActions(admin, account), []);
  for (const role of ['EMPLOYEE', 'SAFETY_OFFICER']) {
    assert.deepEqual(accountActions({ ...admin, role }, employee), []);
    assert.equal(dashboardNavigation(role).some(({ target }) => target === 'user-management'), false);
  }
  assert.equal(dashboardNavigation('ADMIN').some(({ target }) => target === 'user-management'), true);
});

test('onboarding and management use the existing API contracts', async () => {
  const requests = [];
  const api = createApiClient(async (path, options) => {
    requests.push({ path, ...options });
    return Response.json({ success: true, data: {} }, { status: 200 });
  });
  const signup = { name: 'Fixture', email: 'employee@example.test', organizationSlug: 'fixture', password: 'fixture-only-password' };
  await api.signup(signup);
  await api.listUsers('fixture-token', { page: 1, limit: 10, status: 'PENDING' });
  await api.changeUser('fixture-token', 'target', 'approve');
  await api.changeUser('fixture-token', 'target', 'role', { role: 'SAFETY_OFFICER' });
  await api.changeUser('fixture-token', 'target', 'restore');
  assert.deepEqual(requests.map(({ method, path }) => [method, path]), [
    ['POST', '/api/v1/auth/signup'], ['GET', '/api/v1/users?page=1&limit=10&status=PENDING'],
    ['PATCH', '/api/v1/users/target/approve'], ['PATCH', '/api/v1/users/target/role'],
    ['PATCH', '/api/v1/users/target/restore'],
  ]);
  assert.equal(requests[0].headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(requests[0].body), signup);
  assert.equal(requests[2].body, undefined);
  assert.deepEqual(JSON.parse(requests[3].body), { role: 'SAFETY_OFFICER' });
  assert.equal(requests[4].body, undefined);
});

test('advancing past a full last page reuses the previous page and preserves its records', async () => {
  const requested = [];
  const rows = [{ id: 'visible' }];
  const page = await readPage(async (index) => {
    requested.push(index);
    return { page: index, rows: index === 1 ? rows : [] };
  }, (result) => result.rows, 2, true, () => true);
  assert.deepEqual(page, { result: { page: 1, rows }, end: true });
  assert.deepEqual(requested, [2, 1]);
});

test('pagination neither backtracks on an empty filter result nor starts a fallback after the view is stale', async () => {
  const requested = [];
  const load = async (page) => { requested.push(page); return { page, rows: [] }; };
  assert.deepEqual(await readPage(load, (result) => result.rows, 1, false, () => true),
    { result: { page: 1, rows: [] }, end: false });
  assert.equal(await readPage(load, (result) => result.rows, 2, true, () => false), null);
  assert.deepEqual(requested, [1, 2]);
});
import { createSession } from '../web/session.js';

test('Express serves the frontend under /app without changing the API information route', async () => {
  await request(app).get('/?next=https://example.test').expect(302).expect('Location', '/app/');
  await request(app).get('/app').expect(301).expect('Location', '/app/');
  const page = await request(app).get('/app/').expect(200).expect('Content-Type', /text\/html/);
  assert.match(page.text, /<form id="login-form" method="post">/);
  assert.match(page.text, /id="navigation-toggle" type="button" aria-expanded="false" aria-controls="sidebar-menu"/);
  assert.match(page.text, /id="sidebar-menu" class="sidebar-menu"/);
  assert.match(page.text, /id="signup-form" method="post" hidden aria-label="Request an account"/);
  assert.match(page.text, /type="module" src="\.\/app\.js"/);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  await request(app).get('/app/app.js').expect(200).expect('Content-Type', /javascript/);
  await request(app).get('/app/styles.css').expect(200).expect('Content-Type', /text\/css/);
  await request(app).get('/app/.env').expect(404);
  await request(app).get('/api/v1').expect(200).expect('Content-Type', /application\/json/);
});

test('shared client uses current API envelopes and sends the token only on authenticated calls', async () => {
  const calls = [];
  const api = createApiClient(async (url, options) => {
    calls.push({ url, options });
    return Response.json({ success: true, data: { marker: true } });
  });
  const credentials = { email: 'employee@example.test', password: 'fixture-only-password' };
  assert.deepEqual(await api.login(credentials), { marker: true });
  await api.profile('fixture-token');
  await api.dashboard('fixture-token', { from: '2026-01-01T00:00:00Z', to: '2026-01-03T00:00:00Z' });
  assert.equal(calls[0].url, '/api/v1/auth/login');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), credentials);
  assert.equal(calls[1].url, '/api/v1/auth/me');
  assert.equal(calls[2].url, '/api/v1/dashboard/summary?from=2026-01-01T00%3A00%3A00Z&to=2026-01-03T00%3A00%3A00Z');
  for (const { options } of calls.slice(1)) {
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
  }
  const broken = createApiClient(async () => Response.json({
    success: false, error: { code: 'INVALID_CREDENTIALS' },
  }, { status: 401 }));
  await assert.rejects(broken.login(credentials), { status: 401, code: 'INVALID_CREDENTIALS' });
});

function sessionFixture(overrides = {}) {
  let currentTime = 1000;
  let timer;
  const notifications = [];
  const user = { name: 'Employee', role: 'EMPLOYEE' };
  const session = createSession({
    login: async () => ({ accessToken: 'fixture-token', expiresIn: 60, user }),
    profile: async () => user,
    dashboard: async () => ({ summary: true }),
    ...overrides,
  }, {
    onEnd: (reason) => notifications.push(reason),
    now: () => currentTime,
    schedule: (callback) => { timer = callback; return 1; },
    cancel: () => { timer = null; },
  });
  return {
    session, notifications, user,
    setTime: (time) => { currentTime = time; },
    timer: () => timer,
  };
}

test('session expires by timer or API authorization failure and drops authenticated data', async () => {
  const timed = sessionFixture();
  assert.deepEqual(await timed.session.signIn({}), timed.user);
  assert.deepEqual(await timed.session.loadDashboard(), { user: timed.user, data: { summary: true } });
  timed.setTime(61_000);
  timed.timer()();
  assert.deepEqual(timed.notifications, ['expired']);
  assert.equal(await timed.session.loadDashboard(), null);

  const revoked = sessionFixture({ profile: async () => { throw new ApiError(401); } });
  await revoked.session.signIn({});
  assert.equal(await revoked.session.loadDashboard(), null);
  assert.deepEqual(revoked.notifications, ['expired']);
  assert.equal(revoked.timer(), null);
});

test('dashboard errors can be retried and a response arriving after sign-out is ignored', async () => {
  const finished = Promise.withResolvers();
  let attempts = 0;
  const { session, notifications } = sessionFixture({
    dashboard: async () => {
      if (++attempts === 1) throw new ApiError(500);
      return finished.promise;
    },
  });
  await session.signIn({});
  await assert.rejects(session.loadDashboard(), { status: 500 });
  assert.deepEqual(notifications, []);
  const pending = session.loadDashboard();
  session.end();
  finished.resolve({ sensitiveDashboardData: true });
  assert.equal(await pending, null);
  assert.deepEqual(notifications, ['signed-out']);
});

test('navigation, summary totals and date range formatting reflect the dashboard contract', () => {
  assert.ok(dashboardNavigation('EMPLOYEE').some(({ label }) => label === 'My hazards'));
  assert.ok(!dashboardNavigation('EMPLOYEE').some(({ target }) => target === 'escalations'));
  assert.ok(dashboardNavigation('SAFETY_OFFICER').some(({ target }) => target === 'escalations'));
  assert.ok(dashboardNavigation('ADMIN').some(({ target }) => target === 'closures'));
  assert.deepEqual(dashboardStats({ hazardsByStatus: { REPORTED: 2, CLOSED: 1 }, correctiveActionsByStatus: { VERIFIED: 4 } }),
    { hazards: 3, actions: 4, empty: false });
  assert.equal(dashboardStats({ hazardsByStatus: { REPORTED: 0 }, correctiveActionsByStatus: { OPEN: 0 } }).empty, true);
  assert.deepEqual(dateRange('2026-11-25', '2026-11-25'), { from: '2026-11-25T00:00:00.000Z', to: '2026-11-26T00:00:00.000Z' });
  assert.equal(dateRange('', ''), null);
  for (const [from, to] of [['2026-11-25', ''], ['2026-11-26', '2026-11-25'], ['2025-01-01', '2026-02-01'], ['2026-02-30', '2026-03-02']]) {
    assert.throws(() => dateRange(from, to), RangeError);
  }
});
