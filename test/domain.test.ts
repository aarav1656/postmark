import { describe, expect, it } from 'vitest';
import { compareAddresses } from '../src/domain/address.ts';
import { assembleEvidencePacket, matchDisputeToOrder } from '../src/domain/dispute.ts';
import { preflight } from '../src/domain/verdict.ts';
import { isValidTrackingNumber } from '../src/domain/tracking.ts';

const address = {
  address_line_1: '123 North Main Street Apt 4',
  address_line_2: '', city: 'Austin', state: 'Texas', postal_code: '78701-1234', country_code: 'US',
};

describe('address comparison', () => {
  it('normalizes USPS suffixes, directionals, unit notation, state names, and ZIP+4', () => {
    expect(compareAddresses(address, { ...address, address_line_1: '123 N Main St #4', state: 'TX', postal_code: '78701' })).toEqual([]);
  });
  it('normalizes common country names to PayPal country codes', () => {
    expect(compareAddresses(address, { ...address, country_code: 'United States' })).toEqual([]);
  });
  it('keeps unit number differences visible', () => {
    const differences = compareAddresses(address, { ...address, address_line_1: '123 N Main St Apt 9' });
    expect(differences.map((d) => d.field)).toContain('unit');
    expect(differences.find((d) => d.field === 'unit')).toMatchObject({ paypal: '123 North Main Street Apt 4', label: '123 N Main St Apt 9' });
  });
  it('handles address line swaps without losing street or unit', () => {
    expect(compareAddresses(address, { ...address, address_line_1: 'Apt 4', address_line_2: '123 N Main St' })).toEqual([]);
  });
  it('reports city or country mismatches', () => {
    expect(compareAddresses(address, { ...address, city: 'Dallas', country_code: 'CA' }).map((d) => d.field)).toEqual(['city', 'country']);
  });
});

describe('tracking formats', () => {
  it.each([
    ['USPS', '9400 1000 0000 0000 0000 00', true],
    ['USPS', 'EC123456789US', true],
    ['UPS', '1Z999AA10123456784', true],
    ['FEDEX', '123456789012', true],
    ['DHL', '1234567890', true],
    ['USPS', 'NOT-A-TRACKING-NUMBER', false],
    ['UPS', '1Z123', false],
    ['USPS', '12345678901US', false],
    ['UNKNOWN', '9400100000000000000000', false],
  ])('%s: %s', (carrier, value, valid) => expect(isValidTrackingNumber(carrier, value)).toBe(valid));
});

describe('preflight verdict', () => {
  it('passes matching address and recognized tracking', () => {
    expect(preflight({ paypalAddress: address, labelAddress: address, carrier: 'USPS', trackingNumber: '9400100000000000000000' }).state).toBe('PROTECTED');
  });
  it('requires a policy-listed geographic address detail on the label', () => {
    const result = preflight({ paypalAddress: address, labelAddress: { address_line_1: '123 North Main Street Apt 4' }, carrier: 'USPS', trackingNumber: '9400100000000000000000' });
    expect(result.state).toBe('AT RISK');
    expect(result.reasons).toContain('The shipping documentation must show city and state, city and country, or a postal code.');
  });
  it('fails closed for a wrong unit and malformed tracking', () => {
    const result = preflight({ paypalAddress: address, labelAddress: { ...address, address_line_1: '123 N Main St Apt 7' }, carrier: 'USPS', trackingNumber: '123' });
    expect(result.state).toBe('AT RISK');
    expect(result.addressDifferences.map((d) => d.field)).toContain('unit');
    expect(result.reasons).toHaveLength(2);
  });
});

describe('dispute evidence', () => {
  const order = { id: 'ORDER-1', capture_id: 'CAP-1', tracking_number: '123', carrier: 'USPS', tracker_posted_at: '2026-01-01T00:00:00Z', address_json: null, extraction_json: '{"tracking_number":"123"}', verdict_json: '{"state":"PROTECTED"}', label_path: '/data/label.jpg' };
  it('matches the capture transaction, not an unrelated order id', () => {
    expect(matchDisputeToOrder({ dispute_id: 'D1', status: 'OPEN', disputed_transactions: [{ seller_transaction_id: 'CAP-1' }] }, [order])).toBe(order);
    expect(matchDisputeToOrder({ dispute_id: 'D1', status: 'OPEN', disputed_transactions: [{ seller_transaction_id: 'wrong' }] }, [order])).toBeUndefined();
  });
  it('assembles only stored order evidence', () => {
    const packet = assembleEvidencePacket(order, address);
    expect(packet).toMatchObject({ orderId: 'ORDER-1', tracking: { carrier: 'USPS' }, trackerPostedAt: order.tracker_posted_at });
  });
  it('rejects malformed stored JSON rather than silently dropping evidence', () => {
    expect(() => assembleEvidencePacket({ ...order, verdict_json: '{' }, address)).toThrow();
  });
});
