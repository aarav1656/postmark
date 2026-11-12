import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { db } from './db.ts';
import { publish } from './events.ts';
import { beginOperation, failOperation, finishOperation, paypal } from '../src/paypal.ts';
import { matchDisputeToOrder, type PayPalDispute, type StoredOrder } from '../src/domain/dispute.ts';
import { evidenceInput, planDisputeAnswer, type AnswerPlan, type DisputeLike } from '../src/domain/dispute-answer.ts';

// One path to PayPal for dispute evidence: the existing `paypal()` client and Disputes v1 provide-evidence.
export interface DisputeClient {
  read(id: string): Promise<PayPalDispute & Record<string, any>>;
  provideEvidence(id: string, body: FormData, requestId: string): Promise<unknown>;
}
export const paypalDisputeClient: DisputeClient = {
  read: (id) => paypal(`/v1/customer/disputes/${encodeURIComponent(id)}`),
  provideEvidence: (id, body, requestId) => paypal(`/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, { method: 'POST', body }, requestId),
};

export const autoAnswerEnabled = () => process.env.DISPUTE_AUTO_ANSWER === '1';
export const evidenceOperationId = (disputeId: string) => `dispute-evidence:${disputeId}`;
export type TimelineKind = 'RECEIVED' | 'ASSEMBLED' | 'HELD' | 'SUBMITTED' | 'READ_BACK' | 'FAILED';
export interface TimelineEvent { kind: TimelineKind; at: string; detail: Record<string, any> }
export class AlreadyAnswered extends Error { constructor(message: string) { super(message); this.name = 'AlreadyAnswered'; } }

export function recordEvent(disputeId: string, orderId: string | null, kind: TimelineKind, detail: Record<string, unknown>, keepFirst = false) {
  db.prepare(`INSERT INTO dispute_events(dispute_id,order_id,kind,detail_json) VALUES(?,?,?,?)
    ON CONFLICT(dispute_id,kind) DO ${keepFirst ? 'NOTHING' : 'UPDATE SET order_id=excluded.order_id,detail_json=excluded.detail_json,created_at=CURRENT_TIMESTAMP'}`)
    .run(disputeId, orderId, kind, JSON.stringify(detail));
}
export function timeline(disputeId: string): TimelineEvent[] {
  const order: TimelineKind[] = ['RECEIVED', 'ASSEMBLED', 'HELD', 'SUBMITTED', 'READ_BACK', 'FAILED'];
  return (db.prepare('SELECT kind, created_at AS at, detail_json FROM dispute_events WHERE dispute_id=?').all(disputeId) as Array<{ kind: TimelineKind; at: string; detail_json: string }>)
    .map((row) => ({ kind: row.kind, at: row.at, detail: JSON.parse(row.detail_json) }))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
export function alreadySubmitted(disputeId: string) {
  const op = db.prepare('SELECT state FROM paypal_operations WHERE id=?').get(evidenceOperationId(disputeId)) as { state: string } | undefined;
  const row = db.prepare('SELECT evidence_submitted_at FROM disputes WHERE id=?').get(disputeId) as { evidence_submitted_at: string | null } | undefined;
  return op?.state === 'succeeded' || Boolean(row?.evidence_submitted_at);
}
export function storeDispute(detail: PayPalDispute & Record<string, any>, orderId: string | null) {
  db.prepare(`INSERT INTO disputes(id,order_id,capture_id,status,reason,due_at,details_json,updated_at)
    VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET order_id=excluded.order_id,capture_id=excluded.capture_id,status=excluded.status,
    reason=excluded.reason,due_at=excluded.due_at,details_json=excluded.details_json,updated_at=CURRENT_TIMESTAMP`)
    .run(detail.dispute_id, orderId, detail.disputed_transactions?.[0]?.seller_transaction_id ?? null, detail.status, detail.reason ?? null, detail.seller_response_due_date ?? null, JSON.stringify(detail));
}
const allOrders = () => db.prepare('SELECT * FROM orders').all() as unknown as StoredOrder[];
export function planFor(detail: DisputeLike & { disputed_transactions?: PayPalDispute['disputed_transactions'] }) {
  const order = matchDisputeToOrder(detail as PayPalDispute, allOrders());
  return { order, plan: planDisputeAnswer(detail, order, { hasLabelFile: Boolean(order?.label_path && existsSync(order.label_path)) }) };
}
const summary = (plan: AnswerPlan) => ({
  protection: plan.protection, evidenceType: plan.evidenceType, decision: plan.decision,
  labelPhoto: plan.included.labelPhoto, labelRead: plan.included.labelRead, verdict: plan.included.verdict,
  tracking: plan.included.tracking, trackerId: plan.included.trackerId, trackerPostedAt: plan.included.trackerPostedAt,
});

// Called for every dispute PayPal reports (poll or verified webhook). Records the timeline; submits only when
// DISPUTE_AUTO_ANSWER=1, the reason is item-not-received, the label check was PROTECTED and tracking is on PayPal.
export async function handleDispute(detail: PayPalDispute & Record<string, any>, options: { client?: DisputeClient; auto?: boolean; source: string }) {
  const client = options.client ?? paypalDisputeClient;
  const { order, plan } = planFor(detail);
  recordEvent(detail.dispute_id, order?.id ?? null, 'RECEIVED', { source: options.source, reason: detail.reason ?? null, status: detail.status, dueAt: detail.seller_response_due_date ?? null, amount: detail.dispute_amount ?? null }, true);
  if (alreadySubmitted(detail.dispute_id)) return { plan, submitted: false, already: true };
  if (!order) { recordEvent(detail.dispute_id, null, 'HELD', { reasons: plan.reasons }); return { plan, submitted: false }; }
  recordEvent(detail.dispute_id, order.id, 'ASSEMBLED', { ...summary(plan), notes: plan.notes });
  if (plan.decision !== 'SUBMIT') { recordEvent(detail.dispute_id, order.id, 'HELD', { reasons: plan.reasons, manualAllowed: plan.canSubmitManually }); publish({ type: 'disputes', id: detail.dispute_id }); return { plan, submitted: false }; }
  if (timeline(detail.dispute_id).some((event) => event.kind === 'FAILED')) return { plan, submitted: false };
  if (!(options.auto ?? autoAnswerEnabled())) {
    recordEvent(detail.dispute_id, order.id, 'HELD', { reasons: ['Automatic answers are off (DISPUTE_AUTO_ANSWER is not 1). Review the notes and submit from the dispute page.'], manualAllowed: true });
    publish({ type: 'disputes', id: detail.dispute_id });
    return { plan, submitted: false };
  }
  await submitEvidence(detail.dispute_id, order, plan, plan.notes, client, 'auto');
  return { plan, submitted: true };
}

const inFlight = new Set<string>();
export async function submitEvidence(disputeId: string, order: StoredOrder, plan: AnswerPlan, notes: string, client: DisputeClient, mode: 'auto' | 'manual') {
  if (inFlight.has(disputeId)) throw new AlreadyAnswered('Evidence for this dispute is being submitted right now.');
  if (alreadySubmitted(disputeId)) throw new AlreadyAnswered('Evidence for this dispute was already submitted to PayPal.');
  if (!plan.included.tracking) throw new Error('The matched order has no stored carrier and tracking number.');
  if (!order.label_path || !existsSync(order.label_path)) throw new Error('The matched order has no stored label photo.');
  inFlight.add(disputeId);
  const operationId = evidenceOperationId(disputeId);
  try {
    const before = await client.read(disputeId);
    const op = beginOperation(operationId, 'provide-dispute-evidence');
    // A retry after a lost response: PayPal already holds these notes, so the POST is not sent again.
    const onPayPal = (dispute: Record<string, any>) => (dispute.evidences ?? []).some((item: any) => typeof item.notes === 'string' && item.notes.trim() === notes.trim());
    const alreadyOnPayPal = onPayPal(before);
    if (!alreadyOnPayPal) {
      const multipart = new FormData();
      multipart.append('input', new Blob([JSON.stringify(evidenceInput(plan, notes))], { type: 'application/json' }));
      const labelType = extname(order.label_path).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      multipart.append('file1', new Blob([readFileSync(order.label_path)], { type: labelType }), `label${extname(order.label_path)}`);
      await client.provideEvidence(disputeId, multipart, op.requestId);
    }
    const after = alreadyOnPayPal ? before : await client.read(disputeId);
    if (!onPayPal(after)) throw new Error('PayPal read-back does not show the submitted evidence');
    recordEvent(disputeId, order.id, 'SUBMITTED', { mode, evidenceType: plan.evidenceType, tracking: plan.included.tracking, labelPhoto: true, notes: notes.trim(), protection: plan.protection, requestId: op.requestId, retriedWithoutPost: alreadyOnPayPal });
    finishOperation(operationId, disputeId);
    db.prepare(`INSERT INTO disputes(id,order_id,capture_id,status,reason,due_at,details_json,evidence_notes,evidence_submitted_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET status=excluded.status,details_json=excluded.details_json,evidence_notes=excluded.evidence_notes,evidence_submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
      .run(disputeId, order.id, order.capture_id, after.status, after.reason ?? null, after.seller_response_due_date ?? null, JSON.stringify(after), notes.trim());
    db.prepare("UPDATE orders SET protection_state='EVIDENCE SUBMITTED',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
    db.prepare("DELETE FROM dispute_events WHERE dispute_id=? AND kind IN ('HELD','FAILED')").run(disputeId);
    recordEvent(disputeId, order.id, 'READ_BACK', { status: after.status, stage: after.dispute_life_cycle_stage ?? null, evidenceCount: (after.evidences ?? []).length });
    publish({ type: 'disputes', id: disputeId });
    return after;
  } catch (error) {
    failOperation(operationId, error);
    recordEvent(disputeId, order.id, 'FAILED', { message: error instanceof Error ? error.message : String(error) });
    publish({ type: 'disputes', id: disputeId });
    throw error;
  } finally { inFlight.delete(disputeId); }
}
