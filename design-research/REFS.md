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
