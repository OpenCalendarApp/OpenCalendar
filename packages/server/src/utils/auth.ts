import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import type { JwtPayload } from '@calendar-genie/shared';

const USER_PASSWORD_COST = 12;
const PROJECT_PASSWORD_COST = 10;
const AUTH_TOKEN_EXPIRY = '24h';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }

  return secret;
}

export async function hashUserPassword(plainTextPassword: string): Promise<string> {
  return bcrypt.hash(plainTextPassword, USER_PASSWORD_COST);
}

export async function hashProjectPassword(plainTextPassword: string): Promise<string> {
  return bcrypt.hash(plainTextPassword, PROJECT_PASSWORD_COST);
}

export async function verifyPassword(
  plainTextPassword: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(plainTextPassword, hashedPassword);
}

export function createAuthToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: AUTH_TOKEN_EXPIRY });
}

export function verifyAuthToken(token: string): JwtPayload {
  return jwt.verify(token, getJwtSecret()) as JwtPayload;
}
