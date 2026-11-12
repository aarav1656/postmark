import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from '../server/db.ts';
import { renderSandboxLabel } from '../src/domain/sandbox-label.ts';
import { preflight } from '../src/domain/verdict.ts';
import { extractLabel } from '../src/ai/label.ts';
import { beginOperation, failOperation, finishOperation, paypal } from '../src/paypal.ts';
import { captureOrder, createOrder, getOrder } from '../src/paypal-orders.ts';
import { CheckoutPaymentIntent, PaypalExperienceUserAction, PaypalWalletContextShippingPreference } from '@paypal/paypal-server-sdk';

const missing = [
  !process.env.PAYPAL_CLIENT_ID && 'PAYPAL_CLIENT_ID',
  !process.env.PAYPAL_CLIENT_SECRET && 'PAYPAL_CLIENT_SECRET',
  !process.env.OPENROUTER_API_KEY && 'OPENROUTER_API_KEY',
].filter((value): value is string => Boolean(value));
if (missing.length) { console.error(`Missing required environment: ${missing.join(', ')}`); process.exit(2); }
if (process.env.PAYPAL_ENV === 'live') { console.error('Smoke requires PAYPAL_ENV=sandbox.'); process.exit(2); }

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const readOrder = (id: string) => getOrder(id);
const skipIndex = process.argv.indexOf('--skip-approve');
let orderId = skipIndex >= 0 ? process.argv[skipIndex + 1] : undefined;

