import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import sharp from 'sharp';
import { db } from './db.ts';
import { publish, subscribe } from './events.ts';
import { clearSessionCookie, createSessionCookie, hasSession } from './session.ts';
import { compareAddresses, type ShippingAddress } from '../src/domain/address.ts';
import { matchDisputeToOrder, assembleEvidencePacket, type PayPalDispute, type StoredOrder } from '../src/domain/dispute.ts';
import { preflight, protectionStateAfterLabel } from '../src/domain/verdict.ts';
import { extractLabel } from '../src/ai/label.ts';
import { draftDisputeNotes } from '../src/ai/notes.ts';
import { beginOperation, failOperation, finishOperation, paypal } from '../src/paypal.ts';
import { renderSandboxLabel } from '../src/domain/sandbox-label.ts';
import { findTracker } from '../src/domain/tracker.ts';
import { resetLabelAssessment } from './label-assessment.ts';

export const app = new Hono();
const frontendOrigin = new URL(process.env.PUBLIC_URL || 'http://localhost:8787').origin;
app.use('/api/*', cors({ origin: frontendOrigin, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'], credentials: true, maxAge: 600 }));
const dataDir = process.env.DATA_DIR || './data';
const labelsDir = join(dataDir, 'labels');
mkdirSync(labelsDir, { recursive: true });
const listingsDir = join(dataDir, 'listings');
mkdirSync(listingsDir, { recursive: true });
const publicUrl = () => process.env.PUBLIC_URL || 'http://localhost:8787';

const missingEnv = () => [
  !process.env.PAYPAL_CLIENT_ID && 'PAYPAL_CLIENT_ID',
  !process.env.PAYPAL_CLIENT_SECRET && 'PAYPAL_CLIENT_SECRET',
  !process.env.OPENROUTER_API_KEY && 'OPENROUTER_API_KEY',
  !process.env.APP_PASSWORD && 'APP_PASSWORD',
  process.env.PAYPAL_ENV !== 'live' && !process.env.DEMO_BUYER_EMAIL && 'DEMO_BUYER_EMAIL',
].filter((value): value is string => Boolean(value));

const getOrderRow = (id: string) => db.prepare('SELECT * FROM orders WHERE id=?').get(id) as (StoredOrder & { buyer_name: string | null } & Record<string, unknown>) | undefined;
const getOrder = (id: string) => {
  const row = getOrderRow(id);
  if (!row) return null;
  return {
    ...row,
    address: row.address_json ? JSON.parse(row.address_json) as ShippingAddress : null,
    extraction: row.extraction_json ? JSON.parse(row.extraction_json) : null,
    verdict: row.verdict_json ? JSON.parse(row.verdict_json) : null,
  };
};
const orderSelect = 'SELECT orders.*, listings.title AS item_title FROM orders LEFT JOIN listings ON listings.id = orders.listing_id';
const serializeOrder = (row: Record<string, any>) => {
  const { address_json, extraction_json, verdict_json, label_path, ...fields } = row;
  return {
    ...fields,
    address: address_json ? JSON.parse(address_json) : null,
    extraction: extraction_json ? JSON.parse(extraction_json) : null,
    verdict: verdict_json ? JSON.parse(verdict_json) : null,
    has_label: Boolean(label_path),
  };
};
const publicOrder = (id: string) => {
  const row = db.prepare(`${orderSelect} WHERE orders.id=?`).get(id) as Record<string, any> | undefined;
  return row ? serializeOrder(row) : null;
};
const getListing = (id: string) => db.prepare('SELECT * FROM listings WHERE id=?').get(id) as
  { id: string; title: string; description: string; price_cents: number; currency: string; photo_path: string; created_at: string } | undefined;
const publicListing = ({ photo_path, ...listing }: NonNullable<ReturnType<typeof getListing>>) => listing;
const sendImage = async (c: any, path: string, width: string | undefined, cacheControl: string) => {
  if (!existsSync(path)) return c.json({ error: 'Image is unavailable' }, 404);
  const target = Number(width);
  c.header('Cache-Control', cacheControl);
  // ponytail: resized on every request; cache thumbnails on disk if order volume makes this slow.
  if (Number.isInteger(target) && target >= 64 && target <= 1600) {
    c.header('Content-Type', 'image/jpeg');
    return c.body(await sharp(path).rotate().resize({ width: target, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer());
  }
  c.header('Content-Type', extname(path).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg');
  return c.body(readFileSync(path));
};
const toCents = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
};
const fromPaypalOrder = (order: any) => {
  const unit = order.purchase_units?.[0] ?? {};
  const capture = unit.payments?.captures?.[0];
  const shipping = unit.shipping ?? {};
  const addr = shipping.address;
  const address: ShippingAddress | null = addr ? {
    address_line_1: addr.address_line_1 ?? '', address_line_2: addr.address_line_2 ?? '',
    city: addr.admin_area_2 ?? '', state: addr.admin_area_1 ?? '', postal_code: addr.postal_code ?? '', country_code: addr.country_code ?? '',
  } : null;
  return {
    id: order.id as string,
    captureId: capture?.id ?? null,
    status: order.status ?? 'UNKNOWN',
    amountCents: toCents(capture?.amount?.value ?? unit.amount?.value),
    currency: capture?.amount?.currency_code ?? unit.amount?.currency_code ?? 'USD',
    buyerName: shipping.name?.full_name ?? ([order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(' ') || null),
    address,
    listingId: typeof unit.custom_id === 'string' && unit.custom_id.startsWith('listing:') ? unit.custom_id.slice('listing:'.length) : null,
    protectionState: capture?.dispute_outcome?.outcome_code ?? (order.status === 'COMPLETED' ? 'UNSHIPPED' : 'UNSHIPPED'),
  };
};
const savePaypalOrder = (order: any) => {
  const value = fromPaypalOrder(order);
  db.prepare(`INSERT INTO orders(id,capture_id,status,amount_cents,currency,buyer_name,address_json,protection_state,listing_id,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET capture_id=excluded.capture_id,status=excluded.status,amount_cents=excluded.amount_cents,currency=excluded.currency,
    buyer_name=excluded.buyer_name,address_json=COALESCE(excluded.address_json,orders.address_json),listing_id=COALESCE(excluded.listing_id,orders.listing_id),updated_at=CURRENT_TIMESTAMP`).run(
    value.id, value.captureId, value.status, value.amountCents, value.currency, value.buyerName, value.address ? JSON.stringify(value.address) : null, value.protectionState, value.listingId,
  );
  publish({ type: 'orders', id: value.id });
  return publicOrder(value.id);
};
const requirePaypal = (c: any) => {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return c.json({ error: 'PayPal is not connected', missing: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'].filter((key) => !process.env[key]) }, 503);
  }
  return null;
};

app.get('/api/health', (c) => c.json({ ok: true, missing: missingEnv() }));
const secureCookie = () => (process.env.PUBLIC_URL || '').startsWith('https://');
app.get('/api/session', (c) => c.json({ configured: Boolean(process.env.APP_PASSWORD), authenticated: hasSession(c.req.header('cookie'), process.env.APP_PASSWORD || '') }));
app.post('/api/session', async (c) => {
  const password = process.env.APP_PASSWORD;
  if (!password) return c.json({ error: 'Set APP_PASSWORD to protect this Postmark instance.' }, 503);
  const body = z.object({ password: z.string().min(1) }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: 'Enter the Postmark access password.' }, 400);
  const supplied = Buffer.from(body.data.password);
  const expected = Buffer.from(password);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return c.json({ error: 'The access password did not match.' }, 401);
  c.header('Set-Cookie', createSessionCookie(password, secureCookie()));
  return c.json({ authenticated: true });
});
app.post('/api/session/logout', (c) => { c.header('Set-Cookie', clearSessionCookie(secureCookie())); return c.json({ authenticated: false }); });
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/api/health' || path === '/api/session' || path === '/api/session/logout' || path === '/api/webhooks/paypal' || path.startsWith('/api/public/')) return next();
  if (!hasSession(c.req.header('cookie'), process.env.APP_PASSWORD || '')) return c.json({ error: 'Enter the Postmark access password to continue.' }, 401);
  await next();
});

app.get('/api/setup', (c) => c.json({ missing: missingEnv(), paypalEnv: process.env.PAYPAL_ENV || 'sandbox', demoBuyerEmail: process.env.DEMO_BUYER_EMAIL || null }));

app.get('/api/events', (c) => streamSSE(c, async (stream) => {
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const unsubscribe = subscribe((event) => { queue.push(event); wake?.(); });
  stream.onAbort(() => { closed = true; unsubscribe(); wake?.(); });
  await stream.writeSSE({ event: 'ready', data: '{}' });
  while (!closed) {
    if (!queue.length) await Promise.race([new Promise<void>((resolve) => { wake = resolve; }), new Promise<void>((resolve) => setTimeout(resolve, 20_000))]);
    wake = undefined;
    if (!queue.length && !closed) await stream.writeSSE({ event: 'ping', data: '' });
    while (queue.length) await stream.writeSSE({ event: 'update', data: JSON.stringify(queue.shift()) });
  }
}));

app.get('/api/orders', (c) => c.json((db.prepare(`${orderSelect} ORDER BY orders.updated_at DESC`).all() as Array<Record<string, any>>).map(serializeOrder)));
app.post('/api/orders/:id/archive', async (c) => {
  const body = z.object({ archived: z.boolean() }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: 'Choose whether to archive or restore this order.' }, 400);
  const result = db.prepare('UPDATE orders SET archived_at=CASE WHEN ? THEN COALESCE(archived_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE id=?').run(body.data.archived ? 1 : 0, c.req.param('id'));
  if (result.changes !== 1) return c.json({ error: 'Order has not been added to Postmark' }, 404);
  publish({ type: 'orders', id: c.req.param('id') });
  return c.json(publicOrder(c.req.param('id')));
});
app.get('/api/orders/:id', (c) => {
  const order = getOrder(c.req.param('id'));
  return order ? c.json(publicOrder(c.req.param('id'))) : c.json({ error: 'Order has not been added to Postmark' }, 404);
});

app.post('/api/orders/import', async (c) => {
  const unavailable = requirePaypal(c); if (unavailable) return unavailable;
  const body = z.object({ orderId: z.string().min(1).max(36) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.issues[0]?.message }, 400);
  try { return c.json(savePaypalOrder(await paypal(`/v2/checkout/orders/${encodeURIComponent(body.data.orderId)}`))); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'PayPal order lookup failed' }, 502); }
});

const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
app.post('/api/listings', async (c) => {
  const form = await c.req.formData().catch(() => null);
  const photo = form?.get('photo');
  const fields = z.object({
    title: z.string().trim().min(3).max(120),
    price: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/),
    description: z.string().trim().min(1).max(2000),
  }).safeParse({ title: form?.get('title'), price: form?.get('price'), description: form?.get('description') });
  if (!fields.success) return c.json({ error: 'Enter a title, a price, and a description for the item.' }, 400);
  const cents = toCents(fields.data.price);
  if (cents < 100 || cents > 10_000_000) return c.json({ error: 'Price must be between $1.00 and $100,000.00.' }, 400);
  if (!(photo instanceof File) || !imageTypes.includes(photo.type) || photo.size < 1 || photo.size > 15 * 1024 * 1024) {
    return c.json({ error: 'Add a JPEG, PNG, or WebP photo of the item under 15 MB.' }, 400);
  }
  const id = randomUUID();
  const photoPath = join(listingsDir, `${id}.jpg`);
  try {
    const image = await sharp(Buffer.from(await photo.arrayBuffer())).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
    writeFileSync(photoPath, image);
  } catch { return c.json({ error: 'The item photo could not be read. Try another JPEG or PNG.' }, 400); }
  db.prepare('INSERT INTO listings(id,title,description,price_cents,currency,photo_path) VALUES(?,?,?,?,?,?)').run(id, fields.data.title, fields.data.description, cents, 'USD', photoPath);
  return c.json(publicListing(getListing(id)!), 201);
});
app.get('/api/listings', (c) => c.json(db.prepare(`SELECT listings.id,listings.title,listings.description,listings.price_cents,listings.currency,listings.created_at,
  COUNT(orders.capture_id) AS sold_count FROM listings LEFT JOIN orders ON orders.listing_id = listings.id GROUP BY listings.id ORDER BY listings.created_at DESC`).all()));

