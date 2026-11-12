import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const dataDir = mkdtempSync(join(tmpdir(), 'postmark-dispute-'));
const keys = ['DATA_DIR', 'APP_PASSWORD', 'DEMO_MODE', 'PAYPAL_ENV', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'DISPUTE_AUTO_ANSWER', 'PAYPAL_WEBHOOK_ID'] as const;
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
for (const key of keys) delete process.env[key];
Object.assign(process.env, { DATA_DIR: dataDir, APP_PASSWORD: 'owner-test-password', PAYPAL_ENV: 'sandbox' });
const [{ app }, { db }, answer, { planDisputeAnswer }, { createSessionCookie }] = await Promise.all([
  import('../server/app.ts'), import('../server/db.ts'), import('../server/dispute-answer.ts'), import('../src/domain/dispute-answer.ts'), import('../server/session.ts'),
]);
// Credentials are set after import so the 30s background reconciler never starts in tests.
Object.assign(process.env, { PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret' });
const { handleDispute, paypalDisputeClient, timeline } = answer;
const disputeFixture = (name: 'inr-waiting-for-seller' | 'snad-waiting-for-seller') => JSON.parse(readFileSync(new URL(`./fixtures/disputes/${name}.json`, import.meta.url), 'utf8'));

afterAll(() => {
  vi.unstubAllGlobals();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

const CAPTURE = '2BF87082EJ6705914';
const address = { address_line_1: '1455 Market St Apt 4B', city: 'San Francisco', state: 'CA', postal_code: '94103', country_code: 'US' };
const labelPath = join(dataDir, 'label.png');
writeFileSync(labelPath, Buffer.from('89504e470d0a1a0a', 'hex'));
const protectedVerdict = { state: 'PROTECTED', addressDifferences: [], trackingValid: true, addressVisible: true, reasons: [], policyUrl: 'https://www.paypal.com/us/legalhub/paypal/useragreement-full' };
const atRiskVerdict = { ...protectedVerdict, state: 'AT RISK', addressDifferences: [{ field: 'unit', paypal: 'Apt 4B', label: '(none)' }], reasons: ['Unit missing on label'] };

function seedOrder(overrides: Record<string, unknown> = {}) {
  db.exec('DELETE FROM orders; DELETE FROM disputes; DELETE FROM dispute_events; DELETE FROM paypal_operations;');
  const row = {
    id: 'ORDER-1', capture_id: CAPTURE, status: 'COMPLETED', amount_cents: 6000, currency: 'USD', buyer_name: 'Priya Raman',
    address_json: JSON.stringify(address), tracking_number: '9400111899223456789012', carrier: 'USPS', tracker_id: `${CAPTURE}-9400111899223456789012`,
    protection_state: 'TRACKING ON PAYPAL', label_path: labelPath, extraction_json: JSON.stringify({ carrier: 'USPS', tracking_number: '9400111899223456789012', recipient_name: 'Priya Raman', confidence: 0.94 }),
    verdict_json: JSON.stringify(protectedVerdict), tracker_posted_at: '2026-11-11 14:05:00', ...overrides,
  };
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO orders(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(row) as any[]);
}

// Stand-in for PayPal at the fetch layer: OAuth, dispute GET, provide-evidence. Nothing leaves the process.
type Call = { method: string; path: string; requestId: string | null; input?: any; file?: { name: string; type: string; size: number } };
function stubPayPal(initial: Record<string, any>, options: { failEvidence?: boolean; dropEvidence?: boolean } = {}) {
  let dispute = structuredClone(initial);
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const call: Call = { method, path, requestId: headers.get('PayPal-Request-Id') };
    calls.push(call);
    if (path === '/v1/oauth2/token') return Response.json({ access_token: 'test-token', expires_in: 3600 });
    if (path.endsWith('/provide-evidence')) {
      const form = init.body as FormData;
      call.input = JSON.parse(await (form.get('input') as Blob).text());
      const file = form.get('file1') as File;
      call.file = { name: file.name, type: file.type, size: file.size };
      if (options.failEvidence) return new Response('{}', { status: 500, headers: { 'paypal-debug-id': 'dbg-1' } });
      if (options.dropEvidence) return Response.json({ links: [] });
      dispute = { ...dispute, status: 'UNDER_REVIEW', evidences: [...(dispute.evidences ?? []), ...call.input.evidences], links: [] };
      return Response.json({ links: [{ rel: 'self', href: url }] });
    }
    if (path.startsWith('/v1/customer/disputes/')) return Response.json(dispute);
    return new Response('not stubbed', { status: 404 });
  }));
  return { calls, posts: () => calls.filter((call) => call.path.endsWith('/provide-evidence')) };
}
const cookie = createSessionCookie('owner-test-password', false).split(';')[0];
const inr = () => disputeFixture('inr-waiting-for-seller');
const snad = () => disputeFixture('snad-waiting-for-seller');

beforeEach(() => { vi.unstubAllGlobals(); delete process.env.DISPUTE_AUTO_ANSWER; delete process.env.DEMO_MODE; });

describe('dispute answer plan (pure)', () => {
  it('assembles label photo, AI read, PROTECTED verdict and the PayPal tracker for an item-not-received claim', () => {
    seedOrder();
    const order = db.prepare('SELECT * FROM orders').get() as any;
    const plan = planDisputeAnswer(inr(), order, { hasLabelFile: true });
    expect(plan.decision).toBe('SUBMIT');
    expect(plan.protection).toBe('PROTECTED');
    expect(plan.evidenceType).toBe('PROOF_OF_FULFILLMENT');
    expect(plan.included).toMatchObject({ labelPhoto: true, tracking: { carrier: 'USPS', trackingNumber: '9400111899223456789012' }, trackerId: `${CAPTURE}-9400111899223456789012`, verdict: { state: 'PROTECTED' }, labelRead: { confidence: 0.94 } });
    expect(plan.notes).toContain('matches the PayPal shipping address');
    expect(plan.notes).toContain('9400111899223456789012');
  });

  it('holds an AT RISK label and says so instead of claiming protection', () => {
    seedOrder({ verdict_json: JSON.stringify(atRiskVerdict), tracker_id: null, tracker_posted_at: null, protection_state: 'AT RISK' });
    const plan = planDisputeAnswer(inr(), db.prepare('SELECT * FROM orders').get() as any, { hasLabelFile: true });
    expect(plan.decision).toBe('HOLD');
    expect(plan.protection).toBe('AT RISK');
    expect(plan.reasons.join(' ')).toMatch(/does not claim Seller Protection/);
    expect(plan.notes).not.toMatch(/matches the PayPal shipping address/);
    expect(plan.notes).toContain('differs from the PayPal shipping address');
  });

  it('labels "ship anyway" separately from an unshipped AT RISK order', () => {
    seedOrder({ verdict_json: JSON.stringify(atRiskVerdict) });
    const plan = planDisputeAnswer(inr(), db.prepare('SELECT * FROM orders').get() as any, { hasLabelFile: true });
    expect(plan.protection).toBe('SHIPPED ANYWAY');
    expect(plan.decision).toBe('HOLD');
  });

  it('holds when no label check exists, and skips disputes with no matching order or a closed status', () => {
    seedOrder({ verdict_json: null, extraction_json: null, label_path: null });
    const order = db.prepare('SELECT * FROM orders').get() as any;
    const plan = planDisputeAnswer(inr(), order, { hasLabelFile: false });
    expect(plan.protection).toBe('NO LABEL CHECK');
    expect(plan.decision).toBe('HOLD');
    expect(plan.canSubmitManually).toBe(false);
    expect(planDisputeAnswer(inr(), undefined, { hasLabelFile: false }).decision).toBe('SKIP');
    expect(planDisputeAnswer({ ...inr(), status: 'RESOLVED' }, order, { hasLabelFile: true }).decision).toBe('SKIP');
  });

  it('holds a not-as-described claim even when the label was PROTECTED', () => {
    seedOrder();
    const plan = planDisputeAnswer(snad(), db.prepare('SELECT * FROM orders').get() as any, { hasLabelFile: true });
    expect(plan.decision).toBe('HOLD');
    expect(plan.evidenceType).toBe('OTHER');
    expect(plan.reasons.join(' ')).toMatch(/Item not as described/);
  });
});

describe('dispute auto-answer through the PayPal Disputes API (fetch mocked)', () => {
  it('submits PROOF_OF_FULFILLMENT with tracking and the label photo, reads PayPal back, and records the timeline', async () => {
    seedOrder();
    const paypal = stubPayPal(inr());
    await handleDispute(inr(), { client: paypalDisputeClient, auto: true, source: 'test webhook' });
    const [post] = paypal.posts();
    expect(post.path).toBe('/v1/customer/disputes/PP-D-27803/provide-evidence');
    expect(post.requestId).toBeTruthy();
    expect(post.input).toEqual({ evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', evidence_info: { tracking_info: [{ carrier_name: 'USPS', tracking_number: '9400111899223456789012' }] }, notes: expect.stringContaining('matches the PayPal shipping address') }] });
    expect(post.file).toMatchObject({ name: 'label.png', type: 'image/png' });
    expect(timeline('PP-D-27803').map((event) => event.kind)).toEqual(['RECEIVED', 'ASSEMBLED', 'SUBMITTED', 'READ_BACK']);
    expect(timeline('PP-D-27803').at(-1)?.detail.status).toBe('UNDER_REVIEW');
    expect((db.prepare('SELECT protection_state FROM orders').get() as any).protection_state).toBe('EVIDENCE SUBMITTED');
  });

  it('never submits the same dispute twice: a repeat webhook is a no-op and the manual route returns 409', async () => {
    seedOrder();
    const paypal = stubPayPal(inr());
    await handleDispute(inr(), { client: paypalDisputeClient, auto: true, source: 'webhook' });
    await handleDispute(inr(), { client: paypalDisputeClient, auto: true, source: 'webhook retry' });
    const form = new FormData(); form.set('notes', 'again');
    const response = await app.request('/api/disputes/PP-D-27803/evidence', { method: 'POST', body: form, headers: { cookie } });
    expect(response.status).toBe(409);
    expect(paypal.posts()).toHaveLength(1);
  });

  it('runs two concurrent deliveries of the same dispute into one PayPal POST', async () => {
    seedOrder();
    const paypal = stubPayPal(inr());
    await Promise.allSettled([
      handleDispute(inr(), { client: paypalDisputeClient, auto: true, source: 'webhook' }),
      handleDispute(inr(), { client: paypalDisputeClient, auto: true, source: 'poll' }),
    ]);
    expect(paypal.posts()).toHaveLength(1);
  });

  it('never auto-submits an AT RISK or ship-anyway order, and records why', async () => {
    seedOrder({ verdict_json: JSON.stringify(atRiskVerdict) });
    const paypal = stubPayPal(inr());
    await handleDispute(inr(), { client: paypalDisputeClient, auto: true, source: 'webhook' });
    expect(paypal.posts()).toHaveLength(0);
    const held = timeline('PP-D-27803').find((event) => event.kind === 'HELD');
    expect(held?.detail.reasons.join(' ')).toMatch(/ship anyway/);
    expect(timeline('PP-D-27803').find((event) => event.kind === 'ASSEMBLED')?.detail.protection).toBe('SHIPPED ANYWAY');
  });

  it('holds a not-as-described dispute and a dispute with no label check', async () => {
    seedOrder();
    let paypal = stubPayPal(snad());
    await handleDispute(snad(), { client: paypalDisputeClient, auto: true, source: 'webhook' });
    expect(paypal.posts()).toHaveLength(0);
    seedOrder({ verdict_json: null, extraction_json: null });
    paypal = stubPayPal(inr());
    await handleDispute(inr(), { client: paypalDisputeClient, auto: true, source: 'webhook' });
    expect(paypal.posts()).toHaveLength(0);
    expect(timeline('PP-D-27803').find((event) => event.kind === 'ASSEMBLED')?.detail.protection).toBe('NO LABEL CHECK');
  });

  it('only records a hold when DISPUTE_AUTO_ANSWER is off', async () => {
    seedOrder();
    const paypal = stubPayPal(inr());
    await handleDispute(inr(), { client: paypalDisputeClient, source: 'poll' });
    expect(paypal.posts()).toHaveLength(0);
    expect(timeline('PP-D-27803').find((event) => event.kind === 'HELD')?.detail.reasons[0]).toMatch(/DISPUTE_AUTO_ANSWER/);
  });

  it('records a PayPal failure, keeps the request id for a safe retry, and does not mark the order answered', async () => {
    seedOrder();
    let paypal = stubPayPal(inr(), { failEvidence: true });
    await expect(handleDispute(inr(), { client: paypalDisputeClient, auto: true, source: 'webhook' })).rejects.toThrow(/500/);
    const firstId = paypal.posts()[0].requestId;
    expect(timeline('PP-D-27803').map((event) => event.kind)).toContain('FAILED');
    expect((db.prepare('SELECT protection_state FROM orders').get() as any).protection_state).toBe('TRACKING ON PAYPAL');
    await handleDispute(inr(), { client: paypalDisputeClient, auto: true, source: 'poll' });
    expect(paypal.posts()).toHaveLength(1);
    paypal = stubPayPal(inr());
    const form = new FormData(); form.set('notes', 'Shipped with USPS tracking 9400111899223456789012.');
    const response = await app.request('/api/disputes/PP-D-27803/evidence', { method: 'POST', body: form, headers: { cookie } });
    expect(response.status).toBe(200);
    expect(paypal.posts()[0].requestId).toBe(firstId);
    expect(timeline('PP-D-27803').map((event) => event.kind)).toEqual(['RECEIVED', 'ASSEMBLED', 'SUBMITTED', 'READ_BACK']);
  });
});

describe('evidence submission order', () => {
  it('records SUBMITTED only after PayPal reads the evidence back, and a retry skips the POST when PayPal already has it', async () => {
    seedOrder();
    const notes = 'Shipped with USPS tracking 9400111899223456789012.';
    const submit = () => { const form = new FormData(); form.set('notes', notes); return app.request('/api/disputes/PP-D-27803/evidence', { method: 'POST', body: form, headers: { cookie } }); };
    let paypal = stubPayPal(inr(), { dropEvidence: true });
    expect((await submit()).status).toBe(502);
    expect(paypal.posts()).toHaveLength(1);
    expect(timeline('PP-D-27803').map((event) => event.kind)).not.toContain('SUBMITTED');
    const answered = inr();
    answered.status = 'UNDER_REVIEW';
    answered.evidences = [...(answered.evidences ?? []), { evidence_type: 'PROOF_OF_FULFILLMENT', notes, source: 'SUBMITTED_BY_SELLER' }];
    paypal = stubPayPal(answered);
    expect((await submit()).status).toBe(200);
    expect(paypal.posts()).toHaveLength(0);
    expect(timeline('PP-D-27803').map((event) => event.kind)).toEqual(['SUBMITTED', 'READ_BACK']);
  });
});

describe('shipped code answers only real PayPal disputes', () => {
  it('has no route that creates a simulated dispute, even in DEMO_MODE', async () => {
    seedOrder();
    process.env.DEMO_MODE = '1';
    const response = await app.request('/api/demo/disputes/simulate', { method: 'POST', body: JSON.stringify({ orderId: 'ORDER-1', kind: 'INR' }), headers: { cookie, 'Content-Type': 'application/json' } });
    expect(response.status).toBe(404);
    expect((db.prepare('SELECT COUNT(*) AS n FROM disputes').get() as { n: number }).n).toBe(0);
  });

  it('keeps dispute fixtures and any PayPal stand-in out of server/ and src/', () => {
    const shipped = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? shipped(join(dir, entry.name)) : [join(dir, entry.name)]);
    const files = [...shipped(new URL('../server', import.meta.url).pathname), ...shipped(new URL('../src', import.meta.url).pathname)];
    expect(files.filter((file) => file.includes('fixtures'))).toEqual([]);
    expect(files.filter((file) => file.endsWith('.ts') && /simulated|demoClient|DEMO_DISPUTE/.test(readFileSync(file, 'utf8')))).toEqual([]);
  });
});
