import packageMetadata from '../../package.json' with { type: 'json' };
import { sendError, sendSuccess } from '../views/jsonResponse.js';

const application = 'SafeOps';
const { version } = packageMetadata;

export function getApiInfo(healthEndpoint) {
  return (_req, res) => sendSuccess(res, { application, version, healthEndpoint });
}

export function getHealth(_req, res) {
  return sendSuccess(res, {
    application,
    version,
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}

export function getReadiness(checkReadiness) {
  return async (_req, res) => {
    try {
      await checkReadiness();
    } catch {
      return sendError(res, 503, 'DATABASE_UNAVAILABLE', 'The database is unavailable.');
    }
    return sendSuccess(res, { status: 'ready' });
  };
}
