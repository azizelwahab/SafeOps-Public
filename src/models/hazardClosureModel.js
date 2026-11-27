export async function lockDecisionActor(db, organizationId, id) {
  const [actor] = await db.$queryRaw`
    SELECT role::text AS role, status::text AS status, "authVersion", "deletedAt"
    FROM "User" WHERE "organizationId" = ${organizationId}::uuid AND id = ${id}::uuid
    FOR SHARE
  `;
  return actor;
}

export function findBaseline(db, organizationId, hazardId) {
  return db.riskAssessment.findUnique({
    where: { organizationId_hazardId: { organizationId, hazardId } },
    select: { version: true },
  });
}

export function countCorrectiveActionsByStatus(db, organizationId, hazardId) {
  return db.correctiveAction.groupBy({
    by: ['status'], where: { organizationId, hazardId }, _count: { _all: true },
  });
}

export function listResidualRevisions(db, organizationId, hazardId, { page, limit }) {
  return db.residualRiskRevision.findMany({
    where: { organizationId, hazardId },
    orderBy: { version: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });
}

export function createResidualRevision(db, data) {
  return db.residualRiskRevision.create({ data });
}

export function findClosureDecision(db, organizationId, hazardId, residualVersion) {
  return db.hazardClosureDecision.findFirst({
    where: { organizationId, hazardId, residualVersion },
    orderBy: { residualVersion: 'desc' },
  });
}

export function createClosureDecision(db, data) {
  return db.hazardClosureDecision.create({ data });
}
