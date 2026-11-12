import { createHmac, timingSafeEqual } from 'node:crypto';

const cookieName = 'postmark_session';
const lifetimeSeconds = 8 * 60 * 60;
const signature = (expires: string, secret: string) => createHmac('sha256', secret).update(expires).digest('hex');

export function hasSession(cookieHeader: string | undefined, secret: string) {
  if (!cookieHeader || !secret) return false;
  const value = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!value) return false;
  const [expires, supplied] = value.split('.');
  if (!expires || !supplied || Number(expires) <= Math.floor(Date.now() / 1000)) return false;
  const expected = signature(expires, secret);
  const actualBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function createSessionCookie(secret: string, secure: boolean) {
  const expires = String(Math.floor(Date.now() / 1000) + lifetimeSeconds);
  return `${cookieName}=${expires}.${signature(expires, secret)}; Max-Age=${lifetimeSeconds}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export const clearSessionCookie = (secure: boolean) => `${cookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