try {
  if (!orderId) {
    const requestKey = randomUUID();
    const operationId = `smoke-create:${requestKey}`;
    const op = beginOperation(operationId, 'smoke-create-order');
    try {
      const order = await createOrder({
        intent: CheckoutPaymentIntent.Capture, purchaseUnits: [{ referenceId: requestKey, description: 'Postmark sandbox shipment smoke', amount: { currencyCode: 'USD', value: '0.01' } }],
        paymentSource: { paypal: { experienceContext: { returnUrl: `${process.env.PUBLIC_URL || 'http://localhost:8787'}/shop?capture=1`, cancelUrl: `${process.env.PUBLIC_URL || 'http://localhost:8787'}/shop?cancelled=1`, userAction: PaypalExperienceUserAction.PayNow, shippingPreference: PaypalWalletContextShippingPreference.GetFromFile, brandName: 'Postmark' } } },
      }, op.requestId);
      const readback = await readOrder(order.id);
      if (readback.id !== order.id) throw new Error('Create order read-back failed');
      orderId = order.id;
      finishOperation(operationId, order.id);
      console.log(`PayPal order: ${orderId} (${readback.status})`);
      const approval = readback.links?.find((link: any) => link.rel === 'payer-action')?.href;
      if (!approval) throw new Error('PayPal returned no buyer approval URL');
      console.log(`Approve this sandbox order with a sandbox buyer: ${approval}`);
    } catch (error) { failOperation(operationId, error); throw error; }
  }
  if (!orderId) throw new Error('Missing PayPal order id');
  const activeOrderId = orderId;

  const orderDeadline = Date.now() + 10 * 60_000;
  let order = await readOrder(activeOrderId);
  console.log(`PayPal order: ${order.id} (${order.status})`);
  while (order.status !== 'APPROVED' && order.status !== 'COMPLETED') {
    if (Date.now() >= orderDeadline) throw new Error('Timed out waiting for sandbox buyer approval');
    await wait(5_000);
    order = await readOrder(activeOrderId);
    console.log(`PayPal order: ${order.id} (${order.status})`);
  }

  const captureOperation = `smoke-capture:${activeOrderId}`;
  const capture = beginOperation(captureOperation, 'smoke-capture-order');
  if (!capture.done) {
    try {
      await captureOrder(activeOrderId, capture.requestId);
    } catch (error) { failOperation(captureOperation, error); throw error; }
  }
  order = await readOrder(activeOrderId);
  const captureId = order.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  if (order.status !== 'COMPLETED' || !captureId) throw new Error(`Capture did not reach COMPLETED: ${order.status}`);
  finishOperation(captureOperation, activeOrderId);
  console.log(`PayPal capture: ${captureId} (${order.status})`);

  const ship = order.purchase_units?.[0]?.shipping;
  const address = ship?.address;
  if (!address?.address_line_1 || !address?.postal_code || !address?.country_code) throw new Error('PayPal capture did not include a usable shipping address');
  const paypalAddress = {
    address_line_1: address.address_line_1, address_line_2: address.address_line_2 ?? '', city: address.admin_area_2 ?? '',
    state: address.admin_area_1 ?? '', postal_code: address.postal_code, country_code: address.country_code,
  };
  const rendered = await renderSandboxLabel(activeOrderId, paypalAddress, false, ship?.name?.full_name ?? null);
  const dataDir = process.env.DATA_DIR || './data';
  const labelsDir = join(dataDir, 'labels'); mkdirSync(labelsDir, { recursive: true });
  const labelPath = join(labelsDir, `${randomUUID()}.png`); writeFileSync(labelPath, rendered.png);
  const extraction = await extractLabel(rendered.png, 'image/png');
  const verdict = preflight({
    paypalAddress,
    labelAddress: { address_line_1: extraction.address_line_1, address_line_2: extraction.address_line_2, city: extraction.city, state: extraction.state, postal_code: extraction.postal_code, country_code: extraction.country },
    carrier: extraction.carrier, trackingNumber: extraction.tracking_number,
  });
  if (verdict.state !== 'PROTECTED') throw new Error(`Real label vision preflight returned ${verdict.state}: ${JSON.stringify(verdict.reasons)}`);
  db.prepare(`INSERT INTO orders(id,capture_id,status,amount_cents,currency,buyer_name,address_json,tracking_number,carrier,protection_state,label_path,extraction_json,verdict_json,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,'PROTECTED',?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET capture_id=excluded.capture_id,status=excluded.status,address_json=excluded.address_json,tracking_number=excluded.tracking_number,carrier=excluded.carrier,protection_state=excluded.protection_state,label_path=excluded.label_path,extraction_json=excluded.extraction_json,verdict_json=excluded.verdict_json,updated_at=CURRENT_TIMESTAMP`)
    .run(activeOrderId, captureId, order.status, Math.round(Number(order.purchase_units[0].payments.captures[0].amount.value) * 100), order.purchase_units[0].payments.captures[0].amount.currency_code, ship.name?.full_name ?? null, JSON.stringify(paypalAddress), extraction.tracking_number, extraction.carrier, labelPath, JSON.stringify(extraction), JSON.stringify(verdict));
  console.log(`Label vision preflight: ${verdict.state} (${extraction.carrier} ${extraction.tracking_number})`);

  const operationId = `smoke-track:${activeOrderId}:${captureId}:${extraction.tracking_number}`;
  const track = beginOperation(operationId, 'smoke-track');
  if (!track.done) {
    try {
      await paypal(`/v2/checkout/orders/${encodeURIComponent(activeOrderId)}/track`, { method: 'POST', body: JSON.stringify({ capture_id: captureId, tracking_number: extraction.tracking_number, carrier: extraction.carrier, notify_payer: false }) }, track.requestId);
    } catch (error) { failOperation(operationId, error); throw error; }
  }
  const finalOrder = await readOrder(activeOrderId);
  const tracker = (finalOrder.purchase_units?.[0]?.shipping?.trackers ?? []).find((item: any) => item.tracking_number === extraction.tracking_number && item.carrier === extraction.carrier);
  if (!tracker?.id) throw new Error('PayPal order read-back did not contain the submitted tracker');
  finishOperation(operationId, tracker.id);
  db.prepare("UPDATE orders SET tracker_id=?,tracker_posted_at=CURRENT_TIMESTAMP,protection_state='TRACKING ON PAYPAL',status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(tracker.id, finalOrder.status, activeOrderId);
  console.log(`PayPal tracker: ${tracker.id} (${finalOrder.status}, verified on order)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
