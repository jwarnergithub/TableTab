# TableTab

TableTab is a hackathon MVP for splitting a restaurant table bill on TON.

The app turns a single tablet into the restaurant board. A merchant enters a
table name, merchant wallet, and custom USDT-priced items, then locks the
order. After locking, the same tablet becomes the customer board: guests select
their unpaid items one at a time, add an optional tip, tap Pay, and scan a QR
code with their phone.

The phone checkout opens `/pay?checkout=...`, connects a TON wallet, and uses
the STON.fi ecosystem so the guest can pay with a supported TON token. The
checkout uses a hardcoded 1% Omniston slippage limit, and the tablet accepts a
merchant-side difference of up to 0.01 USDT to avoid rounding dust blocking the
demo. The tablet remains the source of truth for item status and polls for
incoming USDT payments to mark pending items as paid.

## Demo Flow

1. Merchant adds custom items and USDT prices.
2. Merchant enters the receiving wallet and locks the order.
3. Customer selects unpaid items on the same tablet.
4. Customer taps Pay and scans the QR code with the phone Camera app.
5. Phone browser opens the checkout, connects Tonkeeper, and builds a STON.fi
   Omniston payment.
6. Tablet detects the incoming USDT payment and marks items paid.
7. When all items are paid, the board shows Paid in Full.

## Constraints

- No database.
- No backend.
- No smart contracts.
- One active checkout at a time.
- The tablet board is the source of truth for bill state.
- The phone checkout does not edit the tablet board directly.

## Tech Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- TonConnect UI
- STON.fi API
- STON.fi Omniston SDK
- TON Center v3 polling for demo payment detection

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

## API Key Note

For live Vercel testing with a TonConsole key, set:

```bash
VITE_TONAPI_API_KEY=your_tonconsole_key
```

Any `VITE_` value is public in the browser bundle, so do not use a valuable
secret key here.

For Vercel testing, add `VITE_TONAPI_API_KEY` in the project Environment
Variables settings, then redeploy the project. The browser sends it to TonAPI
as `Authorization: Bearer ...`.
