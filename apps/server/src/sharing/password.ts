import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export interface PasswordDigest {
  salt: string;
  hash: string;
}
export function hashPassword(password: string): PasswordDigest {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, KEY_LENGTH).toString('hex') };
}

export function verifyPassword(password: string, digest: PasswordDigest): boolean {
  const expected = Buffer.from(digest.hash, 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = scryptSync(password, digest.salt, KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}
