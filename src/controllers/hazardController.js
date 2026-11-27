import { editHazard, finishReview, getHazard, getHazards, reportHazard, startReview } from '../services/hazardService.js';
import { sendSuccess } from '../views/jsonResponse.js';

export async function create(req, res) {
  return sendSuccess(res, await reportHazard(req.auth, req.validated.body), 201);
}

export async function list(req, res) {
  return sendSuccess(res, await getHazards(req.auth, req.validated.query));
}

export async function detail(req, res) {
  return sendSuccess(res, await getHazard(req.auth, req.validated.params.id));
}

export async function edit(req, res) {
  return sendSuccess(res, await editHazard(req.auth, req.validated.params.id, req.validated.body));
}

export async function review(req, res) {
  return sendSuccess(res, await startReview(req.auth, req.validated.params.id));
}

export function completeReview(outcome) {
  return async (req, res) => {
    const hazard = await finishReview(req.auth, req.validated.params.id, req.validated.body.reviewNotes, outcome);
    return sendSuccess(res, hazard);
  };
}
