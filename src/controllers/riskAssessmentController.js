import { assessRisk, getRiskAssessment, getRiskAssessments, getRiskHistory, reviseRisk } from '../services/riskAssessmentService.js';
import { sendSuccess } from '../views/jsonResponse.js';

export async function create(req, res) {
  return sendSuccess(res, await assessRisk(req.auth, req.validated.body), 201);
}

export async function list(req, res) {
  return sendSuccess(res, await getRiskAssessments(req.auth, req.validated.query));
}

export async function detail(req, res) {
  return sendSuccess(res, await getRiskAssessment(req.auth, req.validated.params.id));
}

export async function history(req, res) {
  return sendSuccess(res, await getRiskHistory(req.auth, req.validated.params.id, req.validated.query));
}

export async function update(req, res) {
  return sendSuccess(res, await reviseRisk(req.auth, req.validated.params.id, req.validated.body));
}
