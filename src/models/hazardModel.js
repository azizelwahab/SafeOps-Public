import { getDatabase } from '../config/database.js';

const hazardFields = {
  id: true, organizationId: true, reportedById: true, reviewedById: true,
  title: true, description: true, category: true, location: true, status: true,
  reviewNotes: true, reviewedAt: true, createdAt: true, updatedAt: true,
};

function literalSearch(value) {
  return { contains: value.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' };
}

export function createHazard(db, { organizationId, reportedById }, { title, description, category, location }) {
  return db.hazard.create({
    data: { organizationId, reportedById, title, description, category, location, status: 'REPORTED' },
    select: hazardFields,
  });
}

export function findHazard(scope, id, db = getDatabase()) {
  return db.hazard.findUnique({ where: { ...scope, id }, select: hazardFields });
}

// Writers that change a hazard's closure prerequisites acquire this lock first.
export async function lockHazard(db, organizationId, id) {
  const [hazard] = await db.$queryRaw`
    SELECT status::text AS status FROM "Hazard"
    WHERE "organizationId" = ${organizationId}::uuid AND id = ${id}::uuid
    FOR UPDATE
  `;
  return hazard;
}

export function listHazards(scope, { page, limit, status, category, location, search, from, to }) {
  return getDatabase().hazard.findMany({
    where: {
      ...scope, status, category,
      location: location ? literalSearch(location) : undefined,
      createdAt: from || to ? { gte: from, lte: to } : undefined,
      OR: search ? [{ title: literalSearch(search) }, { description: literalSearch(search) }] : undefined,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * limit,
    take: limit,
    select: hazardFields,
  });
}

export async function updateHazard(db, scope, id, status, data) {
  // PostgreSQL rechecks the status predicate when a competing update releases the row.
  const [hazard] = await db.hazard.updateManyAndReturn({
    where: { ...scope, id, status }, data, select: hazardFields,
  });
  return hazard;
}
