import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';

const file = new URL('../.env', import.meta.url);
const existing = existsSync(file) ? readFileSync(file) : '';
if (!dotenv.parse(existing).JWT_SECRET) {
  appendFileSync(file, `\nJWT_SECRET=${randomBytes(32).toString('base64url')}\n`, { mode: 0o600 });
  console.info('Generated a local signing secret in .env.');
} else {
  console.info('The local signing secret is already configured.');
}
