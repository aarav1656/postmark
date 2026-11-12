import { randomUUID } from 'node:crypto';
import { db } from '../server/db.ts';

export class PayPalError extends Error {
  readonly status: number;
  readonly debugId: string | null;
  constructor(message: string, status: number, debugId: string | null) {
    super(message); this.name = 'PayPalError'; this.status = status; this.debugId = debugId;
  }
}

const base = () => process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error(`Missing PayPal configuration: ${[!id && 'PAYPAL_CLIENT_ID', !secret && 'PAYPAL_CLIENT_SECRET'].filter(Boolean).join(', ')}`);
  const response = await fetch(`${base()}/v1/oauth2/token`, {
    method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials', signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new PayPalError(`PayPal OAuth failed (${response.status})`, response.status, response.headers.get('paypal-debug-id'));
  const token = await response.json() as { access_token: string; expires_in: number };
  cachedToken = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  return token.access_token;
}

export async function paypal<T>(path: string, init: RequestInit = {}, requestId?: string): Promise<T> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (requestId) headers.set('PayPal-Request-Id', requestId);
  const response = await fetch(`${base()}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const debugId = response.headers.get('paypal-debug-id');
    // PayPal error bodies carry name, message and details[].issue; never headers or tokens.
    const body = await response.json().catch(() => null) as { name?: string; message?: string; details?: Array<{ issue?: string; field?: string }> } | null;
    const issues = (body?.details ?? []).map((detail) => [detail.issue, detail.field].filter(Boolean).join(' at ')).filter(Boolean);
    console.error('PayPal request failed', { status: response.status, debugId, path, name: body?.name ?? null, message: body?.message ?? null, issues });
    const reason = [body?.name, ...issues].filter(Boolean).join(': ');
    throw new PayPalError(`PayPal request failed (${response.status})${reason ? ` ${reason}` : ''}${debugId ? `, debug ${debugId}` : ''}`, response.status, debugId);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export function beginOperation(id: string, kind: string) {
  const existing = db.prepare('SELECT request_id, entity_id, state FROM paypal_operations WHERE id=?').get(id) as { request_id: string; entity_id: string | null; state: string } | undefined;
  if (existing?.state === 'succeeded') return { requestId: existing.request_id, entityId: existing.entity_id, done: true };
  const requestId = existing?.request_id ?? randomUUID();
  db.prepare(`INSERT INTO paypal_operations(id,kind,request_id,state) VALUES(?,?,?,'pending')
    ON CONFLICT(id) DO UPDATE SET state='pending',error=NULL,updated_at=CURRENT_TIMESTAMP`).run(id, kind, requestId);
  return { requestId, entityId: existing?.entity_id ?? null, done: false };
}

export function finishOperation(id: string, entityId: string) {
  db.prepare("UPDATE paypal_operations SET state='succeeded',entity_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(entityId, id);
}
export function failOperation(id: string, error: unknown) {
  db.prepare("UPDATE paypal_operations SET state='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(error instanceof Error ? error.message : String(error), id);
}
