import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';
import { sendError } from '../views/jsonResponse.js';

export function notFound(_req, res) {
  return sendError(res, 404, 'NOT_FOUND', 'The requested route was not found.');
}

export function handleError(error, _req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof ApiError) {
    return sendError(res, error.status, error.code, error.message);
  }

  const status = error.status ?? error.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return sendError(res, status, 'REQUEST_ERROR', 'The request could not be processed.');
  }

  // Driver and parser errors can include submitted values. Log a fixed message.
  if (env.nodeEnv !== 'test') {
    console.error('An unexpected request error occurred.');
  }
  return sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}
