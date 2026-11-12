import sharp from 'sharp';
import type { ShippingAddress } from './address.ts';

const esc = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!);

export async function renderSandboxLabel(orderId: string, address: ShippingAddress, wrongUnit: boolean) {
  const wrongAddress = wrongUnit
    ? { ...address, address_line_1: (address.address_line_1 ?? '').replace(/\b(APT|APARTMENT|UNIT|STE|SUITE)\s*\w+/i, '$1 999') || `${address.address_line_1 ?? ''} APT 999` }
    : address;
  const lines = [wrongAddress.address_line_1, wrongAddress.address_line_2, wrongAddress.city, wrongAddress.state, wrongAddress.postal_code, wrongAddress.country_code].filter(Boolean) as string[];
  const tracking = `9400${String(Math.abs(hash(orderId))).replace(/\D/g, '').padStart(6, '0').slice(0, 6)}0000000000`;
  const barcode = Array.from(tracking).map((digit, index) => {
    const width = 2 + (Number(digit) % 3);
    const x = 70 + index * 14;
    return `<rect x="${x}" y="390" width="${width}" height="65" fill="#111"/>`;
  }).join('');
  const addressText = lines.map((line, index) => `<text x="72" y="${180 + index * 40}" font-size="25" font-family="monospace">${esc(line)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="540" viewBox="0 0 800 540">
    <rect width="800" height="540" fill="#fff"/><rect x="18" y="18" width="764" height="504" fill="none" stroke="#111" stroke-width="3"/>
    <rect x="18" y="18" width="764" height="44" fill="#111"/><text x="400" y="48" text-anchor="middle" fill="#fff" font-family="monospace" font-size="22" font-weight="700">SANDBOX TEST LABEL</text>
    <text x="72" y="112" font-family="monospace" font-size="16">USPS GROUND ADVANTAGE</text>
    <text x="72" y="145" font-family="monospace" font-size="17" font-weight="700">SHIP TO</text>${addressText}
    <text x="72" y="372" font-family="monospace" font-size="14">TRACKING  ${tracking}</text>${barcode}
    <text x="72" y="490" font-family="monospace" font-size="12">Order ${esc(orderId)} · Sandbox only</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { png, tracking, carrier: 'USPS' as const, address: wrongAddress };
}

function hash(input: string) {
  let value = 2166136261;
  for (let i = 0; i < input.length; i++) value = Math.imul(value ^ input.charCodeAt(i), 16777619);
  return value >>> 0;
}
