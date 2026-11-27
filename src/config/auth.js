import './env.js';

function integer(name, fallback, min, max) {
  const value = process.env[name] ?? String(fallback);
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

function identifier(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!/^[\x21-\x7e]{1,200}$/.test(value)) throw new Error(`${name} must contain 1 to 200 visible ASCII characters.`);
  return value;
}

const encodedSecret = process.env.JWT_SECRET ?? '';
const secret = Buffer.from(encodedSecret, 'base64url');
if (encodedSecret !== secret.toString('base64url') || secret.length < 32 || new Set(secret).size < 16) {
  throw new Error('JWT_SECRET must encode at least 32 cryptographically random bytes as unpadded base64url.');
}

const lifetime = process.env.JWT_EXPIRES_IN ?? '15m';
const match = /^(\d+)(s|m)?$/.exec(lifetime);
const expiresIn = match ? Number(match[1]) * (match[2] === 'm' ? 60 : 1) : 0;
if (!Number.isSafeInteger(expiresIn) || expiresIn < 60 || expiresIn > 900) {
  throw new Error('JWT_EXPIRES_IN must be between 60 and 900 seconds (for example 15m).');
}

export const authConfig = {
  secret,
  expiresIn,
  issuer: identifier('JWT_ISSUER', 'safeops'),
  audience: identifier('JWT_AUDIENCE', 'safeops-api'),
  bcryptRounds: integer('BCRYPT_ROUNDS', 12, 10, 14),
  rateWindowMs: integer('AUTH_RATE_WINDOW_MS', 900000, 1000, 3600000),
  signupLimit: integer('AUTH_SIGNUP_LIMIT', 10, 1, 1000),
  loginLimit: integer('AUTH_LOGIN_LIMIT', 20, 1, 1000),
};
