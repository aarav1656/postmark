import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

// A judge session is its own signed cookie, never the operator's. It may act only on orders that this
// session paid for through a listing page, and may read DEMO_ORDER_ID.
const cookieName = 'postmark_judge';
const lifetimeSeconds = 8 * 60 * 60;
const sign = (value: string, secret: string) => createHmac('sha256', secret).update(`judge:${value}`).digest('hex');

export function createJudgeCookie(secret: string, secure: boolean, sessionId: string = randomUUID()) {
  const value = `${sessionId}.${Math.floor(Date.now() / 1000) + lifetimeSeconds}`;
  return { sessionId, header: `${cookieName}=${value}.${sign(value, secret)}; Max-Age=${lifetimeSeconds}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}` };
}
export const clearJudgeCookie = (secure: boolean) => `${cookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;

export function judgeSession(cookieHeader: string | undefined, secret: string): string | null {
  if (!cookieHeader || !secret) return null;
  const raw = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const [sessionId, expires, supplied] = raw?.split('.') ?? [];
  if (!sessionId || !expires || !supplied || Number(expires) <= Math.floor(Date.now() / 1000)) return null;
  const expected = Buffer.from(sign(`${sessionId}.${expires}`, secret));
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? sessionId : null;
}

export const bindJudgeOrder = (db: DatabaseSync, sessionId: string, orderId: string) =>
  db.prepare('INSERT OR IGNORE INTO judge_orders(session_id,order_id) VALUES(?,?)').run(sessionId, orderId);
export const judgeOrderIds = (db: DatabaseSync, sessionId: string) =>
  (db.prepare('SELECT order_id FROM judge_orders WHERE session_id=?').all(sessionId) as Array<{ order_id: string }>).map((row) => row.order_id);

// Everything not listed here is operator-only.
export function judgeMay(method: string, path: string, owns: (orderId: string) => boolean, demoOrderId: string | undefined) {
  const read = method === 'GET';
  if (read && ['/api/session', '/api/setup', '/api/events', '/api/judge/orders', '/api/listings'].includes(path)) return true;
  const match = path.match(/^\/api\/(?:orders|labels)\/([^/]+)(\/[a-z-]+)?$/);
  if (!match) return false;
  const id = decodeURIComponent(match[1]);
  const action = `${path.startsWith('/api/labels/') ? 'labels' : 'orders'}${match[2] ?? ''}`;
  const readable = ['orders', 'orders/disputes', 'labels'].includes(action) && read;
  if (readable && (owns(id) || (demoOrderId && id === demoOrderId))) return true;
  const writable = (method === 'POST' && ['orders/label', 'orders/track'].includes(action)) || (read && action === 'orders/sandbox-label');
  return writable && owns(id);
}

// ponytail: in-memory window, resets on restart; persist per session if abuse outlives a deploy.
const uploads = new Map<string, number[]>();
export function takeLabelUpload(sessionId: string, now = Date.now(), limit = 10, windowMs = 60 * 60 * 1000) {
  const recent = (uploads.get(sessionId) ?? []).filter((at) => now - at < windowMs);
  const allowed = recent.length < limit;
  if (allowed) recent.push(now);
  uploads.set(sessionId, recent);
  return allowed;
}
