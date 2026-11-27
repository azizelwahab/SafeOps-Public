import { once } from 'node:events';
import { createInterface } from 'node:readline';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { bootstrapAdmin } from '../src/services/authService.js';
import { isValidPassword } from '../src/utils/password.js';
import { isolatedOrganizations } from '../tests/helpers/isolatedOrganizations.js';

const fixtures = isolatedOrganizations();
const password = process.env.SAFEOPS_PORTFOLIO_PASSWORD;
delete process.env.SAFEOPS_PORTFOLIO_PASSWORD;

function requireLocalTarget() {
  const url = URL.parse(env.databaseUrl ?? '');
  if (env.nodeEnv !== 'test' || !url || !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
      url.pathname !== '/safeops_test' || url.search || url.hash) {
    throw new Error('Unexpected portfolio database configuration.');
  }
  return Number(url.port || 5432);
}

async function prepareAccounts() {
  // Reject driver-level URL overrides before the fixture helper opens a connection.
  const port = requireLocalTarget();
  const db = await fixtures.connect();
  const verifyTarget = async (client) => {
    await fixtures.verifyTarget(client);
    const [target] = await client.$queryRaw`SELECT inet_server_port() AS port`;
    if (target.port !== port) throw new Error('Unexpected portfolio database port.');
  };
  await verifyTarget(db);
  const organizationSlug = 'portfolio-' + fixtures.runId;
  const emails = Object.fromEntries(['admin', 'employee', 'officer'].map((role) => [role, fixtures.email(role)]));
  const { organizationId } = await bootstrapAdmin({
    organizationName: 'Portfolio Works', organizationSlug, name: 'Demo Administrator', email: emails.admin, password,
  }, verifyTarget);
  fixtures.organizationIds.push(organizationId);

  const api = request(app);
  const login = await api.post('/api/v1/auth/login').send({ email: emails.admin, password }).expect(200);
  const bearer = 'Bearer ' + login.body.data.accessToken;
  const userIds = {};
  for (const [role, name] of [['employee', 'Demo Employee'], ['officer', 'Demo Safety Officer']]) {
    const email = emails[role];
    await api.post('/api/v1/auth/signup').send({ organizationSlug, email, name, password }).expect(202);
    const user = await db.user.findFirstOrThrow({ where: { email, organizationId }, select: { id: true } });
    userIds[role] = user.id;
    await api.patch('/api/v1/users/' + user.id + '/approve').set('Authorization', bearer).expect(200);
    if (role === 'officer') {
      await api.patch('/api/v1/users/' + user.id + '/role').set('Authorization', bearer).send({ role: 'SAFETY_OFFICER' }).expect(200);
    }
  }
  return { emails, employeeId: userIds.employee };
}

async function run() {
  if (!isValidPassword(password)) {
    console.error('Choose a disposable portfolio password of at least 12 Unicode characters and at most 72 UTF-8 bytes.');
    process.exitCode = 1;
    return;
  }

  const terminal = createInterface({ input: process.stdin });
  const stop = Promise.withResolvers();
  terminal.once('line', stop.resolve);
  terminal.once('close', stop.resolve);
  terminal.on('SIGINT', stop.resolve);
  process.on('SIGINT', stop.resolve);
  process.on('SIGTERM', stop.resolve);

  let server;
  try {
    const { emails, employeeId } = await prepareAccounts();
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    console.log('Portfolio demo: http://127.0.0.1:' + server.address().port + '/app/');
    console.log('Administrator: ' + emails.admin);
    console.log('Employee: ' + emails.employee);
    console.log('Safety Officer: ' + emails.officer);
    console.log('Employee assignment ID: ' + employeeId);
    console.log('Press Enter here to stop and remove this run’s disposable organization and records.');
    await stop.promise;
  } catch {
    console.error('Could not start the portfolio demo. Check the local safeops_test connection and migrations.');
    process.exitCode = 1;
  } finally {
    terminal.close();
    process.off('SIGINT', stop.resolve);
    process.off('SIGTERM', stop.resolve);
    try {
      if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    } finally {
      try {
        await fixtures.cleanup();
        if (fixtures.organizationIds.length) console.log('Removed this run’s portfolio fixtures.');
      } catch {
        console.error('Portfolio cleanup failed. The run was isolated; leave any leftover fixtures in safeops_test.');
        process.exitCode = 1;
      }
    }
  }
}

await run();
