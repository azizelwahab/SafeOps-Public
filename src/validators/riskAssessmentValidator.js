import { z } from 'zod';
import { paginationFields, recordId } from './queryValidator.js';

const rating = z.number().int().min(1).max(5);
export const assessmentIdSchema = z.strictObject({ id: recordId });
export const createAssessmentSchema = z.strictObject({ hazardId: recordId, likelihood: rating, severity: rating });
export const updateAssessmentSchema = z.strictObject({
  version: z.number().int().min(1).max(2147483646),
  likelihood: rating.optional(),
  severity: rating.optional(),
}).refine(({ likelihood, severity }) => likelihood !== undefined || severity !== undefined);
export const listAssessmentsSchema = z.strictObject({ ...paginationFields, hazardId: recordId.optional() });
export const assessmentHistorySchema = z.strictObject(paginationFields);
