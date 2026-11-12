# Postmark design references

Captured 2026-11-12 with `refshot.py` in the deepsurge profile. Every value below is read from the `.tokens.json` next to the PNG. Direct competitors (same job: labels, address verification, tracking, disputes) are marked [competitor].

## Pirate Ship [competitor]

- URL: https://www.pirateship.com/
- Screen: marketing homepage of the label tool most small US sellers already use. The device mockup in the hero is a video that renders as an empty frame in the capture; the copy, type and CTA treatment are what is measured here.
- Screenshots: `design-research/refs/pirateship-1440.png`, `design-research/refs/pirateship-390.png`
- Measured (pirateship-1440.tokens.json, pirateship-390.tokens.json): body bg `#ffffff`, dark bands `#151515` (rgb 21,21,21 on links and input text). Custom face "Arrrrrialweb" (a rounded geometric grotesk), h1 54.9px/700 leading 65.88px at 1440, 33.9px/700 leading 40.68px at 390, h2 41.9px/700, body and p 20.9px/400 leading 29.26px. Outlined nav CTA: 2px solid `#00a9ff`, radius 8px, padding 16px 20px. Filled CTA on mobile `#00a9ff` bg, radius 8px. Email input radius 0px, padding 16px, fused onto a green submit bar.
- Regions: yellow highlighter swipes behind the claim words ("Save up to 89%", "tons of treasure", "cheapest", "hooked"); email field welded to a green "Create your FREE account" bar; alternating white and near-black bands cut on diagonals; 8-up feature list with small spot illustrations; trust row of review badges.
- Steal: (1) the highlighter swipe behind one claim word, which reads as a marker on paper, not a UI pill; use it once, on the field that breaks protection in the redline. (2) Input and action fused into one block with no gap (radius 0 input over the action bar), the right shape for "paste order id, then Check". (3) Body at roughly 21px on mobile: sellers read this at the post office counter on a phone, so the verdict copy should not drop below 18px.
- Avoid: the pirate joke voice and emoji font. Postmark's moment is a seller about to lose money; the tone is a clerk, not a mascot.

## USPS ZIP Code Lookup [competitor]

- URL: https://tools.usps.com/zip-code-lookup.htm?byaddress
- Screen: the official USPS address lookup form, the canonical place a seller checks whether an address is deliverable. A working product screen, not marketing.
- Screenshots: `design-research/refs/uspszip-1440.png`, `design-research/refs/uspszip-390.png`
- Measured (uspszip-1440.tokens.json): body bg `#ffffff`, footer band light grey; ink and brand navy `#333366` (rgb 51,51,102) on h1, h2, links and the button. Helvetica Neue W02 (55 Roman, 65 Medium, 75 Bold). h1 "Look Up a ZIP Code" 30px leading 33px; h2 24px leading 26.4px; field labels 13px; inputs 13px text, padding 5px 10px, 1px solid `#333366`, radius 3px, about 44px tall; "Find" button `#333366` fill, white 16px text, radius 3px, padding 10px 20px. Active tab marked by a red underline bar; the "Quick Tools" nav tab ends in a red diagonal slash.
- Regions: tab row of lookup modes with slash separators; one form whose fields are the exact address schema Postmark compares (Company, Street Address, Apt/Suite/Other, City, State, ZIP Code) in a two-column grid that collapses to one column at 390; a single navy primary action; no empty state other than placeholder text ("123 Main Street").
- Steal: (1) field order and naming exactly as USPS uses them; the redline diff should use these same labels (Street Address, Apt/Suite/Other, City, State, ZIP Code) so a seller recognises them from the post office. (2) Radius 3px and 1px ink borders on inputs: postal, administrative, not friendly SaaS. (3) The red underline as the only active-state marker, red reserved for "this one".
- Avoid: navy-on-white government blandness and 10px body text in the chrome; Postmark keeps the field grammar, not the palette.

## EasyPost Address API docs [competitor]

