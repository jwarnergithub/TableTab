# TableTab

<p align="center">
  <img src="public/icon-192.png" alt="TableTab icon" width="192" height="192" />
</p>

TableTab is a 4-day hackathon MVP for splitting and paying a restaurant table
bill on TON. It uses a single tablet as the restaurant board and a phone-only
checkout page for wallet payment.

The app is themed for the STON.fi ecosystem and uses STON.fi Omniston so a guest
can pay with a supported TON token while the merchant receives USDT.

## What It Does

The merchant opens the tablet board at `/`, enters a table or order name,
merchant receiving wallet, and custom USDT-priced items, then locks the order.
After locking, the same tablet becomes the customer-facing board.

Customers use the tablet one at a time. A customer selects one or more unpaid
items, adds an optional tip, taps Pay, and scans the generated QR code with the
phone Camera app. The QR opens `/pay?checkout=...` on the phone.

The phone checkout connects Tonkeeper through TonConnect, lets the payer choose
an input token, requests a STON.fi Omniston quote, builds the swap/payment
transfer, and sends it through the connected wallet. The tablet does not get
edited by the phone page. Instead, the tablet polls the merchant wallet and marks
pending items paid when the USDT receipt is detected.

When all items are paid, the tablet shows a large Paid in Full banner.

## Demo Flow

1. Merchant adds custom items and USDT prices.
2. Merchant enters the receiving wallet and locks the order.
3. Customer selects unpaid items on the same tablet.
4. Customer adds an optional tip.
5. Customer taps Pay.
6. Tablet shows a QR code and copyable checkout link.
7. Customer scans the QR with the phone Camera app.
8. Phone checkout opens, connects Tonkeeper, and loads STON.fi token options.
9. Customer selects the token to spend and approves the Omniston transaction.
10. Tablet polls the merchant wallet, detects incoming USDT, and marks items paid.
11. When all items are paid, the board shows Paid in Full.

## Payment Rules

- Bill totals are denominated in USDT.
- Omniston is requested in exact-output mode using the checkout USDT amount.
- Customer swap slippage is hardcoded to 1%.
- The merchant-side detection accepts up to 0.01 USDT less than expected to avoid
  tiny rounding or swap-dust mismatches during the demo.
- Only one checkout can be active at a time.
- Selected items become pending while a checkout is active.
- Pending items return to unpaid if the checkout is canceled or times out.
- The phone checkout does not directly edit tablet state.

## Constraints

- No database.
- No backend.
- No smart contracts.
- No auth.
- One active checkout at a time.
- The tablet board is the source of truth for bill state.
- Board state is stored in localStorage.

## Tech Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- TonConnect UI
- STON.fi API
- STON.fi Omniston SDK
- TonAPI polling with a TonConsole API key
- Vercel deployment

## Routes

- `/` is the tablet-facing board.
- `/pay` is the phone-only wallet checkout.

## Environment Variables

For live Vercel testing with a TonConsole key, set:

```bash
VITE_TONAPI_API_KEY=your_tonconsole_key
```

The browser sends this to TonAPI as:

```text
Authorization: Bearer ...
```

Any `VITE_` value is public in the browser bundle, so use a temporary key you
are comfortable deleting after the hackathon.

After adding or changing the variable in Vercel, redeploy the project. Vite
reads `VITE_` variables at build time.

## Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

## Demo Safety Controls

- Reset Demo clears the local board state.
- Cancel pending payment returns pending items to unpaid.
- Simulate Payment exists only in development mode.

## Current Notes

The build currently emits bundle-size and polyfill `eval` warnings from the TON
wallet/polyfill dependency stack. The app builds successfully, and these warnings
are not blocking the hackathon demo.
