# Postmark

Postmark catches shipping-address mismatches while a parcel is still on the counter. A seller imports or captures a PayPal order, photographs the label, reviews the exact fields that differ, and posts tracking after the check. Each label and extraction stays with its order for later dispute evidence.

The shipping desk puts the next order needing attention first. The order ledger shows the amount, shipment state, PayPal address, extracted label fields, and tracker read-back. When PayPal opens a dispute, Postmark matches the dispute’s seller transaction ID to the captured order and prepares a notes draft from stored evidence for the seller to review.

## What Postmark connects

- PayPal Orders v2 creates a checkout, captures an approved order, reads existing orders, and adds shipment tracking.
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

The local server listens on port 8787. The first run creates `data/app.db`. Set `DATA_DIR` to a persistent directory to keep the database and stored label photos across restarts.

## Deploy on Render

Create a Render web service from `render.yaml`, then set `APP_PASSWORD`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `OPENROUTER_API_KEY`, `DEMO_BUYER_EMAIL`, and `PUBLIC_URL` in the service environment. The blueprint builds the Vite app, starts the Hono server, and mounts persistent storage at `/var/data`.

For live PayPal calls, set `PAYPAL_ENV=live` and use live credentials. Sandbox label generation and dispute controls are available only while `PAYPAL_ENV` is not `live`.

## One-minute sandbox walkthrough

1. Open Postmark and choose **Sell an item**. Enter an item and price, then continue to PayPal.
2. Approve the checkout using the sandbox buyer listed in the setup panel. Postmark captures the order when PayPal returns to the app.
3. On the order page, print the sandbox label with the wrong unit and photograph it. Postmark shows the mismatched address field and the Seller Protection policy link.
4. Print the matching sandbox label and upload it. Review the extracted address, carrier, tracking number, confidence, and highlighted label fields.
5. Post tracking. Postmark reads the PayPal order again and shows the tracker ID once PayPal returns it.

To run the real sandbox smoke flow, use `npm run smoke`. It creates a sandbox order, prints the approval URL, waits up to ten minutes for buyer approval, captures the order, sends a rendered sandbox label through OpenRouter vision, posts the extracted tracker, and verifies the tracker on the PayPal order. `npm run smoke -- --skip-approve <orderId>` resumes with an already approved order.
