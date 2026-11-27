import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { disconnectDatabase, getDatabase } from '../../src/config/database.js';
import { env } from '../../src/config/env.js';

const loopbackHosts = new Set(['127.0.0.1', '[::1]', 'localhost']);
const loopbackAddresses = new Set(['127.0.0.1', '::1']);

export function isolatedOrganizations() {
  const runId = randomUUID();
  const organizationIds = [];
  let db;

  async function verifyTarget(client) {
    assert.equal(env.nodeEnv, 'test');
    const url = new URL(env.databaseUrl);
    assert.equal(url.pathname, '/safeops_test');
    assert.ok(loopbackHosts.has(url.hostname), 'Fixtures require a loopback PostgreSQL URL.');
    const [target] = await client.$queryRaw`
      SELECT current_database() AS name, host(inet_server_addr()) AS address
    `;
    assert.equal(target.name, 'safeops_test');
    assert.ok(loopbackAddresses.has(target.address), 'Fixtures require a loopback PostgreSQL connection.');
  }

  return {
    runId,
    organizationIds,
    verifyTarget,
    email: (label) => `${label}@${runId}.example.test`,
    async connect() {
      db = getDatabase();
      await verifyTarget(db);
      return db;
    },
    async cleanup() {
      try {
        if (!organizationIds.length) return;
        await db.$transaction(async (tx) => {
          await verifyTarget(tx);
          const scope = { organizationId: { in: organizationIds } };
          await tx.auditLog.deleteMany({ where: scope });
          await tx.hazardClosureDecision.deleteMany({ where: scope });
          await tx.residualRiskRevision.deleteMany({ where: scope });
          await tx.correctiveActionEvent.deleteMany({ where: scope });
          await tx.correctiveAction.deleteMany({ where: scope });
          await tx.riskAssessmentRevision.deleteMany({ where: scope });
          await tx.riskAssessment.deleteMany({ where: scope });
          await tx.hazard.deleteMany({ where: scope });
          const users = { ...scope, email: { endsWith: `@${runId}.example.test` } };
          await tx.user.updateMany({ where: users, data: { approvedById: null } });
          await tx.user.deleteMany({ where: users });
          await tx.organization.deleteMany({ where: { id: { in: organizationIds } } });
          assert.equal(await tx.organization.count({ where: { id: { in: organizationIds } } }), 0);
        });
      } finally {
        if (db) await disconnectDatabase();
      }
    },
  };
}
