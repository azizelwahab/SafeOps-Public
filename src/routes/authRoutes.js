import { json, Router } from 'express';
import { authConfig } from '../config/auth.js';
import { loginUser, me, signup } from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';
import { authRateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { loginSchema, signupSchema } from '../validators/authValidator.js';

export function createAuthRouter() {
  const router = Router();
  const parseBody = json({ limit: '8kb' });

  router.post('/signup', authRateLimit(authConfig.signupLimit), parseBody, validate(signupSchema), signup);
  router.post('/login', authRateLimit(authConfig.loginLimit), parseBody, validate(loginSchema), loginUser);
  router.get('/me', authenticate, me);
  return router;
}
