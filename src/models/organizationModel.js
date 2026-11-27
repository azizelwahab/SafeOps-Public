import { getDatabase } from '../config/database.js';

export function createOrganization({ name, slug }, db = getDatabase()) {
  return db.organization.create({ data: { name, slug } });
}

export function findOrganizationBySlug(slug) {
  return getDatabase().organization.findUnique({ where: { slug }, select: { id: true } });
}

export function findOrganizationById(organizationId) {
  return getDatabase().organization.findUnique({ where: { id: organizationId } });
}
