import { describe, expect, it } from 'vitest';
import { findTracker } from '../src/domain/tracker.ts';

describe('findTracker', () => {
  it('matches the id-only shape PayPal returns from GET order', () => {
    const live = [{ id: '2BF87082EJ6705914-94003946480000000000', status: 'SHIPPED' }];
    expect(findTracker(live, '2BF87082EJ6705914', '94003946480000000000', 'USPS')?.status).toBe('SHIPPED');
  });
  it('falls back to tracking number and carrier fields when present', () => {
    expect(findTracker([{ id: 'x', tracking_number: '1Z999', carrier: 'UPS' }], 'CAP', '1Z999', 'UPS')?.id).toBe('x');
  });
  it('does not match another capture or another tracking number', () => {
    const live = [{ id: 'OTHERCAP-94003946480000000000', status: 'SHIPPED' }, { id: '2BF87082EJ6705914-111', status: 'SHIPPED' }];
    expect(findTracker(live, '2BF87082EJ6705914', '94003946480000000000', 'USPS')).toBeUndefined();
  });
});
