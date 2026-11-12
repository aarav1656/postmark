// SPEC.md, Orders board: amount at risk is money PayPal can still take back because the parcel
// has no checked label (UNSHIPPED) or the label breaks Seller Protection (AT RISK).
export const MONEY_AT_RISK_STATES = ['UNSHIPPED', 'AT RISK'];

export function deskSummary<T extends { protection_state: string; amount_cents: number; archived_at?: string | null }>(orders: T[]) {
  const active = orders.filter((order) => !order.archived_at);
  const archived = orders.filter((order) => order.archived_at);
  const count = (state: string) => active.filter((order) => order.protection_state === state).length;
  // ponytail: sums cents across currencies; split by currency when a non-USD order arrives.
  const atRiskCents = active.filter((order) => MONEY_AT_RISK_STATES.includes(order.protection_state)).reduce((sum, order) => sum + order.amount_cents, 0);
  return { active, archived, atRiskCents, unshipped: count('UNSHIPPED'), atRisk: count('AT RISK') };
}
