import { describe, expect, it } from 'vitest';
import { deskSummary } from '../src/domain/board.ts';

const order = (id: string, protection_state: string, amount_cents: number, archived_at: string | null = null) => ({ id, protection_state, amount_cents, archived_at });

describe('orders board summary', () => {
  it('counts unshipped and at-risk orders as money at risk', () => {
    const summary = deskSummary([
      order('a', 'UNSHIPPED', 18_000),
      order('b', 'AT RISK', 2_500),
      order('c', 'PROTECTED', 9_900),
      order('d', 'TRACKING ON PAYPAL', 6_000),
      order('e', 'RESOLVED', 1_000),
    ]);
    expect(summary.atRiskCents).toBe(20_500);
    expect(summary.unshipped).toBe(1);
    expect(summary.atRisk).toBe(1);
    expect(summary.active.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('leaves archived orders out of the desk and its totals', () => {
    const summary = deskSummary([
      order('junk', 'UNSHIPPED', 100, '2026-11-12 10:00:00'),
      order('real', 'UNSHIPPED', 4_800),
      order('old', 'AT RISK', 18_000, '2026-11-12 10:00:00'),
    ]);
    expect(summary.active.map((item) => item.id)).toEqual(['real']);
    expect(summary.archived.map((item) => item.id)).toEqual(['junk', 'old']);
    expect(summary.atRiskCents).toBe(4_800);
    expect(summary.unshipped).toBe(1);
    expect(summary.atRisk).toBe(0);
  });

  it('reports zero only when nothing active needs a label check', () => {
    expect(deskSummary([order('p', 'PROTECTED', 5_000), order('t', 'TRACKING ON PAYPAL', 7_000)]).atRiskCents).toBe(0);
  });
});
