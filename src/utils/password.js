import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { authConfig } from '../config/auth.js';

export function isValidPassword(password) {
  return typeof password === 'string' && password.isWellFormed() &&
    Buffer.byteLength(password, 'utf8') <= 72 && [...password].length >= 12;
}

export function hashPassword(password) {
  if (!isValidPassword(password)) throw new TypeError('Invalid password length.');
  return bcrypt.hash(password, authConfig.bcryptRounds);
}

let dummyHash;

export async function verifyPassword(password, passwordHash) {
  if (!isValidPassword(password)) return false;
  // Both known and unknown accounts perform a comparison at the configured cost.
  dummyHash ??= hashPassword(randomBytes(32).toString('base64url'));
  const fallback = await dummyHash;
  return bcrypt.compare(password, passwordHash ?? fallback);
}
