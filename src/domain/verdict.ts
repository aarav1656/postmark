import { compareAddresses, type AddressDifference, type ShippingAddress } from './address.ts';
import { isValidTrackingNumber, type Carrier } from './tracking.ts';

export interface PreflightInput {
  paypalAddress: ShippingAddress;
  labelAddress: ShippingAddress;
  carrier: string;
  trackingNumber: string;
}
export interface PreflightVerdict {
  state: 'PROTECTED' | 'AT RISK';
  addressDifferences: AddressDifference[];
  trackingValid: boolean;
  addressVisible: boolean;
  reasons: string[];
  policyUrl: string;
}
export const SELLER_PROTECTION_URL = 'https://www.paypal.com/us/legalhub/paypal/seller-protection?locale.x=en_US';

export function protectionStateAfterLabel(state: PreflightVerdict['state'], trackerId: string | null) {
  return state === 'PROTECTED' && trackerId ? 'TRACKING ON PAYPAL' : state;
}

export function preflight(input: PreflightInput): PreflightVerdict {
  const addressDifferences = compareAddresses(input.paypalAddress, input.labelAddress);
  const trackingValid = isValidTrackingNumber(input.carrier as Carrier, input.trackingNumber);
  const hasCityState = Boolean(input.labelAddress.city?.trim() && input.labelAddress.state?.trim());
  const hasCityCountry = Boolean(input.labelAddress.city?.trim() && input.labelAddress.country_code?.trim());
  const hasPostal = Boolean(input.labelAddress.postal_code?.trim());
  const addressVisible = hasCityState || hasCityCountry || hasPostal;
  const reasons: string[] = [];
  if (addressDifferences.length) reasons.push('The recipient address must match the shipping address on PayPal Transaction Details.');
  if (!trackingValid) reasons.push('The tracking number does not match a recognized format for this carrier.');
  if (!addressVisible) reasons.push('The shipping documentation must show city and state, city and country, or a postal code.');
  return {
    state: reasons.length ? 'AT RISK' : 'PROTECTED',
    addressDifferences,
    trackingValid,
    addressVisible,
    reasons,
    policyUrl: SELLER_PROTECTION_URL,
  };
}
