import { login, registerEmployee } from '../services/authService.js';
import { getUser } from '../services/userService.js';
import { sendSuccess } from '../views/jsonResponse.js';

export async function signup(req, res) {
  await registerEmployee(req.validated.body);
  return sendSuccess(res, { message: 'If eligible, your registration is pending administrator approval.' }, 202);
}

export async function loginUser(req, res) {
  const data = await login(req.validated.body);
  res.set('Cache-Control', 'no-store');
  return sendSuccess(res, data);
}

export async function me(req, res) {
  return sendSuccess(res, await getUser(req.auth, req.auth.id));
}
