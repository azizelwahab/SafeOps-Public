import { z } from 'zod';
import { paginationFields, recordId } from './queryValidator.js';

const eventLabel = z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_:-]*$/);
const dateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const auditLogIdSchema = z.strictObject({ id: recordId });
export const listAuditLogsSchema = z.strictObject({
  ...paginationFields,
  action: eventLabel.optional(),
  entityType: eventLabel.optional(),
  actorId: recordId.optional(),
  from: dateTime.optional(),
  to: dateTime.optional(),
}).refine(({ from, to }) => !from || !to || from <= to);
