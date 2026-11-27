import {
  decideHazardClosure, getClosureDecision, getResidualRisk, getResidualRiskHistory, recordResidualRisk,
} from '../services/hazardClosureService.js';
import { sendSuccess } from '../views/jsonResponse.js';

export async function createResidual(req, res) {
  return sendSuccess(res, await recordResidualRisk(req.auth, req.validated.params.id, req.validated.body), 201);
}

export async function residual(req, res) {
  return sendSuccess(res, await getResidualRisk(req.auth, req.validated.params.id));
}

export async function residualHistory(req, res) {
  return sendSuccess(res, await getResidualRiskHistory(req.auth, req.validated.params.id, req.validated.query));
}

export async function closure(req, res) {
  return sendSuccess(res, await getClosureDecision(req.auth, req.validated.params.id));
}

export async function close(req, res) {
  return sendSuccess(res, await decideHazardClosure(req.auth, req.validated.params.id, req.validated.body));
}