app.get('/api/public/listings/:id', (c) => {
  const listing = getListing(c.req.param('id'));
  return listing ? c.json(publicListing(listing)) : c.json({ error: 'This item is no longer listed.' }, 404);
});
app.get('/api/public/listings/:id/photo', async (c) => {
  const listing = getListing(c.req.param('id'));
  if (!listing) return c.json({ error: 'This item is no longer listed.' }, 404);
  return sendImage(c, listing.photo_path, c.req.query('w'), 'public, max-age=86400');
});
app.post('/api/public/listings/:id/checkout', async (c) => {
  const unavailable = requirePaypal(c); if (unavailable) return unavailable;
  const listing = getListing(c.req.param('id'));
  if (!listing) return c.json({ error: 'This item is no longer listed.' }, 404);
  const body = z.object({ requestKey: z.string().uuid() }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: 'Missing checkout request key.' }, 400);
  const operationId = `create-order:${body.data.requestKey}`;
  const op = beginOperation(operationId, 'create-order');
  const approvalUrl = (order: any) => order.links?.find((link: any) => link.rel === 'payer-action')?.href;
  try {
    if (op.done && op.entityId) return c.json({ id: op.entityId, approvalUrl: approvalUrl(await paypal<any>(`/v2/checkout/orders/${encodeURIComponent(op.entityId)}`)) });
    const value = { currency_code: listing.currency, value: (listing.price_cents / 100).toFixed(2) };
    const itemPage = `${publicUrl()}/item/${encodeURIComponent(listing.id)}`;
    const order = await paypal<any>('/v2/checkout/orders', {
      method: 'POST', body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: body.data.requestKey, custom_id: `listing:${listing.id}`, description: listing.title.slice(0, 127),
          amount: { ...value, breakdown: { item_total: value } },
          items: [{ name: listing.title.slice(0, 127), quantity: '1', unit_amount: value, category: 'PHYSICAL_GOODS' }],
        }],
        payment_source: { paypal: { experience_context: { return_url: `${itemPage}?capture=1`, cancel_url: `${itemPage}?cancelled=1`, user_action: 'PAY_NOW', shipping_preference: 'GET_FROM_FILE', brand_name: 'Postmark' } } },
      }),
    }, op.requestId);
    const readback = await paypal<any>(`/v2/checkout/orders/${encodeURIComponent(order.id)}`);
    if (readback.id !== order.id) throw new Error('PayPal order read-back did not match the created order');
    finishOperation(operationId, order.id);
    return c.json({ id: readback.id, approvalUrl: approvalUrl(readback) });
  } catch (error) { failOperation(operationId, error); return c.json({ error: error instanceof Error ? error.message : 'PayPal order creation failed' }, 502); }
});
app.post('/api/public/listings/:id/capture', async (c) => {
  const unavailable = requirePaypal(c); if (unavailable) return unavailable;
  const body = z.object({ orderId: z.string().min(1).max(36) }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: 'Missing PayPal order id.' }, 400);
  const orderPath = `/v2/checkout/orders/${encodeURIComponent(body.data.orderId)}`;
  try {
    const before = await paypal<any>(orderPath);
    if (before.purchase_units?.[0]?.custom_id !== `listing:${c.req.param('id')}`) return c.json({ error: 'This PayPal order is not for this item.' }, 404);
    const operationId = `capture-order:${body.data.orderId}`;
    const op = beginOperation(operationId, 'capture-order');
    try {
      if (!op.done && before.status !== 'COMPLETED') await paypal(`${orderPath}/capture`, { method: 'POST', body: '{}' }, op.requestId);
      const readback = await paypal<any>(orderPath);
      if (readback.status !== 'COMPLETED' || !readback.purchase_units?.[0]?.payments?.captures?.[0]?.id) throw new Error(`Payment is not complete. PayPal order status: ${readback.status}`);
      finishOperation(operationId, body.data.orderId);
      savePaypalOrder(readback);
      return c.json({ id: readback.id, status: readback.status });
    } catch (error) { failOperation(operationId, error); throw error; }
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'PayPal capture failed' }, 502); }
});

