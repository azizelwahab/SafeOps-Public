import { z } from 'zod';

const integerQuery = (max, fallback) => z.string().regex(/^\d+$/)
  .transform(Number).pipe(z.number().int().min(1).max(max)).optional().default(fallback);

export const paginationFields = {
  page: integerQuery(10000, 1),
  limit: integerQuery(100, 20),
};

export const recordId = z.uuid().transform((id) => id.toLowerCase());
