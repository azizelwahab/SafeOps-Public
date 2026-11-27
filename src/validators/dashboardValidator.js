import { z } from 'zod';

const maxRangeMs = 366 * 24 * 60 * 60 * 1000;
const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const dashboardQuerySchema = z.strictObject({
  from: timestamp.optional(),
  to: timestamp.optional(),
}).refine(({ from, to }) => (!from && !to) || (
  from && to && from < to && to - from <= maxRangeMs
));
