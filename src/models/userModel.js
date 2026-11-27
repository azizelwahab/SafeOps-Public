import { getDatabase } from '../config/database.js';

const profileFields = {
  id: true, organizationId: true, name: true, email: true, role: true, status: true,
  approvedAt: true, approvedById: true, createdAt: true, updatedAt: true,
};

export function createUser(organizationId, { name, email, passwordHash }, db = getDatabase()) {
  // Registration-shaped writes accept only these fields. The database supplies role and status.
  return db.user.create({
    data: { organizationId, name, email: email.trim().toLowerCase(), passwordHash },
  });
}

export function createInitialAdmin(organizationId, { name, email, passwordHash }, db) {
  return db.user.create({
    data: {
      organizationId, name, email: email.trim().toLowerCase(), passwordHash,
      role: 'ADMIN', status: 'APPROVED', approvedAt: new Date(),
    },
  });
}

export function findLoginCredentials(email) {
  return getDatabase().user.findUnique({
    where: { email: email.trim().toLowerCase(), deletedAt: null },
    select: { id: true, organizationId: true, status: true, authVersion: true, passwordHash: true },
  });
}

export function findUserProfile(organizationId, id, db = getDatabase()) {
  return db.user.findUnique({
    where: { organizationId_id: { organizationId, id }, deletedAt: null },
    select: { ...profileFields, organization: { select: { id: true, name: true, slug: true } } },
  });
}

export function listUsers(organizationId, { page, limit, status, role, search }) {
  // Prisma's contains maps to ILIKE. Escape wildcard characters for literal substring search.
  const contains = search?.replace(/[\\%_]/g, '\\$&');
  return getDatabase().user.findMany({
    where: {
      organizationId, deletedAt: null, status, role,
      OR: search ? [{ name: { contains, mode: 'insensitive' } }, { email: { contains, mode: 'insensitive' } }] : undefined,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * limit,
    take: limit,
    select: profileFields,
  });
}

export function updateUserName(db, organizationId, id, name) {
  return db.user.updateMany({
    where: { organizationId, id, deletedAt: null },
    data: { name },
  });
}

export function softDeleteUser(db, organizationId, id) {
  return db.user.updateMany({
    where: { organizationId, id, deletedAt: null, role: { not: 'ADMIN' } },
    data: { deletedAt: new Date() },
  });
}

export function transitionUser(db, organizationId, id, { from, to, excludeAdmin, approval, revokeTokens }, actorId) {
  // PostgreSQL rechecks these predicates after waiting for a concurrent row update.
  return db.user.updateMany({
    where: { organizationId, id, deletedAt: null, status: from, role: excludeAdmin ? { not: 'ADMIN' } : undefined },
    data: {
      status: to,
      approvedAt: approval ? new Date() : undefined,
      approvedById: approval ? actorId : undefined,
      authVersion: revokeTokens ? { increment: 1 } : undefined,
    },
  });
}

export function findUserById(organizationId, id) {
  return getDatabase().user.findUnique({ where: { organizationId_id: { organizationId, id }, deletedAt: null } });
}

export function updateUserRole(db, organizationId, id, previousRole, role) {
  return db.user.updateMany({
    where: { organizationId, id, deletedAt: null, status: 'APPROVED', role: previousRole },
    data: { role },
  });
}