app.post('/api/orders/:id/label', async (c) => {
  const orderId = c.req.param('id');
  const order = getOrder(orderId);
  if (!order?.address) return c.json({ error: 'Import a PayPal order with a shipping address first.' }, 409);
  const form = await c.req.formData();
  const file = form.get('label');
  if (!(file instanceof File) || !['image/jpeg', 'image/png'].includes(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) {
    return c.json({ error: 'Choose a JPEG or PNG label photo under 10 MB.' }, 400);
  }
  if (!resetLabelAssessment(db, orderId, order.tracker_id ?? null)) return c.json({ error: 'The PayPal tracker is already posted. Keep this label as shipment evidence.' }, 409);
  const id = randomUUID();
  const path = join(labelsDir, `${id}.${file.type === 'image/png' ? 'png' : 'jpg'}`);
  const imageBytes = Buffer.from(await file.arrayBuffer());
  writeFileSync(path, imageBytes);
  db.prepare('UPDATE orders SET label_path=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(path, orderId);
  publish({ type: 'orders', id: orderId });
  let extraction;
  try { extraction = await extractLabel(imageBytes, file.type); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Label extraction failed' }, 502); }
  const labelAddress: ShippingAddress = {
    address_line_1: extraction.address_line_1, address_line_2: extraction.address_line_2,
    city: extraction.city, state: extraction.state, postal_code: extraction.postal_code, country_code: extraction.country,
  };
  const verdict = preflight({ paypalAddress: order.address, labelAddress, carrier: extraction.carrier, trackingNumber: extraction.tracking_number });
  const protectionState = protectionStateAfterLabel(verdict.state, order.tracker_id ?? null);
  db.prepare(`UPDATE orders SET extraction_json=?,verdict_json=?,tracking_number=?,carrier=?,protection_state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(JSON.stringify(extraction), JSON.stringify(verdict), extraction.tracking_number, extraction.carrier, protectionState, orderId);
  publish({ type: 'orders', id: orderId });
  return c.json({ extraction, verdict, order: publicOrder(orderId) });
});

app.post('/api/orders/:id/track', async (c) => {
  const unavailable = requirePaypal(c); if (unavailable) return unavailable;
  const order = getOrder(c.req.param('id'));
  if (!order || !order.capture_id || !order.address) return c.json({ error: 'A captured PayPal order with shipping address is required.' }, 409);
  const body = z.object({ acceptRisk: z.boolean().default(false) }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: 'Invalid tracking confirmation.' }, 400);
  if (!order.verdict || (order.verdict.state !== 'PROTECTED' && !body.data.acceptRisk)) return c.json({ error: 'Tracking is blocked until preflight passes, or you explicitly accept the risk.' }, 409);
  if (!order.extraction?.tracking_number || !order.extraction?.carrier) return c.json({ error: 'Tracking details are missing from the label extraction.' }, 409);
  const key = `track:${order.id}:${order.capture_id}:${order.extraction.tracking_number}`;
  const op = beginOperation(key, 'post-tracking');
  try {
    let postError: unknown;
    if (!op.done) await paypal<any>(`/v2/checkout/orders/${encodeURIComponent(order.id)}/track`, {
      method: 'POST', body: JSON.stringify({ capture_id: order.capture_id, tracking_number: order.extraction.tracking_number, carrier: order.extraction.carrier, notify_payer: false }),
    }, op.requestId).catch((error) => { postError = error; });
    const readback = await paypal<any>(`/v2/checkout/orders/${encodeURIComponent(order.id)}`);
    const tracker = findTracker(readback.purchase_units?.[0]?.shipping?.trackers ?? [], order.capture_id, order.extraction.tracking_number, order.extraction.carrier);
    if (!tracker) throw postError ?? new Error('PayPal order read-back does not contain the requested tracker');
    finishOperation(key, tracker.id);
    db.prepare(`UPDATE orders SET tracker_id=?,tracker_posted_at=COALESCE(tracker_posted_at,CURRENT_TIMESTAMP),protection_state='TRACKING ON PAYPAL',status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(tracker.id, readback.status, order.id);
    publish({ type: 'orders', id: order.id });
    return c.json({ order: publicOrder(order.id), trackerId: tracker.id, state: 'on PayPal' });
  } catch (error) { failOperation(key, error); return c.json({ error: error instanceof Error ? error.message : 'Tracking post failed' }, 502); }
});

app.get('/api/orders/:id/sandbox-label', async (c) => {
  if (process.env.PAYPAL_ENV === 'live') return c.json({ error: 'Sandbox labels are disabled in live mode.' }, 404);
  const order = getOrder(c.req.param('id'));
  if (!order?.address) return c.json({ error: 'Order with a PayPal shipping address not found.' }, 404);
  const label = await renderSandboxLabel(order.id, order.address, c.req.query('wrongUnit') === '1', order.buyer_name ?? null);
  db.prepare('UPDATE orders SET tracking_number=?,carrier=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(label.tracking, label.carrier, order.id);
  c.header('Content-Type', 'image/png');
  c.header('Content-Disposition', `attachment; filename="postmark-sandbox-${order.id}.png"`);
  return c.body(label.png);
});

app.get('/api/disputes', (c) => c.json(db.prepare('SELECT * FROM disputes ORDER BY due_at ASC').all()));
app.post('/api/disputes/reconcile', async (c) => {
  const unavailable = requirePaypal(c); if (unavailable) return unavailable;
  try { await reconcileDisputes(); return c.json({ ok: true }); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Disputes could not be reconciled' }, 502); }
});
app.get('/api/disputes/:id', async (c) => {
  const unavailable = requirePaypal(c); if (unavailable) return unavailable;
  try {
    const dispute = await paypal<PayPalDispute & Record<string, any>>(`/v1/customer/disputes/${encodeURIComponent(c.req.param('id'))}`);
    const rows = db.prepare('SELECT * FROM orders').all() as unknown as StoredOrder[];
    const order = matchDisputeToOrder(dispute, rows);
    return c.json({ dispute: { dispute_id: dispute.dispute_id, status: dispute.status, reason: dispute.reason, seller_response_due_date: dispute.seller_response_due_date }, order: order ? publicOrder(order.id) : null });
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Dispute lookup failed' }, 502); }
});
app.post('/api/disputes/:id/draft', async (c) => {
  try {
    const dispute = await paypal<PayPalDispute & Record<string, any>>(`/v1/customer/disputes/${encodeURIComponent(c.req.param('id'))}`);
    const rows = db.prepare('SELECT * FROM orders').all() as unknown as StoredOrder[];
    const order = matchDisputeToOrder(dispute, rows);
    if (!order) return c.json({ error: 'No stored order matches this dispute capture.' }, 404);
    const packet = assembleEvidencePacket(order, order.address_json ? JSON.parse(order.address_json) : {});
    return c.json({ notes: await draftDisputeNotes(packet, dispute) });
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Evidence notes could not be drafted' }, 502); }
});
app.post('/api/disputes/:id/evidence', async (c) => {
  const unavailable = requirePaypal(c); if (unavailable) return unavailable;
  const form = await c.req.formData();
  const notes = form.get('notes');
  if (typeof notes !== 'string' || !notes.trim()) return c.json({ error: 'Review and enter seller notes before submitting.' }, 400);
  const id = c.req.param('id');
  try {
    const before = await paypal<any>(`/v1/customer/disputes/${encodeURIComponent(id)}`);
    const evidenceType = (before.evidences ?? []).find((item: any) => item.evidence_type)?.evidence_type;
    if (!evidenceType) return c.json({ error: 'PayPal did not return the evidence type required for this dispute.' }, 409);
    const rows = db.prepare('SELECT * FROM orders').all() as unknown as StoredOrder[];
    const order = matchDisputeToOrder(before, rows);
    if (!order?.tracking_number || !order.carrier) return c.json({ error: 'The matched order has no stored carrier and tracking number.' }, 409);
    if (!order.label_path || !existsSync(order.label_path)) return c.json({ error: 'The matched order has no stored label photo.' }, 409);
    const requestKey = z.string().uuid().safeParse(form.get('requestKey'));
    if (!requestKey.success) return c.json({ error: 'Missing evidence request key.' }, 400);
    const operationId = `dispute-evidence:${id}:${requestKey.data}`;
    const op = beginOperation(operationId, 'provide-dispute-evidence');
    const multipart = new FormData();
    multipart.append('input', new Blob([JSON.stringify({ evidences: [{ evidence_type: evidenceType, evidence_info: { tracking_info: [{ carrier_name: order.carrier, tracking_number: order.tracking_number }] }, notes: notes.trim() }] })], { type: 'application/json' }));
    const labelType = extname(order.label_path).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
    multipart.append('file1', new Blob([readFileSync(order.label_path)], { type: labelType }), `label${extname(order.label_path)}`);
    if (!op.done) await paypal(`/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, { method: 'POST', body: multipart }, op.requestId);
    const after = await paypal<any>(`/v1/customer/disputes/${encodeURIComponent(id)}`);
    const evidenceChanged = JSON.stringify(after.evidences ?? []) !== JSON.stringify(before.evidences ?? []);
    if (after.status === before.status && !evidenceChanged) throw new Error('PayPal read-back did not show a dispute status or evidence change');
    finishOperation(operationId, id);
    db.prepare(`INSERT INTO disputes(id,order_id,capture_id,status,reason,due_at,details_json,evidence_notes,evidence_submitted_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET status=excluded.status,details_json=excluded.details_json,evidence_notes=excluded.evidence_notes,evidence_submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
      .run(id, order.id, order.capture_id, after.status, after.reason ?? null, after.seller_response_due_date ?? null, JSON.stringify(after), notes.trim());
    db.prepare("UPDATE orders SET protection_state='EVIDENCE SUBMITTED',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
    publish({ type: 'disputes', id });
    return c.json({ dispute: after, status: after.status });
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Evidence submission failed' }, 502); }
});

app.post('/api/disputes/:id/sandbox/require-evidence', async (c) => sandboxDisputeAction(c.req.param('id'), 'require-evidence', { action: 'SELLER_EVIDENCE' }));
app.post('/api/disputes/:id/sandbox/adjudicate', async (c) => sandboxDisputeAction(c.req.param('id'), 'adjudicate', { adjudication_outcome: 'SELLER_FAVOR' }));
async function sandboxDisputeAction(id: string, action: string, body: unknown) {
  if (process.env.PAYPAL_ENV === 'live') return new Response(JSON.stringify({ error: 'Sandbox dispute controls are disabled in live mode.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  const operationId = `sandbox:${id}:${action}`;
  const op = beginOperation(operationId, action);
  try {
    if (!op.done) await paypal(`/v1/customer/disputes/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(body) }, op.requestId);
    const after = await paypal<any>(`/v1/customer/disputes/${encodeURIComponent(id)}`);
    if (action === 'adjudicate' && !/RESOLVED|CLOSED/i.test(after.status ?? '')) throw new Error(`Sandbox adjudication read-back is not terminal: ${after.status}`);
    finishOperation(operationId, id);
    db.prepare(`INSERT INTO disputes(id,status,reason,due_at,details_json,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,details_json=excluded.details_json,updated_at=CURRENT_TIMESTAMP`)
      .run(id, after.status, after.reason ?? null, after.seller_response_due_date ?? null, JSON.stringify(after));
    if (action === 'adjudicate') {
      const captureId = after.disputed_transactions?.[0]?.seller_transaction_id;
      const rows = db.prepare('SELECT * FROM orders').all() as unknown as StoredOrder[];
      const order = matchDisputeToOrder(after, rows);
      if (order) db.prepare("UPDATE orders SET protection_state='RESOLVED',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
    }
    publish({ type: 'disputes', id });
    return new Response(JSON.stringify({ dispute: after }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) { failOperation(operationId, error); return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Sandbox dispute action failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } }); }
}

app.post('/api/webhooks/paypal', async (c) => {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return c.json({ error: 'Missing PAYPAL_WEBHOOK_ID' }, 503);
  const event = await c.req.json().catch(() => null);
  if (!event || typeof event.id !== 'string') return c.json({ error: 'Invalid PayPal event body' }, 400);
  const verification = await paypal<any>('/v1/notifications/verify-webhook-signature', {
    method: 'POST', body: JSON.stringify({
      auth_algo: c.req.header('paypal-auth-algo'), cert_url: c.req.header('paypal-cert-url'),
      transmission_id: c.req.header('paypal-transmission-id'), transmission_sig: c.req.header('paypal-transmission-sig'),
      transmission_time: c.req.header('paypal-transmission-time'), webhook_id: webhookId, webhook_event: event,
    }),
  });
  if (verification.verification_status !== 'SUCCESS') return c.json({ error: 'PayPal webhook signature verification failed' }, 401);
  db.prepare('INSERT OR IGNORE INTO webhook_events(id,event_type) VALUES(?,?)').run(event.id, event.event_type ?? 'unknown');
  if (event.event_type?.startsWith('CUSTOMER.DISPUTE.')) await reconcileDisputes();
  return c.json({ received: true });
});

app.get('/api/labels/:id', async (c) => {
  const order = getOrder(c.req.param('id'));
  if (!order?.label_path) return c.json({ error: 'Stored label is unavailable' }, 404);
  return sendImage(c, order.label_path, c.req.query('w'), 'private, no-cache');
});

export async function reconcileDisputes() {
  const orders = db.prepare('SELECT * FROM orders').all() as unknown as StoredOrder[];
  for (let page = 1; page <= 50; page++) {
    const list = await paypal<any>(`/v1/customer/disputes?page_size=50&page=${page}`);
    for (const item of list.items ?? []) {
    const detail = await paypal<PayPalDispute & Record<string, any>>(`/v1/customer/disputes/${encodeURIComponent(item.dispute_id)}`);
    const order = matchDisputeToOrder(detail, orders);
    db.prepare(`INSERT INTO disputes(id,order_id,capture_id,status,reason,due_at,details_json,updated_at)
      VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET order_id=excluded.order_id,capture_id=excluded.capture_id,status=excluded.status,
      reason=excluded.reason,due_at=excluded.due_at,details_json=excluded.details_json,updated_at=CURRENT_TIMESTAMP`)
      .run(detail.dispute_id, order?.id ?? null, detail.disputed_transactions?.[0]?.seller_transaction_id ?? null, detail.status, detail.reason ?? null, detail.seller_response_due_date ?? null, JSON.stringify(detail));
    if (order) {
      const local = db.prepare('SELECT evidence_submitted_at FROM disputes WHERE id=?').get(detail.dispute_id) as { evidence_submitted_at: string | null } | undefined;
      const state = /RESOLVED|CLOSED/i.test(detail.status) ? 'RESOLVED' : local?.evidence_submitted_at ? 'EVIDENCE SUBMITTED' : 'DISPUTED';
      db.prepare('UPDATE orders SET protection_state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(state, order.id);
    }
    }
    const hasNext = (list.links ?? []).some((link: any) => link.rel === 'next');
    if (!hasNext) { publish({ type: 'disputes' }); return; }
  }
  throw new Error('PayPal dispute reconciliation exceeded the 50-page limit');
}

let reconciling = false;
if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
  setInterval(async () => {
    if (reconciling) return;
    reconciling = true;
    try { await reconcileDisputes(); }
    catch (error) { console.error('Dispute reconciliation failed', error instanceof Error ? error.message : String(error)); }
    finally { reconciling = false; }
  }, 30_000).unref();
}

app.use('*', serveStatic({ root: './web/dist', rewriteRequestPath: (path) => path }));
app.get('*', serveStatic({ root: './web/dist', path: 'index.html' }));
