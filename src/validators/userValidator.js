import { z } from 'zod';
import { AccountStatus, UserRole } from '@prisma/client';
import { name } from './authValidator.js';
import { paginationFields, recordId } from './queryValidator.js';

export const userIdSchema = z.strictObject({ id: recordId });
export const updateUserSchema = z.strictObject({ name });
export const updateRoleSchema = z.strictObject({ role: z.enum(['EMPLOYEE', 'SAFETY_OFFICER']) });
export const listUsersSchema = z.strictObject({
  ...paginationFields,
  status: z.enum(AccountStatus).optional(),
  role: z.enum(UserRole).optional(),
  search: z.string().trim().min(1).max(254).optional(),
});
export const emptyBodySchema = z.strictObject({}).optional();
