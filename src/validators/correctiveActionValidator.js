import { CorrectiveActionStatus } from '@prisma/client';
import { z } from 'zod';
import { paginationFields, recordId } from './queryValidator.js';

const text = (min, max) => z.string().trim().min(min).max(max)
  .refine((value) => value.isWellFormed() && !value.includes('\0'));
const explanation = text(10, 4000).refine((value) => (value.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3);
const version = z.number().int().min(1).max(2147483646);
const plan = {
  title: text(1, 160),
  description: text(1, 4000),
  assigneeId: recordId,
  dueAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
};

export const actionIdSchema = z.strictObject({ id: recordId });
export const createActionSchema = z.strictObject({ hazardId: recordId, ...plan });
export const editActionSchema = z.strictObject({ ...plan, workNotes: text(1, 4000) }).partial()
  .extend({ version }).refine((body) => Object.keys(body).length > 1);
export const actionVersionSchema = z.strictObject({ version });
export const submitActionSchema = z.strictObject({ version, completionDetails: explanation });
export const returnActionSchema = z.strictObject({ version, reason: explanation });
export const actionHistorySchema = z.strictObject(paginationFields);
export const listActionsSchema = z.strictObject({
  ...paginationFields, hazardId: recordId.optional(), assigneeId: recordId.optional(),
  status: z.enum(CorrectiveActionStatus).optional(),
  overdue: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});
