import { HazardCategory, HazardStatus } from '@prisma/client';
import { z } from 'zod';
import { paginationFields, recordId } from './queryValidator.js';

const text = (min, max) => z.string().trim().min(min).max(max)
  .refine((value) => value.isWellFormed() && !value.includes('\0'));
const location = text(1, 200);
const dateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const hazardIdSchema = z.strictObject({ id: recordId });
export const createHazardSchema = z.strictObject({
  title: text(1, 160), description: text(1, 4000), category: z.enum(HazardCategory), location,
});
export const editHazardSchema = createHazardSchema.partial().refine((body) => Object.keys(body).length > 0);
export const startReviewSchema = z.strictObject({}).optional();
export const reviewNotesSchema = z.strictObject({
  reviewNotes: text(10, 2000).refine((value) => (value.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3),
});
export const listHazardsSchema = z.strictObject({
  ...paginationFields,
  status: z.enum(HazardStatus).optional(),
  category: z.enum(HazardCategory).optional(),
  location: location.optional(),
  search: text(1, 200).optional(),
  from: dateTime.optional(),
  to: dateTime.optional(),
}).refine(({ from, to }) => !from || !to || from <= to);
