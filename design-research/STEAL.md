# Postmark: what we take

## Visual thesis

Postmark is a post office counter: kraft paper and label stock under thermal-printer black, condensed sans for every label and monospace for every tracking number, and the verdict lands like a rubber stamp, stamp-ink green for PROTECTED and postal red for AT RISK.

## Measured tokens to adopt

| Token | Value | Source |
|---|---|---|
| Address field names and order | Street Address, Apt/Suite/Other, City, State, ZIP Code | USPS ZIP lookup (uspszip-1440.tokens.json, form labels) |
| Input and control radius | 3px, 1px solid ink border | USPS ZIP lookup inputs and "Find" button (radius 3px, 1px solid `#333366`) |
| Control and row height | 44px minimum | USPS inputs (about 44px), PayPal policy rail rows (about 44px) |
| Fused input plus action | input radius 0, action bar welded beneath (390) or beside (1440), no gap | Pirate Ship email + "Create your FREE account" (input radius 0, padding 16px) |
| Verdict body size on phone | 18px minimum, up to 21px | Pirate Ship body 20.9px leading 29.26px at 390 |
| Tracking number input | mono, 22px at 1440, 17px at 390 | Parcels tracking input 22.4px / 16.8px |
| Headline tracking | -1px at 56px, -1.5px at 56px bold | ShipStation h1 56.8px tracking -1px; Justt h2 56px tracking -1.5px |
| Small caps labels | 12 to 13px, weight 700, uppercase, tracking about 1px | Parcels footer h3 13px/700 tracking 0.975px uppercase |
| Label-stock cream | `#f2ebdd` as a surface hint next to DESIGN.md canvas `#efe9de` | Parcels footer headings rgb(242,235,221) |
| Policy body text | 15 to 16px, leading 24 to 25.6px, ink `#2c2e2f` range | PayPal Seller Protection p 15px/24px, body 16px/25.6px |
| Failure record shape | field, code, plain message, suggested fix | EasyPost verification `errors[]` (code, field, message, suggestion) |
| Evidence trail skeleton | date column left, vertical rule with dot, event text right | Parcels result timeline (390) |
| One structural ornament | airmail edge rule (red, blue, red) used once as a header divider | Parcels header bottom rule |
| Active marker | red underline bar, red reserved for "this one" | USPS tab underline |

Palette, fonts, spacing and radius scale stay as locked in `DESIGN.md` (Oswald, Source Sans 3, IBM Plex Mono; canvas `#efe9de`, ink `#24221e`, postal red `#b4312d`, stamp green `#276448`). The references above set radius, row height, field grammar and the verdict's reading size.

## Hero moment

The seller holds the phone over the printed label. The photo sits on the left like a label stuck to the counter; PayPal's address for the order sits on the right in the same five USPS field rows. The rows fill in one by one, each line from the label beside the matching line from PayPal. Then the stamp lands: a slightly rotated, ink-edged block, green PROTECTED or red AT RISK, with one beat of press (scale from 1.08 to 1, no bounce). On AT RISK the one field that breaks protection carries a highlighter swipe (from Pirate Ship) and a strike line through the label value, with PayPal's value beside it, and under it the policy sentence quoted with its URL and "read on" date (from the PayPal policy page).

## Copy for the five key buttons and states

1. Ship screen, primary button: **Photograph the label**. Helper line: "Take it before you drop the parcel off. We check it against the address PayPal holds."
2. PROTECTED state: stamp **PROTECTED**, line "Address and tracking match PayPal's record for this order." Primary button: **Send tracking to PayPal**.
3. AT RISK state: stamp **AT RISK**, line "Apt/Suite/Other on the label is 4B. PayPal has 4D. Seller Protection needs these to match." Primary button: **Reprint the label**. Secondary, text style: **Ship anyway, I accept the risk**.
4. Tracking posted state: **On PayPal**, line "Tracking 9400 1118 9956 2537 8665 43 added to order at 14:02. PayPal confirmed it." (number in mono, grouped in fours).
5. Dispute desk, primary button: **Send evidence to PayPal**. Before it, the packet header: "Evidence for this dispute: label photo, tracking, address check, time tracking was posted. Read the notes, edit them, then send."

## Refused (from negative/)

Big numbers with small labels (Chargeflow, ShipStation stats band), icon-above-heading card grids (Shippo docs), Poppins on white with orange CTA and stock photos (AfterShip), neon on black, pill buttons, gradients.
