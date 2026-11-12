# Postmark

Postmark catches shipping-address mismatches while a parcel is still on the counter. A seller lists an item with a photo, a buyer pays for it with PayPal on a public item page, and the paid order lands on the seller's desk with the address PayPal holds. The seller photographs the label, reviews the exact fields that differ, and posts tracking after the check. Each label photo and extraction stays with its order as dispute evidence.

The shipping desk puts the next parcel to check first, with the item photo, buyer, and delivery address. A summary strip shows the amount at risk: the value of every order still unshipped or carrying a label that breaks Seller Protection. Every order row carries its label evidence: the stored label photo with its PROTECTED or AT RISK stamp, the buyer's name and city from the PayPal shipping address, and the item sold. Orders without a label yet show the order number and the AI-read tracking in place of a photo. Test and stale orders move to an archive with one click, out of the desk and its totals, and restore the same way. When PayPal opens a dispute, Postmark matches the dispute’s seller transaction ID to the captured order and prepares a notes draft from stored evidence for the seller to review.

## What Postmark connects

- Seller listings store a resized item photo, title, price, and description. Each listing has a public page with a **Buy with PayPal** button.
- PayPal Orders v2 creates the checkout server-side from the listing price with the item attached, captures the approved order only when it belongs to that listing, reads existing orders, and adds shipment tracking.
- PayPal Disputes v1 lists and reconciles disputes, verifies configured webhook signatures, and submits reviewed evidence with the stored label photo.
- OpenRouter vision reads the carrier, service, tracking number, recipient, address, signature marking, confidence, and field boxes from a label photo. The default model is `google/gemini-2.5-flash`.
- Deterministic checks normalize US postal suffixes, directionals, unit numbers, state names, punctuation, and ZIP+4 before comparing the label with PayPal’s shipping address. Tracking number formats are checked for USPS, UPS, FedEx, and DHL.

A passing verdict records the address, visible geographic detail, and tracking-format checks. Seller Protection eligibility also depends on PayPal’s transaction, shipment, and delivery requirements.

## Run locally

Use Node 24. Copy `.env.example` to `.env` and set an `APP_PASSWORD`, PayPal sandbox credentials, an OpenRouter key, and the sandbox buyer email. Postmark boots without credentials and identifies each missing setting in its setup panel.

```sh
npm install
cp .env.example .env
npm run typecheck
npm test
npm run build
npm start
```

The local server listens on port 8787. The first run creates `data/app.db`. Set `DATA_DIR` to a persistent directory to keep the database, stored label photos, and listing photos across restarts.

## Deploy on Render

Create a Render web service from `render.yaml`, then set `APP_PASSWORD`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `OPENROUTER_API_KEY`, `DEMO_BUYER_EMAIL`, and `PUBLIC_URL` in the service environment. The blueprint builds the Vite app, starts the Hono server, and mounts persistent storage at `/var/data`.

For live PayPal calls, set `PAYPAL_ENV=live` and use live credentials. Sandbox label generation and dispute controls are available only while `PAYPAL_ENV` is not `live`.

## One-minute sandbox walkthrough

1. Open **Shop** at `/shop`. The Kodak Duaflex II camera listing is on the shelf with its photo and price. Sellers add their own listings here with a photo, title, price, and description.
2. Open the camera's item page and choose **Buy with PayPal**. Pay with the sandbox buyer listed in the setup panel or a sandbox card. PayPal returns to the item page, Postmark captures the payment, and the page stamps it PAID.
3. Open **Orders**. The paid order leads the desk as the next parcel to check, with the camera photo, the buyer's PayPal address, and its value counted in the amount at risk.
4. On the order page, print the sandbox label with the wrong unit and photograph it. Postmark shows the mismatched address field and the Seller Protection policy link.
5. Print the matching sandbox label and upload it. Review the extracted address, carrier, tracking number, confidence, and highlighted label fields.
6. Post tracking. Postmark reads the PayPal order again and shows the tracker ID once PayPal returns it. The label photo and its stamp now show on the order row in the ledger.

To run the real sandbox smoke flow, use `npm run smoke`. It creates a sandbox order, prints the approval URL, waits up to ten minutes for buyer approval, captures the order, sends a rendered sandbox label through OpenRouter vision, posts the extracted tracker, and verifies the tracker on the PayPal order. `npm run smoke -- --skip-approve <orderId>` resumes with an already approved order.
