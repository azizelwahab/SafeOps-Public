import { getDatabase } from '../config/database.js';
import { hasPermission, Permission } from '../config/permissions.js';
import { createAuditLog } from '../models/auditLogModel.js';
import { findUserProfile, listUsers, softDeleteUser, transitionUser, updateUserName, updateUserRole } from '../models/userModel.js';
import { ApiError } from '../utils/apiError.js';

const transitions = {
  approve: {
    from: 'PENDING', to: 'APPROVED', approval: true, action: 'ACCOUNT_APPROVED',
    invalidMessage: 'Only pending accounts can be approved.',
  },
  reject: {
    from: 'PENDING', to: 'REJECTED', excludeAdmin: true, action: 'ACCOUNT_REJECTED',
    invalidMessage: 'Only pending non-administrator accounts can be rejected.',
  },
  suspend: {
    from: 'APPROVED', to: 'SUSPENDED', excludeAdmin: true, revokeTokens: true, action: 'ACCOUNT_SUSPENDED',
    invalidMessage: 'Only approved non-administrator accounts can be suspended.',
  },
  restore: {
    from: 'SUSPENDED', to: 'APPROVED', revokeTokens: true, action: 'ACCOUNT_RESTORED',
    invalidMessage: 'Only suspended accounts can be restored.',
  },
};

function userNotFound() {
  return new ApiError(404, 'USER_NOT_FOUND', 'The user was not found.');
}

async function requireUserAccess(auth, id, permission, db) {
  const user = await findUserProfile(auth.organizationId, id, db);
  if (!user) throw userNotFound();
  if (!hasPermission(auth, permission, user)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission for this operation.');
  }
  return user;
}

export function getUser(auth, id, db) {
  return requireUserAccess(auth, id, Permission.USER_READ, db);
}

export async function getUsers(auth, filters) {
  const users = await listUsers(auth.organizationId, filters);
  return { users, page: filters.page, limit: filters.limit };
}

function auditUserChange(db, auth, id, action, metadata) {
  return createAuditLog(auth.organizationId, {
    actorId: auth.id, action, entityType: 'User', entityId: id, metadata,
  }, db);
}

export function changeName(auth, id, name) {
  return getDatabase().$transaction(async (db) => {
    await requireUserAccess(auth, id, Permission.USER_UPDATE, db);
    const result = await updateUserName(db, auth.organizationId, id, name);
    if (!result.count) throw userNotFound();
    await auditUserChange(db, auth, id, 'USER_PROFILE_UPDATED');
    return getUser(auth, id, db);
  });
}

export function removeUser(auth, id) {
  if (auth.id === id) {
    throw new ApiError(403, 'ADMIN_DELETE_FORBIDDEN', 'Administrator accounts cannot be deleted.');
  }
  return getDatabase().$transaction(async (db) => {
    const { count } = await softDeleteUser(db, auth.organizationId, id);
    if (!count) {
      await getUser(auth, id, db);
      throw new ApiError(403, 'ADMIN_DELETE_FORBIDDEN', 'Administrator accounts cannot be deleted.');
    }
    await auditUserChange(db, auth, id, 'USER_SOFT_DELETED');
  });
}

export function approveAccount(auth, id) {
  if (auth.id === id) throw new ApiError(409, 'INVALID_ACCOUNT_STATE', 'You cannot approve your own account.');
  return changeAccountState(auth, id, transitions.approve);
}

export function rejectAccount(auth, id) {
  return changeAccountState(auth, id, transitions.reject);
}

export function suspendAccount(auth, id) {
  if (auth.id === id) throw new ApiError(409, 'INVALID_ACCOUNT_STATE', 'You cannot suspend your own account.');
  return changeAccountState(auth, id, transitions.suspend);
}

export function restoreAccount(auth, id) {
  return changeAccountState(auth, id, transitions.restore);
}

function changeAccountState(auth, id, transition) {
  return getDatabase().$transaction(async (db) => {
    const { count } = await transitionUser(db, auth.organizationId, id, transition, auth.id);
    if (!count) {
      await getUser(auth, id, db);
      throw new ApiError(409, 'INVALID_ACCOUNT_STATE', transition.invalidMessage);
    }
    await auditUserChange(db, auth, id, transition.action);
    return getUser(auth, id, db);
  });
}

const oppositeRole = new Map([['EMPLOYEE', 'SAFETY_OFFICER'], ['SAFETY_OFFICER', 'EMPLOYEE']]);

export function changeRole(auth, id, role) {
  if (auth.id === id) throw new ApiError(409, 'INVALID_ROLE_CHANGE', 'You cannot change your own role.');
  const previousRole = oppositeRole.get(role);
  if (!previousRole) throw new ApiError(400, 'INVALID_ROLE_CHANGE', 'The requested role is not assignable.');

  return getDatabase().$transaction(async (db) => {
    const { count } = await updateUserRole(db, auth.organizationId, id, previousRole, role);
    if (!count) {
      await getUser(auth, id, db);
      throw new ApiError(409, 'INVALID_ROLE_CHANGE', 'This account is not eligible for the requested role change.');
    }
    await auditUserChange(db, auth, id, 'USER_ROLE_CHANGED', { previousRole, newRole: role });
    return getUser(auth, id, db);
  });
}
