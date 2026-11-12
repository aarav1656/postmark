import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(join(tmpdir(), 'postmark-judge-role-'));
const keys = ['DATA_DIR', 'APP_PASSWORD', 'JUDGE_PASSWORD', 'DEMO_MODE', 'PAYPAL_ENV', 'DEMO_ORDER_ID', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'] as const;
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
for (const key of keys) delete process.env[key];
Object.assign(process.env, { DATA_DIR: dataDir, APP_PASSWORD: 'owner-test-password', DEMO_MODE: '1', PAYPAL_ENV: 'sandbox', DEMO_ORDER_ID: 'DEMO-ORDER' });
const [{ app }, { db }, session, judge] = await Promise.all([import('../server/app.ts'), import('../server/db.ts'), import('../server/session.ts'), import('../server/judge.ts')]);
const operator = session.createSessionCookie('owner-test-password', false).split(';')[0];

afterAll(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

for (const id of ['OWN-ORDER', 'OTHER-ORDER', 'DEMO-ORDER']) {
  db.prepare("INSERT INTO orders(id,capture_id,status,amount_cents,currency,protection_state) VALUES(?,?,'COMPLETED',6800,'USD','UNSHIPPED')").run(id, `CAP-${id}`);
}
const enter = async () => {
  const response = await app.request('/api/session/judge', { method: 'POST' });
  expect(response.status).toBe(200);
  return (response.headers.get('set-cookie') ?? '').split(';')[0];
};
const as = (cookie: string, path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), cookie } });
const post = (cookie: string, path: string, body: unknown = {}) => as(cookie, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('judge role', () => {
  it('is a separate session, never the operator session', async () => {
    const cookie = await enter();
    expect(session.hasSession(cookie, 'owner-test-password')).toBe(false);
    expect(judge.judgeSession(cookie, 'owner-test-password')).toBeTruthy();
    expect(await (await as(cookie, '/api/session')).json()).toMatchObject({ authenticated: true, role: 'judge' });
  });

  it('gets 403 on the order list and on another order, while the operator gets through', async () => {
    const cookie = await enter();
    expect((await as(cookie, '/api/orders')).status).toBe(403);
    expect((await post(cookie, '/api/orders/OTHER-ORDER/track', { acceptRisk: true })).status).toBe(403);
    expect((await as(cookie, '/api/orders/OTHER-ORDER')).status).toBe(403);
    expect((await as(cookie, '/api/labels/OTHER-ORDER')).status).toBe(403);
    expect((await as(operator, '/api/orders')).status).toBe(200);
    expect((await post(operator, '/api/orders/OTHER-ORDER/track', { acceptRisk: true })).status).not.toBe(403);
  });

  it('rejects every operator-only route', async () => {
    const cookie = await enter();
    judge.bindJudgeOrder(db, judge.judgeSession(cookie, 'owner-test-password')!, 'OWN-ORDER');
    expect((await post(cookie, '/api/orders/OWN-ORDER/archive', { archived: true })).status).toBe(403);
    expect((await post(cookie, '/api/orders/import', { orderId: 'OTHER-ORDER' })).status).toBe(403);
    expect((await as(cookie, '/api/disputes')).status).toBe(403);
    expect((await post(cookie, '/api/disputes/PP-D-1/evidence')).status).toBe(403);
    expect((await post(cookie, '/api/disputes/PP-D-1/sandbox/adjudicate')).status).toBe(403);
    expect((await post(cookie, '/api/disputes/reconcile')).status).toBe(403);
    expect((await as(cookie, '/api/listings', { method: 'POST', body: new FormData() })).status).toBe(403);
  });

  it('acts on orders its own session bought and only reads DEMO_ORDER_ID', async () => {
    const cookie = await enter();
    const other = await enter();
    judge.bindJudgeOrder(db, judge.judgeSession(cookie, 'owner-test-password')!, 'OWN-ORDER');
    expect((await as(cookie, '/api/orders/OWN-ORDER')).status).toBe(200);
    expect((await as(other, '/api/orders/OWN-ORDER')).status).toBe(403);
    expect((await as(cookie, '/api/orders/DEMO-ORDER')).status).toBe(200);
    expect((await post(cookie, '/api/orders/DEMO-ORDER/track', { acceptRisk: true })).status).toBe(403);
    expect((await as(cookie, '/api/orders/DEMO-ORDER/sandbox-label')).status).toBe(403);
    const mine = await (await as(cookie, '/api/judge/orders')).json() as Array<{ id: string; read_only: boolean }>;
    expect(mine.map((order) => [order.id, order.read_only]).sort()).toEqual([['DEMO-ORDER', true], ['OWN-ORDER', false]]);
  });

  it('limits label uploads to 10 an hour per judge session', async () => {
    const cookie = await enter();
    judge.bindJudgeOrder(db, judge.judgeSession(cookie, 'owner-test-password')!, 'OWN-ORDER');
    const upload = () => as(cookie, '/api/orders/OWN-ORDER/label', { method: 'POST', body: new FormData() });
    for (let n = 0; n < 10; n++) expect((await upload()).status).not.toBe(429);
    expect((await upload()).status).toBe(429);
    expect((await as(operator, '/api/orders/OWN-ORDER/label', { method: 'POST', body: new FormData() })).status).not.toBe(429);
  });

  it('turns JUDGE_PASSWORD into the judge role, not the operator', async () => {
    process.env.JUDGE_PASSWORD = 'judge-test-password';
    const response = await app.request('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'judge-test-password' }) });
    delete process.env.JUDGE_PASSWORD;
    const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
    expect(response.status).toBe(200);
    expect(session.hasSession(cookie, 'owner-test-password')).toBe(false);
    expect((await as(cookie, '/api/orders')).status).toBe(403);
  });
});
