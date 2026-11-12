import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(join(tmpdir(), 'postmark-judge-seed-'));
const keys = ['DATA_DIR', 'APP_PASSWORD', 'JUDGE_PASSWORD', 'DEMO_MODE', 'PAYPAL_ENV', 'DEMO_LISTING_ID', 'DEMO_ORDER_ID', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'] as const;
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
for (const key of keys) delete process.env[key];
process.env.DATA_DIR = dataDir;
process.env.APP_PASSWORD = 'owner-test-password';
const [{ app }, { db }] = await Promise.all([import('../server/app.ts'), import('../server/db.ts')]);

afterAll(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
const entry = async () => (await app.request('/api/public/entry')).json() as Promise<{ demoListing: { id: string; title: string } | null }>;
const address = JSON.stringify({ address_line_1: '1455 Market St Apt 4B', city: 'San Francisco', state: 'CA', postal_code: '94103', country_code: 'US' });
const addOrder = (id: string, state: string, extra: Partial<{ tracker: string; archived: boolean }> = {}) => db.prepare(
  `INSERT INTO orders (id,capture_id,status,amount_cents,currency,buyer_name,address_json,protection_state,tracker_id,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
).run(id, `CAP-${id}`, 'COMPLETED', 4200, 'USD', 'Jordan Ellis', address, state, extra.tracker ?? null, extra.archived ? '2026-11-12 10:00:00' : null);

describe('demo seed for judges', () => {
  it('does not create a listing unless DEMO_MODE=1', async () => {
    expect((await entry()).demoListing).toBeNull();
    expect((db.prepare('SELECT COUNT(*) AS n FROM listings').get() as { n: number }).n).toBe(0);
  });

  it('seeds one demo listing with a real photo when DEMO_MODE=1 and the shelf is empty', async () => {
    process.env.DEMO_MODE = '1';
    const first = (await entry()).demoListing;
    expect(first?.title).toBe('Agfa Box 45 camera');
    expect((await entry()).demoListing?.id).toBe(first!.id);
    expect((db.prepare('SELECT COUNT(*) AS n FROM listings').get() as { n: number }).n).toBe(1);
    const photo = await app.request(`/api/public/listings/${first!.id}/photo?w=400`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toMatch(/^image\//);
    expect((await app.request(`/api/public/listings/${first!.id}`)).status).toBe(200);
  });

  it('sends the judge to the newest unshipped order, never a posted, archived or protected one', async () => {
    process.env.DEMO_MODE = '1';
    const judge = async () => (await (await app.request('/api/session/judge', { method: 'POST' })).json()) as { next: string | null };
    expect((await judge()).next).toBeNull();
    addOrder('POSTED', 'TRACKING ON PAYPAL', { tracker: 'T1' });
    addOrder('ARCHIVED', 'UNSHIPPED', { archived: true });
    addOrder('CLEARED', 'PROTECTED');
    expect((await judge()).next).toBeNull();
    addOrder('RISKY', 'AT RISK');
    expect((await judge()).next).toBe('RISKY');
    addOrder('FRESH', 'UNSHIPPED');
    expect((await judge()).next).toBe('FRESH');
  });
});
