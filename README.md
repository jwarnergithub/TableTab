# TableTab

<p align="center">
  <img src="public/icon-192.png" alt="TableTab icon" width="192" height="192" />
</p>

TableTab is a hackathon MVP for splitting and paying a restaurant bill on TON.
It uses one tablet as the live table board, keeps bill state in localStorage,
and lets customers pay with USDT directly or with another TON token through
STON.fi Omniston.

The merchant always receives USDT.

## Current Release

- Version: `v1.1.1`
- Production branch: `main`
- Stable anchor before the v1.1 payment-flow changes: `v1.0.0`
- Production URL: `https://table-tab-pi.vercel.app`

## What It Does

The merchant opens the tablet board at `/`, enters a table or order name,
merchant receiving wallet, and custom USDT-priced items, then locks the order.
After locking, the same tablet becomes the customer-facing board.

Customers use the same tablet one at a time. A customer selects unpaid items,
adds an optional USDT tip, then chooses one of two payment paths:

- Fast Pay with USDT: the tablet creates a Tonkeeper QR for a direct USDT
  transfer to the merchant wallet.
- Pay with any token: the tablet connects to the customer's TON wallet with
  TonConnect, requests a STON.fi Omniston quote, and builds a payment that swaps
  the customer's selected token into merchant USDT.

The `/pay` route remains available as a phone-only fallback checkout. It reads
the encoded checkout payload from the URL, shows the selected items and total,
connects a TON wallet, requests an Omniston quote, and sends the transaction.
It does not directly edit the tablet board.

The tablet board is the source of truth. While a checkout is pending, selected
items are marked pending and the board polls TonAPI for incoming USDT to the
merchant wallet. When payment is detected, pending items become paid. When all
items are paid, the board shows a large Paid in Full banner.

## Demo Flow

1. Merchant creates a bill with USDT item prices.
2. Merchant enters the receiving wallet and locks the order.
3. Customer selects unpaid items on the same tablet.
4. Customer adds an optional tip.
5. Customer chooses Fast Pay with USDT or Pay with any token.
6. Fast Pay shows a Tonkeeper QR for direct USDT payment.
7. Any-token pay uses tablet-side TonConnect plus STON.fi Omniston.
8. `/pay?checkout=...` remains available as a fallback phone checkout.
9. Tablet detects incoming USDT and marks items paid.
10. When all items are paid, the board shows Paid in Full.

## Payment Rules

- Bill totals are denominated and displayed in USDT.
- User-facing USDT amounts are formatted as `0.00 USDT`.
- Raw jetton amounts are still used internally for quotes, transfers, and
  payment detection.
- Omniston is requested in exact-output mode using the checkout USDT amount.
- Customer swap slippage is hardcoded to 1%.
- Merchant-side detection accepts up to `0.01 USDT` of rounding difference to
  avoid swap-dust failures during the demo.
- Only one checkout can be active at a time.
- Only unpaid items can be selected.
- Selected items become pending while a checkout is active.
- Pending items return to unpaid if the checkout is canceled or times out.
- The phone checkout does not directly update tablet state.

## Constraints

- No database.
- No backend.
- No smart contracts.
- No auth.
- One active checkout at a time.
- The tablet board is the source of truth for bill state.
- Board state is stored in localStorage.

## Routes

- `/` is the tablet-facing board.
- `/pay` is the phone-only fallback wallet checkout.

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

## TonConnect Manifest

The app uses:

```ts
const manifestUrl = `${window.location.origin}/tonconnect-manifest.json`
```

For production wallet testing, `public/tonconnect-manifest.json` should point to
the public production domain:

```json
{
  "url": "https://table-tab-pi.vercel.app",
  "name": "TableTab",
  "iconUrl": "https://table-tab-pi.vercel.app/icon-192.png"
}
```

The manifest and icon must be publicly reachable without Vercel Authentication.
If a preview deployment is protected, Tonkeeper cannot fetch the manifest and
may show an invalid manifest error.

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

- Reset clears the local board state.
- Cancel pending payment returns pending items to unpaid.
- Simulate Payment exists only in development mode.
- Clear paid table / New table appears after the order is paid in full.

## Current Notes

The build currently emits bundle-size and polyfill `eval` warnings from the TON
wallet/polyfill dependency stack. The app builds successfully, and these warnings
are not blocking the hackathon demo.
