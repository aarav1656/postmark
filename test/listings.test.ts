import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(join(tmpdir(), 'postmark-listings-'));
const previous = { DATA_DIR: process.env.DATA_DIR, APP_PASSWORD: process.env.APP_PASSWORD };
process.env.DATA_DIR = dataDir;
process.env.APP_PASSWORD = 'listing-test-password';
const [{ app }, { db }, { createSessionCookie }] = await Promise.all([import('../server/app.ts'), import('../server/db.ts'), import('../server/session.ts')]);
const cookie = createSessionCookie('listing-test-password', false).split(';')[0];

afterAll(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

const photo = async () => new File([await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#8a6d4b' } }).png().toBuffer()], 'camera.png', { type: 'image/png' });
const listingForm = async (fields: Record<string, string>) => {
  const form = new FormData();
  form.append('photo', await photo());
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
};

describe('seller listings', () => {
  it('stores the uploaded photo and serves the listing publicly without a session', async () => {
    const created = await app.request('/api/listings', { method: 'POST', headers: { cookie }, body: await listingForm({ title: 'Folding film camera', price: '84.50', description: 'Shutter fires at all speeds.' }) });
    expect(created.status).toBe(201);
    const listing = await created.json() as { id: string; price_cents: number; photo_path?: string };
    expect(listing.price_cents).toBe(8450);
    expect(listing.photo_path).toBeUndefined();

    const page = await app.request(`/api/public/listings/${listing.id}`);
    expect(page.status).toBe(200);
    expect(await page.json()).toMatchObject({ title: 'Folding film camera', description: 'Shutter fires at all speeds.' });

    const thumb = await app.request(`/api/public/listings/${listing.id}/photo?w=200`);
    expect(thumb.headers.get('content-type')).toBe('image/jpeg');
    expect((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width).toBe(200);
  });

  it('refuses a listing without a session or without a photo', async () => {
    expect((await app.request('/api/listings', { method: 'POST', body: await listingForm({ title: 'Camera', price: '10', description: 'x' }) })).status).toBe(401);
    const form = new FormData();
    form.append('title', 'Camera'); form.append('price', '10'); form.append('description', 'No photo');
    expect((await app.request('/api/listings', { method: 'POST', headers: { cookie }, body: form })).status).toBe(400);
  });
});

describe('order archive', () => {
  it('archives and restores an order through the API', async () => {
    db.prepare("INSERT INTO orders(id,status,amount_cents,currency,protection_state) VALUES('JUNK1','CREATED',100,'USD','UNSHIPPED')").run();
    const archive = (archived: boolean) => app.request('/api/orders/JUNK1/archive', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }) });
    expect(((await (await archive(true)).json()) as { archived_at: string | null }).archived_at).toBeTruthy();
    expect(((await (await archive(false)).json()) as { archived_at: string | null }).archived_at).toBeNull();
    expect((await app.request('/api/orders/MISSING/archive', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{"archived":true}' })).status).toBe(404);
  });
});
