export interface ShippingAddress {
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
}

const suffixes: Record<string, string> = {
  STREET: 'ST', AVENUE: 'AVE', BOULEVARD: 'BLVD', ROAD: 'RD', DRIVE: 'DR',
  LANE: 'LN', COURT: 'CT', CIRCLE: 'CIR', HIGHWAY: 'HWY', PARKWAY: 'PKWY',
  PLACE: 'PL', TERRACE: 'TER', TRAIL: 'TRL', WAY: 'WAY',
};
const directionals: Record<string, string> = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW',
  SOUTHEAST: 'SE', SOUTHWEST: 'SW',
};
const units: Record<string, string> = {
  APARTMENT: 'UNIT', APT: 'UNIT', UNIT: 'UNIT', SUITE: 'UNIT', STE: 'UNIT',
  NUMBER: 'UNIT', NO: 'UNIT', BUILDING: 'BLDG', BLDG: 'BLDG', FLOOR: 'FL', FL: 'FL',
};
const states: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA',
  HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS',
  KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT',
  NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND',
  OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI',
  WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC',
};

const clean = (value: string | null | undefined) => (value ?? '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  .replace(/\bZIP\s*CODE\b/g, ' ').replace(/[^A-Z0-9#]+/g, ' ').trim().replace(/\s+/g, ' ');

const canonicalTokens = (value: string, map: Record<string, string>) => clean(value)
  .split(' ').map((token) => map[token] ?? token).join(' ');

function unitParts(value: string) {
  let residual = value;
  const found: string[] = [];
  residual = residual.replace(/(?:^|\s)#\s*([A-Z0-9-]+)/g, (_m, unit: string) => { found.push(`UNIT ${unit}`); return ' '; });
  residual = residual.replace(/\b(APARTMENT|APT|UNIT|SUITE|STE|NUMBER|BUILDING|BLDG|FLOOR|FL)\s*([A-Z0-9-]+)/g, (_m, label: string, unit: string) => {
    found.push(`${units[label]} ${unit}`); return ' ';
  });
  residual = residual.replace(/\bNO\.?\s*(\d+[A-Z]?)\b/g, (_m, unit: string) => { found.push(`UNIT ${unit}`); return ' '; });
  return { residual, unit: [...new Set(found)].sort().join(' ') };
}

/** Canonicalize US postal suffixes, directionals, unit designators, punctuation, and ZIP+4. */
const countries: Record<string, string> = {
  'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US', USA: 'US', US: 'US',
  CANADA: 'CA', CA: 'CA', 'UNITED KINGDOM': 'GB', UK: 'GB', GB: 'GB',
  AUSTRALIA: 'AU', AU: 'AU', 'NEW ZEALAND': 'NZ', NZ: 'NZ',
};

export function normalizeAddress(address: ShippingAddress) {
  const lines = [address.address_line_1, address.address_line_2].map((v) => clean(v ?? ''));
  const combined = lines.join(' ');
  const { residual, unit } = unitParts(combined);
  const street = canonicalTokens(residual, { ...suffixes, ...directionals }).split(' ').sort().join(' ');
  const line2 = '';
  const post = clean(address.postal_code ?? '').replace(/\b(\d{5})\s*\d{4}\b/, '$1');
  const state = clean(address.state ?? '');
  return {
    street,
    unit,
    line2,
    city: clean(address.city),
    state: states[state] ?? state,
    postal: post,
    country: countries[clean(address.country_code)] ?? clean(address.country_code),
  };
}

export type AddressField = 'street' | 'unit' | 'line2' | 'city' | 'state' | 'postal' | 'country';
export interface AddressDifference { field: AddressField; paypal: string; label: string; }

export function compareAddresses(paypal: ShippingAddress, label: ShippingAddress): AddressDifference[] {
  const expected = normalizeAddress(paypal);
  const actual = normalizeAddress(label);
  const raw = (address: ShippingAddress, field: AddressField) => {
    if (field === 'street' || field === 'unit') return [address.address_line_1, address.address_line_2].filter((part) => part?.trim()).join(', ') || '(blank)';
    const value = field === 'postal' ? address.postal_code : field === 'country' ? address.country_code : field === 'line2' ? address.address_line_2 : address[field];
    return value?.trim() || '(blank)';
  };
  return (Object.keys(expected) as AddressField[])
    .filter((field) => expected[field] !== actual[field])
    .map((field) => ({ field, paypal: raw(paypal, field), label: raw(label, field) }));
}
