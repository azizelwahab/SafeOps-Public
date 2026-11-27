import { approveAccount, changeName, changeRole, getUser, getUsers, rejectAccount, removeUser, restoreAccount, suspendAccount } from '../services/userService.js';
import { sendSuccess } from '../views/jsonResponse.js';

export async function list(req, res) {
  return sendSuccess(res, await getUsers(req.auth, req.validated.query));
}

export async function detail(req, res) {
  return sendSuccess(res, await getUser(req.auth, req.validated.params.id));
}

export async function update(req, res) {
  return sendSuccess(res, await changeName(req.auth, req.validated.params.id, req.validated.body.name));
}

export async function remove(req, res) {
  await removeUser(req.auth, req.validated.params.id);
  return sendSuccess(res, { message: 'The user was deleted.' });
}

export async function approve(req, res) {
  return sendSuccess(res, await approveAccount(req.auth, req.validated.params.id));
}

export async function reject(req, res) {
  return sendSuccess(res, await rejectAccount(req.auth, req.validated.params.id));
}

export async function suspend(req, res) {
  return sendSuccess(res, await suspendAccount(req.auth, req.validated.params.id));
}

export async function restore(req, res) {
  return sendSuccess(res, await restoreAccount(req.auth, req.validated.params.id));
}

export async function role(req, res) {
  return sendSuccess(res, await changeRole(req.auth, req.validated.params.id, req.validated.body.role));
}
