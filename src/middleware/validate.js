import { sendError } from '../views/jsonResponse.js';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'The request contains invalid or unexpected fields.');
    }
    req.validated ??= {};
    req.validated[source] = parsed.data;
    next();
  };
}
