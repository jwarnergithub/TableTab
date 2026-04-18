import { AssetTag, StonApiClient } from '@ston-fi/api'
import {
  GaslessSettlement,
  SettlementMethod,
  useOmniston,
  type Quote,
  type TradeStatus,
} from '@ston-fi/omniston-sdk-react'
import {
  TonConnectButton,
  useTonAddress,
  useTonConnectUI,
  useTonWallet,
} from '@tonconnect/ui-react'
import { Cell } from '@ton/core'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import QRCodeDefault from 'react-qr-code'
import {
  addRawAmounts,
  centsToUsdtRawAmount,
  formatTokenAmountFixed,
  parseTokenAmountToRaw,
  parseUsdtToCents,
} from '../lib/amounts'
import {
  createCheckoutLink,
  createCheckoutPayload,
  createJettonTransferLink,
} from '../lib/checkoutPayload'
import {
  FALLBACK_RECEIVE_ASSET,
  TON_ASSET_ADDRESS,
} from '../lib/constants'
import {
  firstQuoteFromOmniston,
  isFilledTrade,
  mapTransferToTonConnectTransaction,
  toTonAddress,
  tradeStatusLabel,
  unitsToDisplay,
} from '../lib/omnistonPayment'
import { findIncomingUsdtPayment } from '../lib/paymentPolling'
import type {
  BillItem,
  BillState,
  BoardState,
  ReceiveAsset,
} from '../types/billing'

const STORAGE_KEY = 'tabletab-board-state'
const CHECKOUT_TIMEOUT_MS = 2 * 60 * 1000
const PAYMENT_POLL_INTERVAL_MS = 1_000
const OMNISTON_SLIPPAGE_BPS = 100
const stonApiClient = new StonApiClient()
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
  receiveAsset: FALLBACK_RECEIVE_ASSET,
  isLocked: false,
  items: [],
}

function makeId() {
  return crypto.randomUUID()
}

function shortHash(hash: string) {
  if (hash.length <= 16) {
    return hash
  }

  return `${hash.slice(0, 8)}...${hash.slice(-6)}`
}

function collapseLongHashes(message: string) {
  return message.replace(/[A-Za-z0-9_-]{24,}/g, (value) => shortHash(value))
}

function itemRawAmount(item: BillItem) {
  return item.priceRawAmount ?? centsToUsdtRawAmount(item.priceCents)
}

function itemDisplayAmount(item: BillItem, receiveAsset: ReceiveAsset) {
  return formatTokenAmountFixed(
    itemRawAmount(item),
    receiveAsset.decimals,
    receiveAsset.symbol,
  )
}

function assetFromApiAsset(asset: {
  contractAddress: string
  meta?: {
    symbol?: string
    displayName?: string
    decimals?: number
  }
}): ReceiveAsset {
  return {
    address: asset.contractAddress,
    symbol: asset.meta?.symbol ?? asset.contractAddress,
    displayName: asset.meta?.displayName ?? asset.meta?.symbol ?? 'Token',
    decimals: asset.meta?.decimals ?? 9,
  }
}

function uniqueAssets(assets: ReceiveAsset[]) {
  const seenAssets = new Set<string>()

  return assets.filter((asset) => {
    if (seenAssets.has(asset.address)) {
      return false
    }

    seenAssets.add(asset.address)
    return true
  })
}

function statusBadgeClass(status: BillItem['status']) {
  if (status === 'paid') {
    return 'bg-emerald-300/15 text-emerald-200 ring-1 ring-emerald-300/50'
  }

  if (status === 'pending') {
    return 'bg-amber-300/15 text-amber-200 ring-1 ring-amber-300/50'
  }

  return 'bg-cyan-300/10 text-cyan-100 ring-1 ring-cyan-300/40'
}

