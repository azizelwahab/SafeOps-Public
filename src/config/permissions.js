import { UserRole } from '@prisma/client';

export const Permission = Object.freeze({
  USER_LIST: 'user:list',
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_APPROVE: 'user:approve',
  USER_REJECT: 'user:reject',
  USER_SUSPEND: 'user:suspend',
  USER_RESTORE: 'user:restore',
  USER_CHANGE_ROLE: 'user:change-role',
  AUDIT_READ: 'audit:read',
  HAZARD_REPORT: 'hazard:report',
  HAZARD_READ: 'hazard:read',
  HAZARD_READ_ALL: 'hazard:read-all',
  HAZARD_EDIT: 'hazard:edit',
  HAZARD_INVESTIGATE: 'hazard:investigate',
  RISK_ASSESSMENT_WRITE: 'risk-assessment:write',
  CORRECTIVE_ACTION_PARTICIPATE: 'corrective-action:participate',
  CORRECTIVE_ACTION_MANAGE: 'corrective-action:manage',
  HAZARD_CLOSE: 'hazard:close',
  HAZARD_ACCEPT_RISK: 'hazard:accept-risk',
});

const { ADMIN, EMPLOYEE, SAFETY_OFFICER } = UserRole;
const profilePolicy = { roles: [ADMIN], ownerRoles: [EMPLOYEE, SAFETY_OFFICER] };
const adminPolicy = { roles: [ADMIN] };
const hazardParticipantPolicy = { roles: [EMPLOYEE, SAFETY_OFFICER, ADMIN] };
const hazardInvestigatorPolicy = { roles: [SAFETY_OFFICER, ADMIN] };
const policies = new Map([
  [Permission.USER_LIST, adminPolicy],
  [Permission.USER_READ, profilePolicy],
  [Permission.USER_UPDATE, profilePolicy],
  [Permission.USER_DELETE, adminPolicy],
  [Permission.USER_APPROVE, adminPolicy],
  [Permission.USER_REJECT, adminPolicy],
  [Permission.USER_SUSPEND, adminPolicy],
  [Permission.USER_RESTORE, adminPolicy],
  [Permission.USER_CHANGE_ROLE, adminPolicy],
  [Permission.AUDIT_READ, adminPolicy],
  [Permission.HAZARD_REPORT, hazardParticipantPolicy],
  [Permission.HAZARD_READ, hazardParticipantPolicy],
  [Permission.HAZARD_READ_ALL, hazardInvestigatorPolicy],
  [Permission.HAZARD_EDIT, hazardParticipantPolicy],
  [Permission.HAZARD_INVESTIGATE, hazardInvestigatorPolicy],
  [Permission.RISK_ASSESSMENT_WRITE, hazardInvestigatorPolicy],
  [Permission.CORRECTIVE_ACTION_PARTICIPATE, hazardParticipantPolicy],
  [Permission.CORRECTIVE_ACTION_MANAGE, hazardInvestigatorPolicy],
  [Permission.HAZARD_CLOSE, hazardInvestigatorPolicy],
  [Permission.HAZARD_ACCEPT_RISK, adminPolicy],
]);

// Use authenticated identity and, when applicable, a resource loaded from the database.
export function hasPermission(auth, permission, resource) {
  const policy = policies.get(permission);
  if (!auth?.id || !auth.organizationId || !policy) return false;
  if (policy.ownerRoles && !resource) return false;
  if (resource && resource.organizationId !== auth.organizationId) return false;
  return policy.roles.includes(auth.role) ||
    (resource?.id === auth.id && policy.ownerRoles?.includes(auth.role) === true);
}
