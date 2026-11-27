import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { bootstrapAdmin } from '../src/services/authService.js';
import { createApiClient } from '../web/api.js';
import { createSession } from '../web/session.js';
import { isolatedOrganizations } from './helpers/isolatedOrganizations.js';

test('web client signs in over HTTP and loads real role-scoped dashboard data', {
  skip: env.databaseUrl ? false : 'TEST_DATABASE_URL is unset',
}, async () => {
  const fixtures = isolatedOrganizations();
  const server = app.listen(0, '127.0.0.1');
  const sessions = [];
  try {
    await once(server, 'listening');
    const db = await fixtures.connect();
    const password = randomBytes(24).toString('base64url');
    const roles = ['admin', 'employee'];
    const ids = [];
    for (const role of roles) {
      const { organizationId, administratorId } = await bootstrapAdmin({
        email: fixtures.email(role), password, organizationSlug: `frontend-${role}-${fixtures.runId}`,
        organizationName: 'Frontend test workspace', name: role,
      }, fixtures.verifyTarget);
      fixtures.organizationIds.push(organizationId);
      ids.push(administratorId);
    }
    await db.user.update({ where: { id: ids[1] }, data: { role: 'EMPLOYEE' } });
    await db.hazard.create({ data: {
      organizationId: fixtures.organizationIds[0], reportedById: ids[0], title: 'Frontend test hazard',
      description: 'Synthetic record used to verify dashboard rendering inputs.', category: 'PHYSICAL', location: 'Fixture',
    } });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const web = await fetch(origin + '/app/');
    assert.equal(web.status, 200);
    assert.match(await web.text(), /Operational dashboard/);
    const api = createApiClient((url, options) => fetch(origin + url, options));

    for (const [index, role] of roles.entries()) {
      const endings = [];
      const session = createSession(api, { onEnd: (reason) => endings.push(reason) });
      sessions.push(session);
      const profile = await session.signIn({ email: fixtures.email(role), password });
      assert.equal(profile.role, role.toUpperCase());
      const dashboard = await session.loadDashboard();
      assert.equal(dashboard.user.id, ids[index]);
      assert.equal(dashboard.data.hazardsByStatus.REPORTED, index === 0 ? 1 : 0);
      if (role === 'employee') {
        await db.user.update({ where: { id: ids[index] }, data: { status: 'SUSPENDED', authVersion: { increment: 1 } } });
        assert.equal(await session.loadDashboard(), null);
        assert.deepEqual(endings, ['expired']);
      }
    }
  } finally {
    for (const session of sessions) session.end();
    try {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    } finally {
      await fixtures.cleanup();
    }
  }
});