function itemRowClass(status: BillItem['status'], isSelected: boolean) {
  if (status === 'paid') {
    return 'border-emerald-300/60 bg-emerald-300/12 text-emerald-50 shadow-[0_0_24px_rgba(77,255,176,0.13)]'
  }

  if (status === 'pending') {
    return 'border-amber-300/60 bg-amber-300/12 text-amber-50 shadow-[0_0_24px_rgba(248,204,93,0.13)]'
  }

  if (isSelected) {
    return 'border-cyan-300 bg-cyan-300/18 text-white shadow-[0_0_28px_rgba(57,245,236,0.28)]'
  }

  return 'border-cyan-300/24 bg-slate-950/35 text-white'
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
    const receiveAsset = FALLBACK_RECEIVE_ASSET
    const savedReceiveAssetAddress =
      parsedState.bill.receiveAsset?.address ?? FALLBACK_RECEIVE_ASSET.address
    const savedBoardWasUsdt =
      savedReceiveAssetAddress === FALLBACK_RECEIVE_ASSET.address
    const activeCheckout = savedBoardWasUsdt && parsedState.activeCheckout
      ? {
          ...parsedState.activeCheckout,
          receiveAsset,
          subtotalCents:
            parsedState.activeCheckout.subtotalCents ??
            parsedState.activeCheckout.totalCents,
          tipCents: parsedState.activeCheckout.tipCents ?? 0,
          expectedUsdtRawAmount:
            parsedState.activeCheckout.expectedUsdtRawAmount ??
            centsToUsdtRawAmount(parsedState.activeCheckout.totalCents),
          expectedReceiveRawAmount:
            parsedState.activeCheckout.expectedReceiveRawAmount ??
            parsedState.activeCheckout.expectedUsdtRawAmount ??
            centsToUsdtRawAmount(parsedState.activeCheckout.totalCents),
          createdAt: parsedState.activeCheckout.createdAt ?? new Date().toISOString(),
        }
      : null

    return {
      bill: {
        ...emptyBill,
        ...parsedState.bill,
        receiveAsset: FALLBACK_RECEIVE_ASSET,
        items: parsedState.bill.items.map((item) => ({
          ...item,
          status:
            savedBoardWasUsdt || item.status !== 'pending'
              ? item.status
              : 'unpaid',
          priceRawAmount:
            savedBoardWasUsdt && item.priceRawAmount
              ? item.priceRawAmount
              : centsToUsdtRawAmount(item.priceCents),
        })),
      },
      activeCheckout,
      usedPaymentTxHashes: parsedState.usedPaymentTxHashes ?? [],
      lastPaymentMessage: savedBoardWasUsdt
        ? parsedState.lastPaymentMessage ?? ''
        : 'Merchant settlement reset to USDT. Start a fresh checkout.',
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
  const omniston = useOmniston()
  const wallet = useTonWallet()
  const payerWalletAddress = useTonAddress(false)
  const walletAssetAddress = useTonAddress()
  const [tonConnectUI] = useTonConnectUI()
  const [boardState, setBoardState] = useState<BoardState>(loadBoardState)
  const [itemName, setItemName] = useState('')
  const [itemPrice, setItemPrice] = useState('')
  const [tipAmount, setTipAmount] = useState('')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [paymentAssets, setPaymentAssets] = useState<ReceiveAsset[]>([
    FALLBACK_RECEIVE_ASSET,
  ])
  const [selectedPaymentAssetAddress, setSelectedPaymentAssetAddress] = useState('')
  const [tabletQuote, setTabletQuote] = useState<Quote | null>(null)
  const [tabletTradeStatus, setTabletTradeStatus] = useState<TradeStatus | null>(null)
  const [tabletPaymentStatus, setTabletPaymentStatus] = useState('')
  const [tabletPaymentError, setTabletPaymentError] = useState('')
  const [isTabletPaying, setIsTabletPaying] = useState(false)

  const {
    bill,
    activeCheckout,
    usedPaymentTxHashes,
    lastPaymentMessage,
  } = boardState
  const receiveAsset = FALLBACK_RECEIVE_ASSET
  const unpaidItems = bill.items.filter((item) => item.status === 'unpaid')
  const pendingItems = bill.items.filter((item) => item.status === 'pending')
  const paidItems = bill.items.filter((item) => item.status === 'paid')
  const isPaidInFull =
    bill.isLocked &&
    bill.items.length > 0 &&
    unpaidItems.length === 0 &&
    pendingItems.length === 0
  const setupStageLabel = '1. Merchant setup'

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(boardState))
  }, [boardState])

  useEffect(() => {
    let isActive = true

    async function loadPaymentAssets() {
      try {
        const assets = await stonApiClient.queryAssets({
          condition: [
            AssetTag.Essential,
            AssetTag.Popular,
            AssetTag.LiquidityVeryHigh,
            AssetTag.WalletHasBalance,
          ].join(' | '),
          walletAddress: walletAssetAddress || undefined,
          limit: 40,
          sortBy: ['popularity_index:desc'],
        })

        if (!isActive) {
          return
        }

        const nextAssets = uniqueAssets([
          {
            address: TON_ASSET_ADDRESS,
            symbol: 'TON',
            displayName: 'Toncoin',
            decimals: 9,
          },
          FALLBACK_RECEIVE_ASSET,
          ...assets
            .filter((asset) => asset.kind !== 'NotAnAsset')
            .map(assetFromApiAsset),
        ])

        setPaymentAssets(nextAssets)
        setSelectedPaymentAssetAddress((currentAddress) =>
          currentAddress || nextAssets[0]?.address || '',
        )
      } catch {
        const fallbackAssets = [
          {
            address: TON_ASSET_ADDRESS,
            symbol: 'TON',
            displayName: 'Toncoin',
            decimals: 9,
          },
          FALLBACK_RECEIVE_ASSET,
        ]

        setPaymentAssets(fallbackAssets)
        setSelectedPaymentAssetAddress((currentAddress) =>
          currentAddress || TON_ASSET_ADDRESS,
        )
      }
    }

    loadPaymentAssets()

    return () => {
      isActive = false
    }
  }, [walletAssetAddress])

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
          jettonMaster:
            activeCheckout.receiveAsset?.address ?? receiveAsset.address,
          expectedUsdtRawAmount: activeCheckout.expectedUsdtRawAmount,
          expectedRawAmount:
            activeCheckout.expectedReceiveRawAmount ??
            activeCheckout.expectedUsdtRawAmount,
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
              lastPaymentMessage: `Payment detected. Received ${formatTokenAmountFixed(
                payment.amount,
                activeCheckout.receiveAsset?.decimals ?? receiveAsset.decimals,
                activeCheckout.receiveAsset?.symbol ?? receiveAsset.symbol,
              )}. Transaction ${shortHash(payment.hash)}`,
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
    const intervalId = window.setInterval(
      pollForPayment,
      PAYMENT_POLL_INTERVAL_MS,
    )

    return () => {
      isActive = false
      window.clearInterval(intervalId)
    }
  }, [activeCheckout, bill.merchantWallet, receiveAsset, usedPaymentTxHashes])

  const selectedItems = useMemo(
    () => bill.items.filter((item) => selectedItemIds.includes(item.id)),
    [bill.items, selectedItemIds],
  )
  const selectedPaymentAsset = paymentAssets.find(
    (asset) => asset.address === selectedPaymentAssetAddress,
  )

  const selectedTotalCents = selectedItems.reduce(
    (total, item) => total + item.priceCents,
    0,
  )
  const tipCents = parseUsdtToCents(tipAmount)
  const checkoutTotalCents = selectedTotalCents + tipCents
  const selectedTotalRawAmount = addRawAmounts(
    selectedItems.map((item) => itemRawAmount(item)),
  )
  const tipRawAmount = parseTokenAmountToRaw(tipAmount, receiveAsset.decimals) || '0'
  const checkoutTotalRawAmount = (
    BigInt(selectedTotalRawAmount || '0') + BigInt(tipRawAmount || '0')
  ).toString()

  function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const priceCents = parseUsdtToCents(itemPrice)
    const priceRawAmount = parseTokenAmountToRaw(itemPrice, receiveAsset.decimals)

    if (
      !itemName.trim() ||
      Number.isNaN(priceCents) ||
      priceCents <= 0 ||
      !priceRawAmount ||
      BigInt(priceRawAmount) <= 0n
    ) {
      return
    }

    const nextItem: BillItem = {
      id: makeId(),
      name: itemName.trim(),
      priceCents,
      priceRawAmount,
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
        receiveAsset,
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

  function startCheckout(paymentMode: 'direct' | 'omniston') {
    if (activeCheckout || selectedItems.length === 0) {
      return
    }

    const checkoutId = makeId()
    const createdAt = new Date().toISOString()
    const expectedUsdtRawAmount = checkoutTotalRawAmount
    const directPaymentLink = createJettonTransferLink({
      merchantWallet: bill.merchantWallet,
      jettonMaster: receiveAsset.address,
      amountRaw: checkoutTotalRawAmount,
      checkoutId,
    })
    const payload = createCheckoutPayload({
      checkoutId,
      merchantWallet: bill.merchantWallet,
      orderName: bill.orderName,
      items: selectedItems.map((item) => ({
        id: item.id,
        name: item.name,
        priceCents: item.priceCents,
        priceRawAmount: itemRawAmount(item),
      })),
      subtotalCents: selectedTotalCents,
      tipCents,
      totalCents: checkoutTotalCents,
      expectedUsdtRawAmount,
      receiveAsset,
      expectedReceiveRawAmount: checkoutTotalRawAmount,
      directPaymentLink,
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
        receiveAsset,
        expectedReceiveRawAmount: checkoutTotalRawAmount,
        directPaymentLink,
        paymentMode,
        createdAt,
        checkoutLink,
      },
      lastPaymentMessage: `Waiting for ${receiveAsset.symbol} payment.`,
    }))
    setSelectedItemIds([])
    setTipAmount('')
    setCopied(false)
    setTabletQuote(null)
    setTabletTradeStatus(null)
    setTabletPaymentStatus('')
    setTabletPaymentError('')
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
        ? `Payment detected. Transaction ${shortHash(txHash)}`
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

    await navigator.clipboard.writeText(
      activeCheckout.paymentMode === 'direct'
        ? activeCheckout.directPaymentLink ?? activeCheckout.checkoutLink
        : activeCheckout.checkoutLink,
    )
    setCopied(true)
  }

  async function payActiveCheckoutWithTabletWallet() {
    if (
      !activeCheckout ||
      !wallet ||
      !payerWalletAddress ||
      !selectedPaymentAsset
    ) {
      return
    }

    setIsTabletPaying(true)
    setTabletPaymentError('')
    setTabletQuote(null)
    setTabletTradeStatus(null)

    try {
      setTabletPaymentStatus('Requesting STON.fi Omniston quote.')
      const nextQuote = await firstQuoteFromOmniston(
        omniston.requestForQuote({
          bidAssetAddress: toTonAddress(selectedPaymentAsset.address),
          askAssetAddress: toTonAddress(
            activeCheckout.receiveAsset?.address ?? receiveAsset.address,
          ),
          amount: {
            askUnits:
              activeCheckout.expectedReceiveRawAmount ??
              activeCheckout.expectedUsdtRawAmount,
          },
          settlementMethods: [SettlementMethod.SETTLEMENT_METHOD_SWAP],
          settlementParams: {
            gaslessSettlement: GaslessSettlement.GASLESS_SETTLEMENT_PROHIBITED,
            maxOutgoingMessages: 4,
            maxPriceSlippageBps: OMNISTON_SLIPPAGE_BPS,
          },
        }),
      )
      setTabletQuote(nextQuote)

      setTabletPaymentStatus('Building wallet transfer.')
      const transfer = await omniston.buildTransfer({
        sourceAddress: toTonAddress(payerWalletAddress),
        destinationAddress: toTonAddress(bill.merchantWallet),
        gasExcessAddress: toTonAddress(payerWalletAddress),
        quote: nextQuote,
        useRecommendedSlippage: true,
      })
      const transaction = mapTransferToTonConnectTransaction(transfer)

      setTabletPaymentStatus('Waiting for wallet confirmation.')
      const result = await tonConnectUI.sendTransaction(transaction)
      setTabletPaymentStatus('Transaction sent. Tracking trade status.')

      const outgoingTxHash = Cell.fromBase64(result.boc).hash().toString('hex')
      omniston
        .trackTrade({
          quoteId: nextQuote.quoteId,
          traderWalletAddress: toTonAddress(payerWalletAddress),
          outgoingTxHash,
        })
        .subscribe({
          next: (nextStatus) => {
            setTabletTradeStatus(nextStatus)
            setTabletPaymentStatus(tradeStatusLabel(nextStatus))

            if (isFilledTrade(nextStatus)) {
              void tonConnectUI.disconnect()
            }
          },
          error: (trackError: unknown) => {
            setTabletPaymentError(
              trackError instanceof Error
                ? trackError.message
                : 'Trade tracking failed.',
            )
          },
        })
    } catch (paymentError) {
      setTabletPaymentError(
        paymentError instanceof Error
          ? paymentError.message
          : 'Payment failed before it was sent.',
      )
      setTabletPaymentStatus('Payment was not completed.')
    } finally {
      setIsTabletPaying(false)
    }
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
    setTabletQuote(null)
    setTabletTradeStatus(null)
    setTabletPaymentStatus('')
    setTabletPaymentError('')
  }

  if (!bill.isLocked) {
    return (
      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
        <div className="ston-panel p-6">
          <p className="ston-kicker inline-flex px-3 py-1 text-sm font-bold uppercase">
            {setupStageLabel}
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-normal">
            Create Bill
          </h1>
          <p className="ston-text-muted mt-3 max-w-2xl text-lg">
            Add the items for this order, enter the merchant wallet, then lock
            the order before handing the tablet to customers.
          </p>

          <p className="mt-4 max-w-2xl text-base font-semibold text-cyan-100">
            Merchant receives <span className="text-cyan-300">USDT</span>.
          </p>

          <form
            className="mt-8 grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]"
            onSubmit={addItem}
          >
            <label className="grid min-w-0 gap-2 text-base font-semibold text-cyan-50">
              Item name
              <input
                className="ston-input px-4 py-4 text-xl font-normal"
                value={itemName}
                onChange={(event) => setItemName(event.target.value)}
                placeholder="Burger"
              />
            </label>
            <label className="grid min-w-0 gap-2 text-base font-semibold text-cyan-50">
              Price in {receiveAsset.symbol}
              <input
                className="ston-input px-4 py-4 text-xl font-normal"
                inputMode="decimal"
                value={itemPrice}
                onChange={(event) => setItemPrice(event.target.value)}
                placeholder="18.50"
              />
            </label>
            <button className="ston-button-primary px-6 py-4 text-lg font-bold md:col-span-2">
              Add item
            </button>
          </form>

          <div className="mt-8 grid gap-3">
            {bill.items.length === 0 ? (
              <p className="ston-dashed ston-text-muted p-6 text-lg">
                No items added yet.
              </p>
            ) : (
              bill.items.map((item) => (
                <div
                  key={item.id}
                  className="ston-card-muted flex items-center justify-between gap-4 p-5 text-xl"
                >
                  <span className="font-semibold">{item.name}</span>
                  <span className="font-semibold">
                    {itemDisplayAmount(item, receiveAsset)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <aside className="ston-panel p-6">
          <h2 className="text-2xl font-semibold tracking-normal">
            Order details
          </h2>
          <label className="mt-6 grid gap-2 text-base font-semibold text-cyan-50">
            Table or order name
            <input
              className="ston-input px-4 py-4 text-xl font-normal"
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
          <label className="mt-5 grid gap-2 text-base font-semibold text-cyan-50">
            Receiving wallet
            <input
              className="ston-input px-4 py-4 text-xl font-normal"
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
            className="ston-button-primary mt-6 w-full px-5 py-5 text-xl font-bold disabled:cursor-not-allowed"
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
            className="ston-button-secondary mt-3 w-full px-5 py-4 text-lg font-semibold"
            onClick={resetDemo}
          >
            Reset
          </button>
          <p className="ston-text-muted mt-5 text-base">
            After locking, this same tablet becomes the customer board. No
            separate item-selection page is used.
          </p>
        </aside>
      </section>
    )
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
      <div className="ston-panel p-6">
        {isPaidInFull ? (
          <div className="ston-success-banner mb-6 grid gap-5 p-8 text-center">
            <p className="text-6xl font-black tracking-normal">
              Paid in Full
            </p>
            <button
              className="mx-auto rounded-lg bg-slate-950/80 px-6 py-3 text-lg font-bold text-emerald-100 ring-1 ring-emerald-950/20"
              onClick={resetDemo}
            >
              Clear paid table / New table
            </button>
          </div>
        ) : null}

        <h1 className="text-5xl font-semibold tracking-normal">
          {bill.orderName}
        </h1>
        <h2 className="mt-3 text-2xl font-semibold tracking-normal">
          {activeCheckout ? 'Scan to finish payment' : 'Select unpaid items'}
        </h2>
        {lastPaymentMessage ? (
          <p className="ston-panel-strong mt-5 p-4 text-lg font-semibold text-cyan-50">
            {collapseLongHashes(lastPaymentMessage)}
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
                  'flex min-h-32 flex-col justify-between rounded-lg border p-5 text-left transition disabled:cursor-not-allowed',
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
                    {itemDisplayAmount(item, receiveAsset)}
                  </span>
                  <span
                    className={[
                      'inline-flex h-9 w-9 items-center justify-center rounded border text-lg font-bold',
                      isSelected
                        ? 'border-cyan-300 bg-cyan-300 text-slate-950 shadow-[0_0_18px_rgba(57,245,236,0.55)]'
                        : 'border-cyan-300/30 bg-slate-950/40 text-transparent',
                    ].join(' ')}
                  >
                    ✓
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="ston-card-muted mt-6 grid gap-5 p-5">
          <label className="grid gap-2 text-base font-semibold text-cyan-50 sm:max-w-xs">
            Optional tip in {receiveAsset.symbol}
            <input
              className="ston-input px-4 py-4 text-xl font-normal"
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
              <span className="font-medium">
                {formatTokenAmountFixed(
                  selectedTotalRawAmount,
                  receiveAsset.decimals,
                  receiveAsset.symbol,
                )}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Tip</span>
              <span className="font-medium">
                {formatTokenAmountFixed(
                  tipRawAmount,
                  receiveAsset.decimals,
                  receiveAsset.symbol,
                )}
              </span>
            </div>
            <div className="flex justify-between gap-4 border-t border-cyan-300/20 pt-3 text-2xl font-bold">
              <span>Total</span>
              <span>
                {formatTokenAmountFixed(
                  checkoutTotalRawAmount,
                  receiveAsset.decimals,
                  receiveAsset.symbol,
                )}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="ston-button-primary w-full px-8 py-5 text-xl font-bold disabled:cursor-not-allowed sm:w-fit"
              disabled={selectedItemIds.length === 0 || Boolean(activeCheckout)}
              onClick={() => startCheckout('direct')}
            >
              Fast Pay with {receiveAsset.symbol}
            </button>
            <button
              className="ston-button-secondary w-full px-8 py-5 text-xl font-bold disabled:cursor-not-allowed sm:w-fit"
              disabled={selectedItemIds.length === 0 || Boolean(activeCheckout)}
              onClick={() => startCheckout('omniston')}
            >
              Pay with any token
            </button>
          </div>
        </div>
      </div>

      <aside className="ston-panel p-6">
        <h2 className="text-2xl font-semibold tracking-normal">How to pay</h2>
        <ol className="mt-5 grid gap-3 text-lg font-semibold">
          <li className="ston-card-muted p-4">1. Select your items</li>
          <li className="ston-card-muted p-4">2. Add a tip if you want</li>
          <li className="ston-card-muted p-4">
            3. Choose Fast Pay with USDT or Pay with any token
          </li>
          <li className="ston-card-muted p-4">
            4. Fast Pay: scan the QR inside Tonkeeper
          </li>
          <li className="ston-card-muted p-4">
            5. Any token: connect Tonkeeper and approve the STON.fi swap
          </li>
        </ol>

        {activeCheckout ? (
          <div className="ston-panel-strong mt-6 grid gap-4 p-5">
            <p className="inline-flex w-fit rounded-full bg-amber-300/20 px-3 py-1 text-sm font-bold uppercase text-amber-100 ring-1 ring-amber-300/40">
              Pending payment
            </p>
            {activeCheckout.paymentMode === 'direct' ? (
              <>
                <div className="ston-qr p-5">
                  <QRCode
                    value={
                      activeCheckout.directPaymentLink ??
                      activeCheckout.checkoutLink
                    }
                    className="mx-auto h-auto w-full max-w-96"
                  />
                </div>
                <div className="ston-card-muted grid gap-2 p-4 text-base font-semibold text-cyan-50">
                  <p>1. Scan this QR inside Tonkeeper.</p>
                  <p>2. Approve the direct USDT transfer.</p>
                  <p>3. The tablet marks items paid when funds arrive.</p>
                  <p className="text-sm font-medium text-cyan-100/75">
                    This is the fastest path when the customer already has USDT.
                  </p>
                </div>
              </>
            ) : (
              <div className="ston-card-muted grid gap-4 p-4 text-base font-semibold text-cyan-50">
                <p>1. Tap Connect wallet to show a TonConnect QR.</p>
                <p>2. Scan that QR inside Tonkeeper.</p>
                <p>3. Choose the token to spend and approve the Omniston swap.</p>
                <div className="[&_button]:!rounded-lg">
                  <TonConnectButton />
                </div>
                {payerWalletAddress ? (
                  <p className="break-all text-sm font-medium text-cyan-100/75">
                    Connected: {payerWalletAddress}
                  </p>
                ) : null}
              </div>
            )}
            <p className="text-center text-3xl font-black">
              Checkout total:{' '}
              {formatTokenAmountFixed(
                activeCheckout.expectedReceiveRawAmount ??
                  activeCheckout.expectedUsdtRawAmount,
                activeCheckout.receiveAsset?.decimals ?? receiveAsset.decimals,
                activeCheckout.receiveAsset?.symbol ?? receiveAsset.symbol,
              )}
            </p>
            <div className="ston-card-muted grid gap-2 p-4 text-base">
              <div className="flex justify-between gap-4">
                <span>Subtotal</span>
                <span>
                  {formatTokenAmountFixed(
                    addRawAmounts(
                      bill.items
                        .filter((item) =>
                          activeCheckout.itemIds.includes(item.id),
                        )
                        .map((item) => itemRawAmount(item)),
                    ),
                    activeCheckout.receiveAsset?.decimals ?? receiveAsset.decimals,
                    activeCheckout.receiveAsset?.symbol ?? receiveAsset.symbol,
                  )}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Tip</span>
                <span>
                  {formatTokenAmountFixed(
                    (
                      BigInt(
                        activeCheckout.expectedReceiveRawAmount ??
                          activeCheckout.expectedUsdtRawAmount,
                      ) -
                      BigInt(
                        addRawAmounts(
                          bill.items
                            .filter((item) =>
                              activeCheckout.itemIds.includes(item.id),
                            )
                            .map((item) => itemRawAmount(item)),
                        ),
                      )
                    ).toString(),
                    activeCheckout.receiveAsset?.decimals ?? receiveAsset.decimals,
                    activeCheckout.receiveAsset?.symbol ?? receiveAsset.symbol,
                  )}
                </span>
              </div>
            </div>
            {activeCheckout.paymentMode === 'omniston' ? (
              <div className="ston-card-muted grid gap-3 p-4">
                <label className="grid gap-1 text-sm font-medium text-cyan-50">
                  Customer pays with
                  <select
                    className="ston-input px-3 py-2 text-base font-normal"
                    disabled={isTabletPaying}
                    value={selectedPaymentAssetAddress}
                    onChange={(event) =>
                      setSelectedPaymentAssetAddress(event.target.value)
                    }
                  >
                    {paymentAssets.map((asset) => (
                      <option key={asset.address} value={asset.address}>
                        {asset.symbol}
                      </option>
                    ))}
                  </select>
                </label>
                {tabletQuote && selectedPaymentAsset ? (
                  <p className="text-sm text-cyan-100/80">
                    Estimated spend:{' '}
                    {unitsToDisplay(
                      tabletQuote.bidUnits,
                      selectedPaymentAsset.decimals,
                    )}{' '}
                    {selectedPaymentAsset.symbol}
                  </p>
                ) : null}
                <button
                  className="ston-button-primary px-4 py-3 text-lg font-semibold disabled:cursor-not-allowed"
                  disabled={
                    !wallet ||
                    !selectedPaymentAsset ||
                    isTabletPaying
                  }
                  onClick={payActiveCheckoutWithTabletWallet}
                >
                  {isTabletPaying ? 'Preparing payment...' : 'Pay with connected wallet'}
                </button>
                <p className="ston-text-muted text-sm">
                  {tabletPaymentStatus ||
                    'Connect a wallet, then pay through STON.fi Omniston.'}
                </p>
                {tabletTradeStatus ? (
                  <p className="ston-text-muted text-sm">
                    {tradeStatusLabel(tabletTradeStatus)}
                  </p>
                ) : null}
                {tabletPaymentError ? (
                  <p className="text-sm text-red-200">{tabletPaymentError}</p>
                ) : null}
              </div>
            ) : null}
            <input
              className="ston-input px-3 py-3 text-sm"
              readOnly
              value={
                activeCheckout.paymentMode === 'direct'
                  ? activeCheckout.directPaymentLink ??
                    activeCheckout.checkoutLink
                  : activeCheckout.checkoutLink
              }
            />
            <button
              className="ston-button-secondary px-4 py-3 text-lg font-semibold"
              onClick={copyCheckoutLink}
            >
              {copied ? 'Copied' : 'Copy payment link'}
            </button>
            {activeCheckout.paymentMode === 'omniston' ? (
              <div className="ston-dashed ston-text-muted p-4 text-sm">
                Fallback: scan or copy this web checkout link if tablet-side
                wallet connection is not available.
              </div>
            ) : null}
            <button
              className="ston-button-danger px-4 py-3 text-lg font-semibold"
              onClick={cancelActiveCheckout}
            >
              Cancel pending payment
            </button>
            {import.meta.env.DEV ? (
              <button
                className="ston-button-primary px-4 py-3 text-lg font-semibold"
                onClick={() => markActiveCheckoutPaid()}
              >
                Simulate Payment
              </button>
            ) : null}
          </div>
        ) : (
          <p className="ston-dashed ston-text-muted mt-6 p-5 text-lg">
            No active checkout. The next customer can select unpaid items.
          </p>
        )}

        <div className="mt-6 grid grid-cols-3 gap-3 text-center text-sm font-semibold">
          <div className="ston-card-muted p-4 text-cyan-50">
            <strong className="block text-2xl">{unpaidItems.length}</strong>
            Unpaid
          </div>
          <div className="rounded-lg bg-amber-300/15 p-4 text-amber-100 ring-1 ring-amber-300/40">
            <strong className="block text-2xl">{pendingItems.length}</strong>
            Pending
          </div>
          <div className="rounded-lg bg-emerald-300/15 p-4 text-emerald-100 ring-1 ring-emerald-300/40">
            <strong className="block text-2xl">{paidItems.length}</strong>
            Paid
          </div>
        </div>
        {usedPaymentTxHashes.length > 0 ? (
          <p className="ston-text-muted mt-4 break-all text-xs">
            Last used tx hash:{' '}
            {shortHash(usedPaymentTxHashes[usedPaymentTxHashes.length - 1])}
          </p>
        ) : null}
        <button
          className="ston-button-secondary mt-6 w-full px-5 py-4 text-lg font-semibold"
          onClick={resetDemo}
        >
          Reset
        </button>
      </aside>
    </section>
  )
}

export default BoardPage
