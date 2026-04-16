import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import QRCodeDefault from 'react-qr-code'
import {
  centsToUsdtRawAmount,
  formatUsdt,
  parseUsdtToCents,
} from '../lib/amounts'
import {
  createCheckoutLink,
  createCheckoutPayload,
} from '../lib/checkoutPayload'
import { findIncomingUsdtPayment } from '../lib/tonCenter'
import type {
  BillItem,
  BillState,
  BoardState,
} from '../types/billing'

const STORAGE_KEY = 'tabletab-board-state'
const CHECKOUT_TIMEOUT_MS = 3 * 60 * 1000
const QRCode = (
  QRCodeDefault as unknown as {
    QRCode?: typeof QRCodeDefault
    default?: typeof QRCodeDefault
  }
).QRCode ?? (
  QRCodeDefault as unknown as {
    default?: typeof QRCodeDefault
  }
).default ?? QRCodeDefault

const emptyBill: BillState = {
  merchantWallet: '',
  orderName: '',
  isLocked: false,
  items: [],
}

function makeId() {
  return crypto.randomUUID()
}

function statusBadgeClass(status: BillItem['status']) {
  if (status === 'paid') {
    return 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
  }

  if (status === 'pending') {
    return 'bg-amber-100 text-amber-800 ring-1 ring-amber-200'
  }

  return 'bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200'
}

function itemRowClass(status: BillItem['status'], isSelected: boolean) {
  if (status === 'paid') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-950'
  }

  if (status === 'pending') {
    return 'border-amber-200 bg-amber-50 text-amber-950'
  }

  if (isSelected) {
    return 'border-zinc-950 bg-zinc-950 text-white'
  }

  return 'border-zinc-200 bg-white text-zinc-950'
}

function loadBoardState(): BoardState {
  const savedState = window.localStorage.getItem(STORAGE_KEY)

  if (!savedState) {
    return {
      bill: emptyBill,
      activeCheckout: null,
      usedPaymentTxHashes: [],
      lastPaymentMessage: '',
    }
  }

  try {
    const parsedState = JSON.parse(savedState) as BoardState
    const activeCheckout = parsedState.activeCheckout
      ? {
          ...parsedState.activeCheckout,
          subtotalCents:
            parsedState.activeCheckout.subtotalCents ??
            parsedState.activeCheckout.totalCents,
          tipCents: parsedState.activeCheckout.tipCents ?? 0,
          expectedUsdtRawAmount:
            parsedState.activeCheckout.expectedUsdtRawAmount ??
            centsToUsdtRawAmount(parsedState.activeCheckout.totalCents),
          createdAt: parsedState.activeCheckout.createdAt ?? new Date().toISOString(),
        }
      : null

    return {
      bill: {
        ...emptyBill,
        ...parsedState.bill,
      },
      activeCheckout,
      usedPaymentTxHashes: parsedState.usedPaymentTxHashes ?? [],
      lastPaymentMessage: parsedState.lastPaymentMessage ?? '',
    }
  } catch {
    return {
      bill: emptyBill,
      activeCheckout: null,
      usedPaymentTxHashes: [],
      lastPaymentMessage: '',
    }
  }
}

