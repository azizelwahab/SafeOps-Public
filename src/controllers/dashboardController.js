import { getDashboardSummary } from '../services/dashboardService.js';
import { sendSuccess } from '../views/jsonResponse.js';

export async function summary(req, res) {
  return sendSuccess(res, await getDashboardSummary(req.auth, req.validated.query));
}
