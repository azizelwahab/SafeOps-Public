import { getDatabase } from '../config/database.js';
import { authConfig } from '../config/auth.js';
import { createAuditLog } from '../models/auditLogModel.js';
import { createOrganization, findOrganizationBySlug } from '../models/organizationModel.js';
import { createInitialAdmin, createUser, findLoginCredentials, findUserProfile } from '../models/userModel.js';
import { ApiError } from '../utils/apiError.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signAccessToken } from '../utils/token.js';

export async function registerEmployee({ organizationSlug, name, email, password }) {
  const organization = await findOrganizationBySlug(organizationSlug);
  if (!organization) throw new ApiError(404, 'ORGANIZATION_NOT_FOUND', 'The organization was not found.');
  const passwordHash = await hashPassword(password);
  const duplicateEmail = new Error('Registration already exists.');

  try {
    await getDatabase().$transaction(async (db) => {
      const user = await createUser(organization.id, { name, email, passwordHash }, db).catch((error) => {
        if (error.code === 'P2002') throw duplicateEmail;
        throw error;
      });
      await createAuditLog(organization.id, {
        action: 'EMPLOYEE_REGISTERED', entityType: 'User', entityId: user.id,
      }, db);
    });
  } catch (error) {
    if (error !== duplicateEmail) throw error;
  }
}

const invalidCredentials = () => new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

export async function login({ email, password }) {
  const credentials = await findLoginCredentials(email);
  const matches = await verifyPassword(password, credentials?.passwordHash);
  if (!matches || credentials?.status !== 'APPROVED') throw invalidCredentials();

  const user = await findUserProfile(credentials.organizationId, credentials.id);
  if (user?.status !== 'APPROVED') throw invalidCredentials();

  await createAuditLog(user.organizationId, {
    actorId: user.id, action: 'LOGIN_SUCCEEDED', entityType: 'User', entityId: user.id,
  });
  return {
    accessToken: signAccessToken(credentials), tokenType: 'Bearer', expiresIn: authConfig.expiresIn, user,
  };
}

export async function bootstrapAdmin({ organizationName, organizationSlug, name, email, password }, verifyDatabase) {
  const passwordHash = await hashPassword(password);
  return getDatabase().$transaction(async (db) => {
    await verifyDatabase(db);
    const organization = await createOrganization({ name: organizationName, slug: organizationSlug }, db);
    const admin = await createInitialAdmin(organization.id, { name, email, passwordHash }, db);
    await createAuditLog(organization.id, {
      actorId: admin.id, action: 'ORGANIZATION_BOOTSTRAPPED', entityType: 'Organization', entityId: organization.id,
    }, db);
    await createAuditLog(organization.id, {
      actorId: admin.id, action: 'ADMIN_CREATED', entityType: 'User', entityId: admin.id,
    }, db);
    return { organizationId: organization.id, administratorId: admin.id };
  });
}