function BoardPage() {
  const [boardState, setBoardState] = useState<BoardState>(loadBoardState)
  const [itemName, setItemName] = useState('')
  const [itemPrice, setItemPrice] = useState('')
  const [tipAmount, setTipAmount] = useState('')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [copied, setCopied] = useState(false)

  const {
    bill,
    activeCheckout,
    usedPaymentTxHashes,
    lastPaymentMessage,
  } = boardState
  const unpaidItems = bill.items.filter((item) => item.status === 'unpaid')
  const pendingItems = bill.items.filter((item) => item.status === 'pending')
  const paidItems = bill.items.filter((item) => item.status === 'paid')
  const isPaidInFull =
    bill.isLocked &&
    bill.items.length > 0 &&
    unpaidItems.length === 0 &&
    pendingItems.length === 0
  const stageLabel = !bill.isLocked
    ? '1. Merchant setup'
    : isPaidInFull
      ? '4. Paid in full'
      : activeCheckout
        ? '3. Pending payment'
        : '2. Locked customer board'

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(boardState))
  }, [boardState])

  useEffect(() => {
    if (!activeCheckout) {
      return
    }

    const checkoutAge = Date.now() - new Date(activeCheckout.createdAt).getTime()
    const timeUntilTimeout = Math.max(CHECKOUT_TIMEOUT_MS - checkoutAge, 0)
    const timeoutId = window.setTimeout(() => {
      timeoutActiveCheckout(activeCheckout.id)
    }, timeUntilTimeout)

    return () => window.clearTimeout(timeoutId)
  }, [activeCheckout])

  useEffect(() => {
    if (!activeCheckout) {
      return
    }

    let isActive = true
    let isPolling = false

    async function pollForPayment() {
      if (!activeCheckout || isPolling) {
        return
      }

      isPolling = true

      try {
        const payment = await findIncomingUsdtPayment({
          merchantWallet: bill.merchantWallet,
          expectedUsdtRawAmount: activeCheckout.expectedUsdtRawAmount,
          createdAt: activeCheckout.createdAt,
          usedTxHashes: usedPaymentTxHashes,
        })

        if (payment && isActive) {
          setBoardState((currentState) => {
            if (currentState.activeCheckout?.id !== activeCheckout.id) {
              return currentState
            }

            return {
              ...currentState,
              bill: {
                ...currentState.bill,
                items: currentState.bill.items.map((item) =>
                  activeCheckout.itemIds.includes(item.id)
                    ? { ...item, status: 'paid' }
                    : item,
                ),
              },
              activeCheckout: null,
              usedPaymentTxHashes: [
                ...currentState.usedPaymentTxHashes,
                payment.hash,
              ],
              lastPaymentMessage: `Payment detected. Transaction ${payment.hash}`,
            }
          })
        }
      } catch (pollError) {
        if (isActive) {
          setBoardState((currentState) => ({
            ...currentState,
            lastPaymentMessage:
              pollError instanceof Error
                ? pollError.message
                : 'Payment polling failed.',
          }))
        }
      } finally {
        isPolling = false
      }
    }

    pollForPayment()
    const intervalId = window.setInterval(pollForPayment, 3_000)

    return () => {
      isActive = false
      window.clearInterval(intervalId)
    }
  }, [activeCheckout, bill.merchantWallet, usedPaymentTxHashes])

  const selectedItems = useMemo(
    () => bill.items.filter((item) => selectedItemIds.includes(item.id)),
    [bill.items, selectedItemIds],
  )

  const selectedTotalCents = selectedItems.reduce(
    (total, item) => total + item.priceCents,
    0,
  )
  const tipCents = parseUsdtToCents(tipAmount)
  const checkoutTotalCents = selectedTotalCents + tipCents

  function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const priceCents = parseUsdtToCents(itemPrice)
    if (!itemName.trim() || Number.isNaN(priceCents) || priceCents <= 0) {
      return
    }

    const nextItem: BillItem = {
      id: makeId(),
      name: itemName.trim(),
      priceCents,
      status: 'unpaid',
    }

    setBoardState((currentState) => ({
      ...currentState,
      bill: {
        ...currentState.bill,
        items: [...currentState.bill.items, nextItem],
      },
    }))
    setItemName('')
    setItemPrice('')
  }

  function lockOrder() {
    if (
      !bill.merchantWallet.trim() ||
      !bill.orderName.trim() ||
      bill.items.length === 0
    ) {
      return
    }

    setBoardState((currentState) => ({
      ...currentState,
      bill: {
        ...currentState.bill,
        merchantWallet: currentState.bill.merchantWallet.trim(),
        orderName: currentState.bill.orderName.trim(),
        isLocked: true,
      },
    }))
  }

  function toggleItem(itemId: string) {
    setSelectedItemIds((currentIds) =>
      currentIds.includes(itemId)
        ? currentIds.filter((id) => id !== itemId)
        : [...currentIds, itemId],
    )
  }

  function startCheckout() {
    if (activeCheckout || selectedItems.length === 0) {
      return
    }

    const checkoutId = makeId()
    const createdAt = new Date().toISOString()
    const expectedUsdtRawAmount = centsToUsdtRawAmount(checkoutTotalCents)
    const payload = createCheckoutPayload({
      checkoutId,
      merchantWallet: bill.merchantWallet,
      orderName: bill.orderName,
      items: selectedItems.map((item) => ({
        id: item.id,
        name: item.name,
        priceCents: item.priceCents,
      })),
      subtotalCents: selectedTotalCents,
      tipCents,
      totalCents: checkoutTotalCents,
      expectedUsdtRawAmount,
      createdAt,
    })
    const checkoutLink = createCheckoutLink(payload)

    setBoardState((currentState) => ({
      ...currentState,
      bill: {
        ...currentState.bill,
        items: currentState.bill.items.map((item) =>
          selectedItemIds.includes(item.id)
            ? { ...item, status: 'pending' }
            : item,
        ),
      },
      activeCheckout: {
        id: checkoutId,
        itemIds: selectedItemIds,
        subtotalCents: selectedTotalCents,
        tipCents,
        totalCents: checkoutTotalCents,
        expectedUsdtRawAmount,
        createdAt,
        checkoutLink,
      },
      lastPaymentMessage: 'Waiting for USDT payment.',
    }))
    setSelectedItemIds([])
    setTipAmount('')
    setCopied(false)
  }

  function markActiveCheckoutPaid(txHash?: string) {
    if (!activeCheckout) {
      return
    }

    setBoardState((currentState) => ({
      ...currentState,
      bill: {
        ...currentState.bill,
        items: currentState.bill.items.map((item) =>
          activeCheckout.itemIds.includes(item.id)
            ? { ...item, status: 'paid' }
            : item,
        ),
      },
      activeCheckout: null,
      usedPaymentTxHashes: txHash
        ? [...currentState.usedPaymentTxHashes, txHash]
        : currentState.usedPaymentTxHashes,
      lastPaymentMessage: txHash
        ? `Payment detected. Transaction ${txHash}`
        : 'Payment detected.',
    }))
  }

  function cancelActiveCheckout() {
    if (!activeCheckout) {
      return
    }

    setBoardState((currentState) => ({
      ...currentState,
      bill: {
        ...currentState.bill,
        items: currentState.bill.items.map((item) =>
          activeCheckout.itemIds.includes(item.id)
            ? { ...item, status: 'unpaid' }
            : item,
        ),
      },
      activeCheckout: null,
      lastPaymentMessage: 'Pending payment canceled.',
    }))
    setCopied(false)
  }

  function timeoutActiveCheckout(checkoutId: string) {
    setBoardState((currentState) => {
      if (currentState.activeCheckout?.id !== checkoutId) {
        return currentState
      }

      return {
        ...currentState,
        bill: {
          ...currentState.bill,
          items: currentState.bill.items.map((item) =>
            currentState.activeCheckout?.itemIds.includes(item.id)
              ? { ...item, status: 'unpaid' }
              : item,
          ),
        },
        activeCheckout: null,
        lastPaymentMessage: 'Checkout timed out. Items returned to unpaid.',
      }
    })
    setCopied(false)
  }

  async function copyCheckoutLink() {
    if (!activeCheckout) {
      return
    }

    await navigator.clipboard.writeText(activeCheckout.checkoutLink)
    setCopied(true)
  }

  function resetDemo() {
    window.localStorage.removeItem(STORAGE_KEY)
    setBoardState({
      bill: emptyBill,
      activeCheckout: null,
      usedPaymentTxHashes: [],
      lastPaymentMessage: '',
    })
    setItemName('')
    setItemPrice('')
    setTipAmount('')
    setSelectedItemIds([])
    setCopied(false)
  }

  if (!bill.isLocked) {
    return (
      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
        <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
            {stageLabel}
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-normal">
            Build the table bill
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-zinc-600">
            Add the items for this table, enter the merchant wallet, then lock
            the order before handing the tablet to customers.
          </p>

          <form
            className="mt-8 grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]"
            onSubmit={addItem}
          >
            <label className="grid gap-2 text-base font-semibold text-zinc-700">
              Item name
              <input
                className="rounded-lg border border-zinc-300 px-4 py-4 text-xl font-normal"
                value={itemName}
                onChange={(event) => setItemName(event.target.value)}
                placeholder="Burger"
              />
            </label>
            <label className="grid gap-2 text-base font-semibold text-zinc-700">
              Price in USDT
              <input
                className="rounded-lg border border-zinc-300 px-4 py-4 text-xl font-normal"
                inputMode="decimal"
                value={itemPrice}
                onChange={(event) => setItemPrice(event.target.value)}
                placeholder="18.50"
              />
            </label>
            <button className="rounded-lg bg-zinc-950 px-6 py-4 text-lg font-semibold text-white md:col-span-2">
              Add item
            </button>
          </form>

          <div className="mt-8 grid gap-3">
            {bill.items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-lg text-zinc-600">
                No items added yet.
              </p>
            ) : (
              bill.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 bg-stone-50 p-5 text-xl"
                >
                  <span className="font-semibold">{item.name}</span>
                  <span className="font-semibold">{formatUsdt(item.priceCents)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <aside className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-semibold tracking-normal">
            Order details
          </h2>
          <label className="mt-6 grid gap-2 text-base font-semibold text-zinc-700">
            Table or order name
            <input
              className="rounded-lg border border-zinc-300 px-4 py-4 text-xl font-normal"
              value={bill.orderName}
              onChange={(event) =>
                setBoardState((currentState) => ({
                  ...currentState,
                  bill: {
                    ...currentState.bill,
                    orderName: event.target.value,
                  },
                }))
              }
              placeholder="Table 7"
            />
          </label>
          <label className="mt-5 grid gap-2 text-base font-semibold text-zinc-700">
            USDT receiving wallet
            <input
              className="rounded-lg border border-zinc-300 px-4 py-4 text-xl font-normal"
              value={bill.merchantWallet}
              onChange={(event) =>
                setBoardState((currentState) => ({
                  ...currentState,
                  bill: {
                    ...currentState.bill,
                    merchantWallet: event.target.value,
                  },
                }))
              }
              placeholder="EQ..."
            />
          </label>
          <button
            className="mt-6 w-full rounded-lg bg-emerald-700 px-5 py-5 text-xl font-bold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            disabled={
              !bill.merchantWallet.trim() ||
              !bill.orderName.trim() ||
              bill.items.length === 0
            }
            onClick={lockOrder}
          >
            Lock order
          </button>
          <button
            className="mt-3 w-full rounded-lg border border-zinc-300 px-5 py-4 text-lg font-semibold"
            onClick={resetDemo}
          >
            Reset Demo
          </button>
          <p className="mt-5 text-base text-zinc-600">
            After locking, this same tablet becomes the customer board. No
            separate item-selection page is used.
          </p>
        </aside>
      </section>
    )
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
      <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        {isPaidInFull ? (
          <div className="mb-6 rounded-lg bg-emerald-600 p-8 text-center text-6xl font-black tracking-normal text-white shadow-sm">
            Paid in Full
          </div>
        ) : null}

        <p className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
          {stageLabel}
        </p>
        <h1 className="mt-4 text-5xl font-semibold tracking-normal">
          {bill.orderName}
        </h1>
        <h2 className="mt-3 text-2xl font-semibold tracking-normal">
          {activeCheckout ? 'Scan to finish payment' : 'Select unpaid items'}
        </h2>
        {lastPaymentMessage ? (
          <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-lg font-semibold text-emerald-800">
            {lastPaymentMessage}
          </p>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          {bill.items.map((item) => {
            const isSelected = selectedItemIds.includes(item.id)
            const canSelect = item.status === 'unpaid' && !activeCheckout

            return (
              <button
                key={item.id}
                className={[
                  'flex min-h-32 flex-col justify-between rounded-lg border p-5 text-left shadow-sm transition disabled:cursor-not-allowed',
                  itemRowClass(item.status, isSelected),
                  canSelect ? 'active:scale-[0.99]' : 'opacity-80',
                ].join(' ')}
                disabled={!canSelect}
                onClick={() => toggleItem(item.id)}
              >
                <span className="flex min-w-0 flex-col gap-4">
                  <span className="break-words text-2xl font-bold">
                    {item.name}
                  </span>
                  <span
                    className={[
                      'w-fit rounded-full px-3 py-1 text-sm font-bold uppercase',
                      statusBadgeClass(item.status),
                    ].join(' ')}
                  >
                    {item.status}
                  </span>
                </span>
                <span className="mt-5 flex items-center justify-between gap-3">
                  <span className="text-xl font-bold">
                    {formatUsdt(item.priceCents)}
                  </span>
                  <span
                    className={[
                      'inline-flex h-9 w-9 items-center justify-center rounded border text-lg font-bold',
                      isSelected
                        ? 'border-emerald-700 bg-emerald-700 text-white'
                        : 'border-zinc-300 bg-white text-white',
                    ].join(' ')}
                  >
                    ✓
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-6 grid gap-5 rounded-lg border border-zinc-200 bg-stone-50 p-5">
          <label className="grid gap-2 text-base font-semibold text-zinc-700 sm:max-w-xs">
            Optional tip in USDT
            <input
              className="rounded-lg border border-zinc-300 px-4 py-4 text-xl font-normal"
              disabled={Boolean(activeCheckout)}
              inputMode="decimal"
              value={tipAmount}
              onChange={(event) => setTipAmount(event.target.value)}
              placeholder="0.00"
            />
          </label>

          <div className="grid gap-3 text-lg sm:max-w-md">
            <div className="flex justify-between gap-4">
              <span>Selected subtotal</span>
              <span className="font-medium">{formatUsdt(selectedTotalCents)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Tip</span>
              <span className="font-medium">{formatUsdt(tipCents)}</span>
            </div>
            <div className="flex justify-between gap-4 border-t border-zinc-200 pt-3 text-2xl font-bold">
              <span>Total</span>
              <span>{formatUsdt(checkoutTotalCents)}</span>
            </div>
          </div>

          <button
            className="w-full rounded-lg bg-zinc-950 px-8 py-5 text-2xl font-bold text-white disabled:cursor-not-allowed disabled:bg-zinc-300 sm:w-fit"
            disabled={selectedItemIds.length === 0 || Boolean(activeCheckout)}
            onClick={startCheckout}
          >
            Pay
          </button>
        </div>
      </div>

      <aside className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-normal">Demo flow</h2>
        <p className="mt-2 text-sm text-zinc-600">{bill.orderName}</p>

        <ol className="mt-5 grid gap-3 text-lg font-semibold">
          <li className="rounded-lg bg-stone-100 p-4">1. Select your items</li>
          <li className="rounded-lg bg-stone-100 p-4">2. Tap Pay</li>
          <li className="rounded-lg bg-stone-100 p-4">
            3. Scan QR with Tonkeeper
          </li>
          <li className="rounded-lg bg-stone-100 p-4">
            4. Pay with any token
          </li>
        </ol>

        {activeCheckout ? (
          <div className="mt-6 grid gap-4 rounded-lg border-2 border-zinc-950 bg-white p-5">
            <p className="inline-flex w-fit rounded-full bg-amber-100 px-3 py-1 text-sm font-bold uppercase text-amber-800 ring-1 ring-amber-200">
              Pending payment
            </p>
            <div className="rounded-lg border border-zinc-200 bg-white p-5">
              <QRCode
                value={activeCheckout.checkoutLink}
                className="mx-auto h-auto w-full max-w-96"
              />
            </div>
            <p className="text-center text-3xl font-black">
              Checkout total: {formatUsdt(activeCheckout.totalCents)}
            </p>
            <div className="grid gap-2 rounded-lg bg-stone-50 p-4 text-base">
              <div className="flex justify-between gap-4">
                <span>Subtotal</span>
                <span>{formatUsdt(activeCheckout.subtotalCents)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Tip</span>
                <span>{formatUsdt(activeCheckout.tipCents)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>USDT raw amount</span>
                <span className="break-all text-right">
                  {activeCheckout.expectedUsdtRawAmount}
                </span>
              </div>
            </div>
            <p className="text-sm text-zinc-600">
              Selected items are pending while the tablet polls TON Center v3
              every 3 seconds for incoming USDT to the merchant wallet.
            </p>
            <p className="text-sm text-zinc-600">
              This checkout times out after 3 minutes.
            </p>
            <input
              className="rounded-lg border border-zinc-300 px-3 py-3 text-sm"
              readOnly
              value={activeCheckout.checkoutLink}
            />
            <button
              className="rounded-lg border border-zinc-300 px-4 py-3 text-lg font-semibold"
              onClick={copyCheckoutLink}
            >
              {copied ? 'Copied' : 'Copy checkout link'}
            </button>
            <button
              className="rounded-lg border border-red-300 px-4 py-3 text-lg font-semibold text-red-700"
              onClick={cancelActiveCheckout}
            >
              Cancel pending payment
            </button>
            {import.meta.env.DEV ? (
              <button
                className="rounded-lg bg-emerald-700 px-4 py-3 text-lg font-semibold text-white"
                onClick={() => markActiveCheckoutPaid()}
              >
                Simulate Payment
              </button>
            ) : null}
          </div>
        ) : (
          <p className="mt-6 rounded-lg border border-dashed border-zinc-300 p-5 text-lg text-zinc-600">
            No active checkout. The next customer can select unpaid items.
          </p>
        )}

        <div className="mt-6 grid grid-cols-3 gap-3 text-center text-sm font-semibold">
          <div className="rounded-lg bg-zinc-100 p-4 text-zinc-700 ring-1 ring-zinc-200">
            <strong className="block text-2xl">{unpaidItems.length}</strong>
            Unpaid
          </div>
          <div className="rounded-lg bg-amber-100 p-4 text-amber-800 ring-1 ring-amber-200">
            <strong className="block text-2xl">{pendingItems.length}</strong>
            Pending
          </div>
          <div className="rounded-lg bg-emerald-100 p-4 text-emerald-800 ring-1 ring-emerald-200">
            <strong className="block text-2xl">{paidItems.length}</strong>
            Paid
          </div>
        </div>
        {usedPaymentTxHashes.length > 0 ? (
          <p className="mt-4 break-all text-xs text-zinc-500">
            Last used tx hash:{' '}
            {usedPaymentTxHashes[usedPaymentTxHashes.length - 1]}
          </p>
        ) : null}
        <button
          className="mt-6 w-full rounded-lg border border-zinc-300 px-5 py-4 text-lg font-semibold"
          onClick={resetDemo}
        >
          Reset Demo
        </button>
      </aside>
    </section>
  )
}

export default BoardPage
