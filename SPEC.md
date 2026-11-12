# Postmark: Seller Protection checked at the shipping label

PayPal API reference: `docs/PAYPAL-API.md`.

## Who
Small PayPal sellers who lose disputes while holding proof that is not in PayPal's shape. Demand: r/PokemonInvesting "Buyer filed chargeback on PayPal $8200 USD" (585 upvotes), r/paypal "PayPal refunded buyer $1,700, let him keep everything" (225 upvotes), r/paypal "i lost the Paypal chargeback after having all the proofs". PayPal's Seller Protection proof of delivery requires "An online and verifiable tracking number" and "An address for the recipient that matches the shipping address on the Transaction Details page" (paypal.com/us/webapps/mpp/ua/seller-protection). Sellers find out about the mismatch after the money is gone.

## What it does (core loop, all real)
1. **Orders come from PayPal**: (a) a minimal built-in checkout at `/shop` the seller can use to sell an item (Orders v2 create → buyer approves → capture), and (b) "Add an existing PayPal order" by order id (GET order). Store order id, capture id, amount, buyer name, the exact shipping address PayPal holds.
2. **Ship screen** (phone first, camera input `capture="environment"`): seller photographs the printed shipping label before drop-off. AI vision extracts `{carrier, service, tracking_number, recipient_name, address_line_1, address_line_2, city, state, postal_code, country, signature_confirmation_visible, confidence, field_boxes?}`, zod-validated.
3. **Preflight verdict (deterministic)**: normalize both addresses (case, punctuation, USPS suffix and unit abbreviations: Street/St, Avenue/Ave, Apartment/Apt/#, Suite/Ste, directionals, ZIP5 from ZIP+4) and compare field by field. Validate tracking number format per carrier (USPS, UPS, FedEx, DHL patterns, with tests). Verdict: `PROTECTED` (all match, valid tracking) or `AT RISK` with a redline diff: label line vs PayPal line, the exact field that breaks Seller Protection and why, citing the policy sentence. Only enforce rules that appear on PayPal's current Seller Protection page; cite the URL in code. If any additional threshold rule (for example signature confirmation over a value) is not on that page today, do not enforce it.
4. **Post tracking to PayPal** on PROTECTED (or seller override with an explicit "ship anyway, I accept the risk" that is recorded): `POST /v2/checkout/orders/{id}/track`, then GET the order and assert the tracker exists. Show tracker id and "on PayPal" state. Store the label photo and extraction as evidence.
5. **Dispute desk** `/disputes`: reconciler (every 30 s) lists disputes, plus `CUSTOMER.DISPUTE.CREATED` webhook when configured. Each dispute is matched to a stored order via `disputed_transactions[].seller_transaction_id` = capture id. For a matched dispute, Postmark assembles the evidence packet: label photo, extracted tracking, address match result, tracker posted timestamp. AI drafts the seller's notes (factual, cites only stored evidence, no invented claims), seller edits, then Submit calls `provide-evidence` (multipart with the label photo). Read the dispute back and show the new status. In sandbox mode only, show labelled controls "Sandbox: request seller evidence" and "Sandbox: adjudicate" that call the sandbox-only endpoints so a judge can drive the lifecycle.
6. **Orders board**: every order with its protection state (UNSHIPPED, AT RISK, PROTECTED, TRACKING ON PAYPAL, DISPUTED, EVIDENCE SUBMITTED, RESOLVED), amount at risk totals at the top.

## Sandbox label for judges
In `PAYPAL_ENV=sandbox` only, an order page offers "Print a sandbox test label" which renders a PNG/PDF label to the order's PayPal address with a carrier-format tracking number and a visible "SANDBOX TEST LABEL" band. It exists so a judge without a real parcel can photograph or upload it. A second button renders the same label with one deliberate address change (wrong unit number) so the AT RISK path is demonstrable. Never available in live mode.

## AI usage (visible in UI and README)
- Label vision extraction with confidence and field-level highlight.
- Dispute notes drafting grounded only in stored evidence (prompt receives the evidence JSON; output schema forbids facts not in it; reviewer must approve).

## Deterministic rules with unit tests
Address normalization and comparison (positive and negative cases incl. unit numbers, ZIP+4, abbreviations, line swaps), tracking format validation per carrier, verdict function, dispute-to-order matching, evidence packet assembly.

## Smoke (`npm run smoke`, real sandbox)
Creates an order, prints the approval URL, waits (up to 10 min, polling GET order) for the operator to approve with a sandbox buyer, captures, runs the preflight on the sandbox test label rendered for that order (through the real vision call), posts tracking, GETs the order and asserts the tracker exists. Flag `--skip-approve <orderId>` resumes from an already approved order.

## One-minute judge path
Open hosted URL → "Buy the test item" with the sandbox buyer shown in the setup panel (`DEMO_BUYER_EMAIL`) → back on the order, print the sandbox label with the wrong unit → upload it, see AT RISK with the redline → print the correct label → upload, see PROTECTED → tracking lands on the PayPal order.

## Visual language
The post office counter: kraft paper and label stock, thermal-printer black, a postal red for AT RISK and a stamp-ink green for PROTECTED, condensed sans for labels plus monospace for tracking numbers, perforation and barcode motifs used sparingly as structure (dividers, verdict stamp), not decoration. The verdict lands like a rubber stamp.

## Env (product specific)
`DEMO_BUYER_EMAIL`.