- URL: https://docs.easypost.com/docs/addresses
- Screen: the reference page for EasyPost's address object and its verify endpoints (`POST /addresses/create_and_verify`). It is the closest thing to a published spec for "compare an address and say which field fails": the verification object lists `errors[]` each with `code`, `field`, `message` and `suggestion`, the exact shape of Postmark's redline.
- Screenshots: `design-research/refs/easypost-1440.png`, `design-research/refs/easypost-390.png`
- Measured (easypost-1440.tokens.json): page bg `#ffffff`, headings deep blue `#0b2780` (rgb 11,39,128), buttons `#061340`. Poppins throughout: h1 "Address" 46px/500 leading 56px, h2 33px/400 tracking 0.25px leading 40px, h3 23px/400 leading 32px, body 15px/400 tracking 0.5px leading 24px. Nav "DOCS" uppercase 15px/600 tracking 0.15px. Search input radius 5px, 1px solid `#c6cfe0`, padding 7px 11px. Endpoint box at 390: 1px blue border, radius about 6px, monospace verbs coloured by method (green POST, blue GET).
- Regions: left tree nav; centre column of field rows (field name in mono, type tag, one-line description, roughly 56px per row); right column of dark code samples pinned beside each section; "Verify an Address" shows request plus a response whose `errors` array names the failing field ("E.ADDRESS.NOT_FOUND", "suggestion": null).
- Steal: (1) one row per address field, field name in mono on the left and the plain explanation beside it; Postmark's diff uses the same row skeleton with the label value and the PayPal value side by side. (2) Each failure is a record with field, code and a human message, so the AT RISK panel names the field first, then the reason, then the fix. (3) Method verbs colour-coded inside a mono block: carrier names and tracking numbers in mono with one colour cue.
- Avoid: Poppins plus corporate blue docs styling and the three-column docs chrome; Postmark is a counter, not a reference manual.

## Parcels (parcelsapp.com) tracking result [competitor]

- URL: https://parcelsapp.com/en/tracking/9400111899562537866543
- Screen: a live tracking result page for a USPS-format number (22 digits, 9400 prefix). The 1440 capture caught the carrier lookup in progress (spinner on "TRACK PACKAGE", result area still empty); the 390 capture shows the finished result: a dated event timeline and a key/value table. The number has no carrier events, so this is the honest "nothing found yet" state, which Postmark also needs for freshly posted tracking.
- Screenshots: `design-research/refs/parcelsapp-1440.png`, `design-research/refs/parcelsapp-390.png`
- Measured (parcelsapp-1440.tokens.json, parcelsapp-390.tokens.json): body bg `#ffffff`, text `#333333`, footer band near-black with cream headings `#f2ebdd` (rgb 242,235,221) at 13px/700 uppercase tracking 0.975px. Muli body 14px leading 20px; Lato h1 36px/200 tracking 1px (22.4px at 390). Tracking-number input 22.4px/200 at 1440 and 16.8px at 390, radius 6px 0 0 6px, padding 10px 16px, fused to the red action button. Result table rows about 40px tall at 390, label left in grey, value right-aligned.
- Regions: big single input holding the tracking number; the number repeated as a removable chip below; a 3-colour rule (red, blue, red) under the header like airmail edging; result card with date column (12 Nov 2026, small grey) beside a vertical timeline dot and message; a two-column table ("Tracking number" / value, "Tracked with" / country flag).
- Steal: (1) the airmail red/blue edge rule as the one decorative structure, used once as a header divider, matching the brief's "perforation and barcode motifs as structure". (2) Date column left, event right, joined by a vertical line: Postmark's evidence trail (label photographed, address matched, tracking on PayPal, dispute opened) uses this exact skeleton. (3) The empty state says what was checked and what to do ("We've checked all relevant couriers... select the destination country"); Postmark's "tracking not on PayPal yet" copy should name the check and the next step the same way.
- Avoid: the teal-to-blue hexagon gradient header and Lato 200 weight; thin light type and gradients read as a 2015 template.

## ShipStation [competitor]

- URL: https://www.shipstation.com/
- Screen: marketing homepage, but it embeds real product UI fragments worth reading: an "Actions" menu (Mark as Shipped, Set Shipping Mode, Import Orders, Export Orders, Add to Batch), a "Configure Label" form (Package Type, Dimensions, Weight, Add-Ons: Delivery Confirmation, Insurance) and an "Awaiting Shipment" order grid with a rule builder.
- Screenshots: `design-research/refs/shipstation-1440.png`, `design-research/refs/shipstation-390.png`
- Measured (shipstation-1440.tokens.json): page bg white, ink deep violet `#11003a` (rgb 17,0,58). Figtree: h1 56.8px/800 tracking -1px leading 64px, h2 48px/600 tracking -1px leading 56px, h3 24px/600 leading 28px, body 16px leading 24px. Primary button `#00e664` green fill with violet text, radius 9999px, 16px/600. Inputs radius 4px, 1px solid `#d1d5db`. Order grid rows in the screenshot about 20px tall at the scaled-down crop, dense table with checkbox, carrier logo, service, ship-by date.
- Regions: split hero (copy left, product UI collage right on a dark violet grid); a "Configure Label" card with label-like field pairs; the "Awaiting Shipment" grid with a bulk action menu; a violet stats band (1.3M / 1.5T / 195 / $5T); signup form at the foot.
- Steal: (1) the order grid's state name "Awaiting Shipment" as a column of real orders with carrier and ship-by: Postmark's orders board uses one dense ruled row per order with its protection state as text, not a card. (2) Action verbs exactly as sellers say them ("Mark as Shipped", "Add to Batch"); Postmark's buttons should be verbs a seller already uses at the counter. (3) Negative tracking (-1px) on large headings, which keeps big type tight.
- Avoid: the violet stats band, the big-metric template in its purest form (four huge numbers, small labels), and pill-shaped neon-green buttons.

