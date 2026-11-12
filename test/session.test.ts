import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSessionCookie, createSessionCookie, hasSession } from '../server/session.ts';

describe('signed access session', () => {
  afterEach(() => vi.useRealTimers());
  it('accepts an untampered, unexpired cookie for the configured password', () => {
    const cookie = createSessionCookie('a private password', false).split(';')[0];
    expect(hasSession(cookie, 'a private password')).toBe(true);
  });
  it('rejects a cookie signed with a different password', () => {
    const cookie = createSessionCookie('a private password', false).split(';')[0];
    expect(hasSession(cookie, 'another private password')).toBe(false);
  });
  it('rejects a modified signature and expired cookie', () => {
    const cookie = createSessionCookie('a private password', false).split(';')[0];
    const [name, value] = cookie.split('=');
    const [expires, signature] = value.split('.');
    expect(hasSession(`${name}=${expires}.${signature.slice(1)}`, 'a private password')).toBe(false);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 9 * 60 * 60 * 1000);
    expect(hasSession(cookie, 'a private password')).toBe(false);
  });
  it('clears the cookie and marks production sessions Secure', () => {
    expect(clearSessionCookie(true)).toContain('Secure');
    expect(createSessionCookie('a private password', true)).toContain('HttpOnly; SameSite=Strict; Secure');
  });
});
