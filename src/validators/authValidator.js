import { z } from 'zod';
import { isValidPassword } from '../utils/password.js';

export const name = z.string().trim().min(1).max(100);
export const organizationSlug = z.string().trim().toLowerCase().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const password = z.string().refine(isValidPassword);

export const loginSchema = z.strictObject({ email, password });
export const signupSchema = loginSchema.extend({ name, organizationSlug });
export const bootstrapSchema = signupSchema.extend({ organizationName: name });
