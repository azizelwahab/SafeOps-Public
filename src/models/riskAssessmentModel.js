import { getDatabase } from '../config/database.js';

const revisionFields = {
  version: true, assessedById: true, likelihood: true, severity: true, score: true, level: true, createdAt: true,
};
const assessmentFields = {
  id: true, organizationId: true, hazardId: true, version: true, createdAt: true, updatedAt: true,
  revisions: { orderBy: { version: 'desc' }, take: 1, select: revisionFields },
};

export function createAssessment(db, organizationId, hazardId) {
  return db.riskAssessment.create({ data: { organizationId, hazardId } });
}

export function createRevision(db, assessment, assessedById, rating) {
  return db.riskAssessmentRevision.create({
    data: {
      organizationId: assessment.organizationId, assessmentId: assessment.id,
      version: assessment.version, assessedById, ...rating,
    },
    select: revisionFields,
  });
}

export function findAssessment(scope, id, db = getDatabase()) {
  return db.riskAssessment.findUnique({ where: { ...scope, id }, select: assessmentFields });
}

export function listAssessments(db, scope, { page, limit, hazardId }) {
  return db.riskAssessment.findMany({
    where: { ...scope, hazardId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * limit,
    take: limit,
    select: assessmentFields,
  });
}

export function listRevisions(db, organizationId, assessmentId, { page, limit }) {
  return db.riskAssessmentRevision.findMany({
    where: { organizationId, assessmentId },
    orderBy: { version: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
    select: revisionFields,
  });
}

export async function advanceAssessment(db, organizationId, id, version) {
  const [assessment] = await db.riskAssessment.updateManyAndReturn({
    where: { id, organizationId, version },
    data: { version: { increment: 1 } },
  });
  return assessment;
}
