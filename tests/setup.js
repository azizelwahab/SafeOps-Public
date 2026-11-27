import { randomBytes } from 'node:crypto';

// Select the dedicated test configuration before any application modules load.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = randomBytes(32).toString('base64url');
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_ISSUER = 'safeops-test';
process.env.JWT_AUDIENCE = 'safeops-test-api';
process.env.BCRYPT_ROUNDS = '10';
process.env.AUTH_RATE_WINDOW_MS = '900000';
process.env.AUTH_SIGNUP_LIMIT = '10';
process.env.AUTH_LOGIN_LIMIT = '20';
