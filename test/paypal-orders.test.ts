import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CheckoutPaymentIntent } from '@paypal/paypal-server-sdk';
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(join(tmpdir(), 'postmark-sdk-'));
const previous = { DATA_DIR: process.env.DATA_DIR, PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET };
Object.assign(process.env, { DATA_DIR: dataDir, PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret' });
const { ordersApi, createOrder, captureOrder } = await import('../src/paypal-orders.ts');
const { PayPalError } = await import('../src/paypal.ts');

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

type Sent = { url: string; method: string; headers: Record<string, string> };
// Stands in for the network at axios's adapter layer, below every SDK serializer and auth step.
const recordingApi = (orderStatus: number, orderBody: unknown, headers: Record<string, string> = {}) => {
  const sent: Sent[] = [];
  const adapter = async (config: any) => {
    const flat = Object.fromEntries(Object.entries(config.headers?.toJSON?.() ?? config.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    sent.push({ url: config.url, method: String(config.method).toUpperCase(), headers: flat });
    const token = String(config.url).includes('/v1/oauth2/token');
    const data = JSON.stringify(token ? { access_token: 'token-1', token_type: 'Bearer', expires_in: 3600 } : orderBody);
    return { data, status: token ? 200 : orderStatus, statusText: '', headers: { 'content-type': 'application/json', ...headers }, config, request: {} };
  };
  return { api: ordersApi({ adapter }), sent };
};
const orderRequest = { intent: CheckoutPaymentIntent.Capture, purchaseUnits: [{ customId: 'listing:abc', amount: { currencyCode: 'USD', value: '68.00' } }] };

describe('Orders v2 through the PayPal Server SDK', () => {
  it('sends the persisted PayPal-Request-Id on create and capture, and returns PayPal JSON field names', async () => {
    const created = recordingApi(201, { id: 'ORDER-1', status: 'PAYER_ACTION_REQUIRED', purchase_units: [{ custom_id: 'listing:abc' }] });
    const order = await createOrder(orderRequest, 'create-order-request-id', created.api);
    const createCall = created.sent.find((call) => call.url.endsWith('/v2/checkout/orders'));
    expect(createCall?.method).toBe('POST');
    expect(createCall?.headers['paypal-request-id']).toBe('create-order-request-id');
    expect(createCall?.headers.authorization).toBe('Bearer token-1');
    expect(order.purchase_units[0].custom_id).toBe('listing:abc');

    const captured = recordingApi(201, { id: 'ORDER-1', status: 'COMPLETED' });
    await captureOrder('ORDER-1', 'capture-request-id', captured.api);
    expect(captured.sent.find((call) => call.url.endsWith('/v2/checkout/orders/ORDER-1/capture'))?.headers['paypal-request-id']).toBe('capture-request-id');
  });

  it('turns an SDK error into a PayPalError carrying the paypal-debug-id', async () => {
    const failing = recordingApi(422, { name: 'UNPROCESSABLE_ENTITY', details: [] }, { 'paypal-debug-id': 'debug-123' });
    const error = await captureOrder('ORDER-1', 'capture-request-id', failing.api).catch((value) => value);
    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ status: 422, debugId: 'debug-123' });
  });
});
