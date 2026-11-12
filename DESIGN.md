# Postmark Design System

A shipping docket printed on warm label stock. The work surface gives the next risky parcel priority, then keeps the order ledger close at hand.

## Tokens

- Fonts: Oswald 500 for compact labels and page titles, Source Sans 3 for body copy, IBM Plex Mono for tracking numbers, IDs, and money. Load from Google Fonts in `web/index.html`.
- Palette: canvas `#efe9de`, surface `#faf8f2`, ink `#24221e`, muted `#6e675d`, rule `#d0c7b8`, accent postal red `#b4312d`, passing green `#276448`, warning amber `#85500f`, dark thermal `#1d1b18`.
- Radius: 2px for controls, 4px for panels, 0 for large page surfaces.
- Type scale: 12, 14, 16, 20, 28, 40px. Page titles use 40px; labels 12px; body 16px; money and tracking use 14-20px monospace with tabular figures.
- Spacing: 4px base, 8px increments for layout: 8, 16, 24, 32, 48, 64px.
- Layout: shipping docket. A central workbench carries the urgent order or selected evidence; the order rail sits beside it on wide screens and below it on phones.
- Status color: green means the tested address and tracking checks pass; red marks a mismatch or invalid tracking; amber indicates unresolved or missing evidence. Color always appears with text.

## Components

- Buttons have primary, outlined secondary, and quiet text treatments with visible keyboard focus.
- Order rows use ruled separators, status text badges, monospace amounts, and a clear hover state.
- Risk messages use a bordered high-contrast panel and identify the exact mismatching field.
- Empty states name the missing action and provide one relevant next step. They never include invented orders or metrics.
- At 375px, navigation and all actions remain single-line and controls stay at least 44px tall.
