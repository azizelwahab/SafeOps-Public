import { z } from 'zod';
import { paginationFields } from './queryValidator.js';

const rating = z.number().int().min(1).max(5);
const rationale = z.string().trim().min(10).max(4000)
  .refine((value) => value.isWellFormed() && !value.includes('\0') &&
    (value.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3);

export const residualRiskSchema = z.strictObject({
  version: z.number().int().min(0).max(2147483646),
  likelihood: rating,
  severity: rating,
  rationale,
});
export const residualHistorySchema = z.strictObject(paginationFields);
export const closureSchema = z.strictObject({
  residualVersion: z.number().int().min(1).max(2147483647),
  rationale,
  decision: z.enum(['ACCEPTED', 'ESCALATED']).optional(),
});
