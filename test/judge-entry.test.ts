import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(join(tmpdir(), 'postmark-judge-'));
const keys = ['DATA_DIR', 'APP_PASSWORD', 'JUDGE_PASSWORD', 'DEMO_MODE', 'PAYPAL_ENV', 'DEMO_LISTING_ID', 'DEMO_BUYER_EMAIL'] as const;
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
process.env.DATA_DIR = dataDir;
process.env.APP_PASSWORD = 'owner-test-password';
for (const key of ['JUDGE_PASSWORD', 'DEMO_MODE', 'PAYPAL_ENV', 'DEMO_LISTING_ID', 'DEMO_BUYER_EMAIL'] as const) delete process.env[key];
const [{ app }, { db }, { createSessionCookie, hasSession }] = await Promise.all([import('../server/app.ts'), import('../server/db.ts'), import('../server/session.ts')]);
const ownerCookie = createSessionCookie('owner-test-password', false).split(';')[0];

afterEach(() => { for (const key of ['JUDGE_PASSWORD', 'DEMO_MODE', 'PAYPAL_ENV', 'DEMO_LISTING_ID', 'DEMO_BUYER_EMAIL'] as const) delete process.env[key]; });
afterAll(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

const signIn = (password: string) => app.request('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
const entry = async () => (await app.request('/api/public/entry')).json() as Promise<{ demoMode: boolean; judgePassword: boolean; demoBuyerEmail: string | null; demoListing: { id: string; title: string } | null }>;
const cookieFrom = (response: Response) => (response.headers.get('set-cookie') ?? '').split(';')[0];
const createListing = async (title: string) => {
  const form = new FormData();
  form.append('photo', new File([await sharp({ create: { width: 800, height: 600, channels: 3, background: '#8a6d4b' } }).png().toBuffer()], 'item.png', { type: 'image/png' }));
  form.append('title', title); form.append('price', '42.00'); form.append('description', 'Ships boxed.');
  const response = await app.request('/api/listings', { method: 'POST', headers: { cookie: ownerCookie }, body: form });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ id: string }>;
};

describe('public entry and judge access', () => {
  it('keeps the current password-only behaviour when no judge env is set', async () => {
    expect(await entry()).toMatchObject({ demoMode: false, judgePassword: false, demoBuyerEmail: null, demoListing: null });
    expect((await app.request('/api/session/judge', { method: 'POST' })).status).toBe(404);
    expect((await signIn('judge-guess')).status).toBe(401);
    expect((await app.request('/api/orders')).status).toBe(401);
    expect((await signIn('owner-test-password')).status).toBe(200);
  });

  it('accepts JUDGE_PASSWORD as a second password and issues a judge session, not the operator one', async () => {
    process.env.JUDGE_PASSWORD = 'judge-test-password';
    expect((await entry()).judgePassword).toBe(true);
    const response = await signIn('judge-test-password');
    expect(response.status).toBe(200);
    const cookie = cookieFrom(response);
    expect(hasSession(cookie, 'owner-test-password')).toBe(false);
    expect((await app.request('/api/orders', { headers: { cookie } })).status).toBe(403);
    expect((await signIn('judge-test-passwor')).status).toBe(401);
  });

  it('offers one-click judge entry only when DEMO_MODE=1 on sandbox', async () => {
    process.env.DEMO_MODE = '1';
    process.env.DEMO_BUYER_EMAIL = 'buyer@example.com';
    expect(await entry()).toMatchObject({ demoMode: true, demoBuyerEmail: 'buyer@example.com' });
    const response = await app.request('/api/session/judge', { method: 'POST' });
    expect(response.status).toBe(200);
    expect((await app.request('/api/orders', { headers: { cookie: cookieFrom(response) } })).status).toBe(403);
    await expect((await app.request('/api/session', { headers: { cookie: cookieFrom(response) } })).json()).resolves.toMatchObject({ role: 'judge' });

    process.env.PAYPAL_ENV = 'live';
    expect((await entry()).demoMode).toBe(false);
    expect((await app.request('/api/session/judge', { method: 'POST' })).status).toBe(404);

    process.env.PAYPAL_ENV = 'sandbox'; process.env.DEMO_MODE = 'true';
    expect((await app.request('/api/session/judge', { method: 'POST' })).status).toBe(404);
  });

  it('links the landing to a listing that resolves: pinned DEMO_LISTING_ID, else the newest', async () => {
    const first = await createListing('Folding film camera');
    const second = await createListing('Brass parcel scale');
    expect((await entry()).demoListing?.id).toBe(second.id);
    process.env.DEMO_LISTING_ID = first.id;
    expect((await entry()).demoListing?.id).toBe(first.id);
    process.env.DEMO_LISTING_ID = 'missing-listing';
    const fallback = (await entry()).demoListing;
    expect(fallback?.id).toBe(second.id);
    expect((await app.request(`/api/public/listings/${fallback!.id}`)).status).toBe(200);
    expect(JSON.stringify(fallback)).not.toContain('photo_path');
  });
});
