import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const dataDir = mkdtempSync(join(tmpdir(), 'postmark-err-'));
const previous = { DATA_DIR: process.env.DATA_DIR, PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET };
Object.assign(process.env, { DATA_DIR: dataDir, PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret' });
const { paypal } = await import('../src/paypal.ts');

afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(dataDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

describe('PayPal error bodies', () => {
  it('surfaces name and details[].issue from a rejected provide-evidence, never the token', async () => {
    // The body PayPal sandbox returned for dispute PP-R-PXL-10200304 on 2026-11-12.
    const rejection = { name: 'INVALID_REQUEST', message: 'Request is not well-formed, syntactically incorrect, or violates schema.', debug_id: 'ca59778c218a7', details: [{ issue: 'EVIDENCE_TYPE_IS_NOT_ALLOWED' }], links: [] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).endsWith('/v1/oauth2/token')
      ? Response.json({ access_token: 'secret-token-value', expires_in: 3600 })
      : Response.json(rejection, { status: 400, headers: { 'paypal-debug-id': 'ca59778c218a7' } })));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const error = await paypal<never>('/v1/customer/disputes/PP-R-PXL-10200304/provide-evidence', { method: 'POST', body: new FormData() }).catch((e: unknown) => e as Error);

    expect(error.message).toBe('PayPal request failed (400) INVALID_REQUEST: EVIDENCE_TYPE_IS_NOT_ALLOWED, debug ca59778c218a7');
    expect(logged).toHaveBeenCalledWith('PayPal request failed', expect.objectContaining({ name: 'INVALID_REQUEST', issues: ['EVIDENCE_TYPE_IS_NOT_ALLOWED'] }));
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret-token-value');
    logged.mockRestore();
  });
});
