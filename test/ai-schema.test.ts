import { describe, expect, it } from 'vitest';
import { LabelSchema } from '../src/ai/label.ts';
import { DisputeNotesSchema } from '../src/ai/notes.ts';

const valid = {
  carrier: 'USPS', service: 'Ground Advantage', tracking_number: '9400100000000000000000', recipient_name: 'Test Recipient',
  address_line_1: '10 Main St', address_line_2: null, city: 'Austin', state: 'TX', postal_code: '78701', country: 'US',
  signature_confirmation_visible: false, confidence: 0.93, field_boxes: { tracking_number: [0.1, 0.2, 0.3, 0.1] },
};

describe('label extraction schema', () => {
  it('accepts a complete extraction within confidence and box bounds', () => expect(LabelSchema.safeParse(valid).success).toBe(true));
  it('rejects missing tracking numbers', () => expect(LabelSchema.safeParse({ ...valid, tracking_number: '' }).success).toBe(false));
  it('rejects unsupported carrier guesses', () => expect(LabelSchema.safeParse({ ...valid, carrier: 'CANADA_POST' }).success).toBe(false));
  it('rejects confidence outside the model contract', () => expect(LabelSchema.safeParse({ ...valid, confidence: 1.2 }).success).toBe(false));
  it('rejects out-of-frame field boxes', () => expect(LabelSchema.safeParse({ ...valid, field_boxes: { tracking_number: [0, 0, 2, 1] } }).success).toBe(false));
});

describe('dispute note schema', () => {
  it('accepts non-empty reviewed notes', () => expect(DisputeNotesSchema.safeParse({ notes: 'Tracking and label evidence are attached.' }).success).toBe(true));
  it('rejects empty notes', () => expect(DisputeNotesSchema.safeParse({ notes: '' }).success).toBe(false));
  it('rejects notes beyond the PayPal field limit', () => expect(DisputeNotesSchema.safeParse({ notes: 'x'.repeat(2001) }).success).toBe(false));
});