## Justt chargeback platform [competitor]

- URL: https://justt.ai/
- Screen: marketing homepage of a dispute-evidence product (the job Postmark's dispute desk does). A "ChargebackX 2026" conference modal and a chat bubble cover part of both captures; the section below the hero is legible and shows their product flow in three panels: "Validate & enrich from 300+ data points", "Argument Engine creates insights", "Tailored evidence".
- Screenshots: `design-research/refs/justt-1440.png`, `design-research/refs/justt-390.png`
- Measured (justt-1440.tokens.json): body bg `#fafafa`, body ink `#1b173a` (rgb 27,23,58), hero band near-black violet, accent violet `#6e3aeb` on links, lime `#cef66e` on the eyebrow pill (13px/600, 1.5px border, radius 100px, padding 4px 22px). Headline Axiforma New 56px/700 tracking -1.5px leading 61.6px, colour `#e6e7e6`; sub copy 18px/600 leading 29.7px in `#b9b6cc`; body Manrope 16px leading 24.8px; secondary UI in Geist 16px, radius 3px.
- Regions: hero claim with a two-tone headline (first words violet, rest white); logo strip; three-step evidence flow with a tag cloud of data points feeding an "Argument Engine" and a final "Tailored evidence" document card with a status chip; four-up stats row ($1B+, 250+, 2X, 100%); security badges; conference promo.
- Steal: (1) evidence shown as a pipeline of named inputs feeding one document: Postmark's dispute packet should list its four real inputs (label photo, extracted tracking, address match, tracker posted time) as rows that assemble into the packet, in that order. (2) The final evidence artifact drawn as a document, not a dashboard tile: Postmark's packet preview should look like a printed form. (3) Tight negative tracking (-1.5px at 56px) on the one headline.
- Avoid: violet-on-black, lime pill eyebrows and the four-up stats row; also any implication of automated winning. Postmark's notes are a draft the seller approves.

## PayPal Seller Protection policy page

- URL: https://www.paypal.com/us/webapps/mpp/ua/seller-protection
- Screen: the policy Postmark enforces. Its "Establishing Proof of Shipment or Proof of Delivery" section is the source of the two rules (online verifiable tracking, recipient address matching the Transaction Details page). Postmark's AT RISK panel quotes this page, so its type and tone set the register for cited policy text. The page scrolls inside a container, so the full-page capture is one viewport tall.
- Screenshots: `design-research/refs/paypal-sellerprotection-1440.png`, `design-research/refs/paypal-sellerprotection-390.png`
- Measured (paypal-sellerprotection-1440.tokens.json): page bg `#ffffff`, body ink `#2c2e2f`, paragraph `#333333`, section heading `#4a4a4a`; header a blue gradient band, left rail slate grey with an active row in solid PayPal navy. PayPal Pro Text VF body 16px leading 25.6px, paragraphs 15px leading 24px; section h2 pp-sans-big-light 24px leading 38.4px; page title 18px/700 uppercase. Rail items about 44px per row; "Download Printable PDF" button radius 25px, 1px solid `#c5c7c9`, 13px.
- Regions: left rail of policy sections (What's Eligible, Basic Requirements, Item Not Received Additional Requirement, Establishing Proof of Shipment or Proof of Delivery, Ineligible Items); a "Last updated on January 26, 2026" line; long body copy with bold blue inline links for defined terms ("Unauthorized Transaction", "Item Not Received").
- Steal: (1) the "Last updated on" stamp: every policy quote in Postmark carries the date it was read and the URL. (2) Defined terms set in bold as the policy does, so the cited sentence in the redline reads as PayPal's words, not ours. (3) The section names verbatim as anchors ("Establishing Proof of Shipment or Proof of Delivery") for the citation link.
- Avoid: the blue gradient header and PayPal branding on Postmark's own chrome; Postmark quotes PayPal, it does not dress as PayPal.
