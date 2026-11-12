import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../web/main.tsx', import.meta.url), 'utf8');
const pageStart = source.indexOf('function OrderPage(');
const nextFunction = source.indexOf('\nfunction ', pageStart + 1);
const orderPage = source.slice(pageStart, nextFunction);
const workbenchStart = orderPage.indexOf('<section className="workbench">');
const workbenchEnd = orderPage.indexOf('</section>', workbenchStart);

describe('shipment preflight layout', () => {
  it('keeps the verdict, mismatches, and next action before label details in one workbench', () => {
    const verdict = orderPage.indexOf('<VerdictPanel', workbenchStart);
    const mismatch = orderPage.indexOf('className="redline-panel"', workbenchStart);
    const tracking = orderPage.indexOf('className="tracking-action"', workbenchStart);
    const details = orderPage.indexOf('className="extraction-card"', workbenchStart);

    for (const position of [verdict, mismatch, tracking, details]) {
      expect(position).toBeGreaterThan(workbenchStart);
      expect(position).toBeLessThan(workbenchEnd);
    }
    expect(verdict).toBeLessThan(mismatch);
    expect(mismatch).toBeLessThan(tracking);
    expect(tracking).toBeLessThan(details);
  });
});
