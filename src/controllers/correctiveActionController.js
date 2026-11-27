import {
  editCorrectiveAction, getCorrectiveAction, getCorrectiveActionHistory, getCorrectiveActions,
  moveCorrectiveAction, openCorrectiveAction,
} from '../services/correctiveActionService.js';
import { sendSuccess } from '../views/jsonResponse.js';

export async function create(req, res) {
  return sendSuccess(res, await openCorrectiveAction(req.auth, req.validated.body), 201);
}

export async function list(req, res) {
  return sendSuccess(res, await getCorrectiveActions(req.auth, req.validated.query));
}

export async function detail(req, res) {
  return sendSuccess(res, await getCorrectiveAction(req.auth, req.validated.params.id));
}

export async function history(req, res) {
  return sendSuccess(res, await getCorrectiveActionHistory(req.auth, req.validated.params.id, req.validated.query));
}

export async function edit(req, res) {
  return sendSuccess(res, await editCorrectiveAction(req.auth, req.validated.params.id, req.validated.body));
}

export function transition(kind) {
  return async (req, res) => sendSuccess(res,
    await moveCorrectiveAction(req.auth, req.validated.params.id, kind, req.validated.body));
}
