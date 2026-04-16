# TableTab

TableTab is a hackathon MVP for splitting a restaurant table bill on TON.

The app turns a single tablet into the restaurant board. A merchant enters a
table name, merchant wallet, and custom USDT-priced items, then locks the
order. After locking, the same tablet becomes the customer board: guests select
their unpaid items one at a time, add an optional tip, tap Pay, and scan a QR
code with their phone.

The phone checkout opens `/pay?checkout=...`, connects a TON wallet, and uses
the STON.fi ecosystem so the guest can pay with a supported TON token while the
merchant receives the exact total in USDT. The tablet remains the source of
truth for item status and polls for incoming USDT payments to mark pending items
as paid.

## Demo Flow

1. Merchant adds custom items and USDT prices.
2. Merchant enters the receiving wallet and locks the order.
3. Customer selects unpaid items on the same tablet.
4. Customer taps Pay and scans the QR code with Tonkeeper.
5. Phone checkout builds a STON.fi Omniston payment.
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

The tablet can poll TON Center v3 without a key. If rate limits become a
problem during testing, you can set:

```bash
VITE_TONCENTER_API_KEY=your_test_key
```

Any `VITE_` value is public in the browser bundle, so do not use a valuable
secret key here.
