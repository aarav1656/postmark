export type Carrier = 'USPS' | 'UPS' | 'FEDEX' | 'DHL';

const patterns: Record<Carrier, RegExp[]> = {
  USPS: [/^\d{20,22}$/, /^[A-Z]{2}\d{9}US$/i, /^420\d{5}\d{20,22}$/],
  UPS: [/^1Z[A-Z0-9]{16}$/i, /^\d{9}$/, /^\d{12,18}$/],
  FEDEX: [/^\d{12}$/, /^\d{15}$/, /^\d{20}$/, /^\d{22}$/],
  DHL: [/^\d{10}$/, /^\d{11}$/, /^\d{16}$/, /^JJD\d{18}$/i],
};

export function normalizeTrackingNumber(value: string): string {
  return value.trim().replace(/[\s-]/g, '').toUpperCase();
}

export function isValidTrackingNumber(carrier: Carrier | string, trackingNumber: string): boolean {
  const patternsForCarrier = patterns[carrier as Carrier];
  if (!patternsForCarrier) return false;
  const normalized = normalizeTrackingNumber(trackingNumber);
  return patternsForCarrier.some((pattern) => pattern.test(normalized));
}
