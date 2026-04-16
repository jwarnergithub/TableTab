import { AssetTag, StonApiClient } from '@ston-fi/api'
import {
  GaslessSettlement,
  QuoteResponseEventType,
  SettlementMethod,
  useOmniston,
  type Address,
  type Observable,
  type Quote,
  type QuoteResponseEvent,
  type TradeStatus,
  type TransactionResponse,
} from '@ston-fi/omniston-sdk-react'
import {
  TonConnectButton,
  useTonAddress,
  useTonConnectUI,
  useTonWallet,
} from '@tonconnect/ui-react'
import { Cell } from '@ton/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { formatUsdt } from '../lib/amounts'
import { TON_USDT_JETTON_MASTER } from '../lib/constants'
import { decodeCheckoutPayload } from '../lib/checkoutPayload'

const TON_BLOCKCHAIN = 607
const TON_ASSET_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c'
const FALLBACK_TON_ASSET: PaymentAsset = {
  address: TON_ASSET_ADDRESS,
  symbol: 'TON',
  displayName: 'Toncoin',
  decimals: 9,
}
const FALLBACK_USDT_ASSET: PaymentAsset = {
  address: TON_USDT_JETTON_MASTER,
  symbol: 'USDT',
  displayName: 'Tether USD',
  decimals: 6,
}
const stonApiClient = new StonApiClient()

type PaymentAsset = {
  address: string
  symbol: string
  displayName: string
  decimals: number
  balance?: string
}

function toTonAddress(address: string): Address {
  return {
    blockchain: TON_BLOCKCHAIN,
    address,
  }
}

function unitsToDisplay(units: string, decimals: number) {
  const padded = units.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '')

  return fraction ? `${whole}.${fraction}` : whole
}

function tradeStatusLabel(status: TradeStatus | null) {
  if (!status?.status) {
    return 'Waiting for trade status.'
  }

  const statusKey = Object.keys(status.status).find(
    (key) => status.status?.[key as keyof typeof status.status],
  )

  return statusKey ? `Trade status: ${statusKey}` : 'Trade status received.'
}

function firstQuoteFromOmniston(
  events: Observable<QuoteResponseEvent>,
) {
  return new Promise<Quote>((resolve, reject) => {
    let subscription: { unsubscribe: () => void } | null = null
    const timeoutId = window.setTimeout(() => {
      subscription?.unsubscribe()
      reject(new Error('Quote timed out. Try a different input token.'))
    }, 20_000)

    subscription = events.subscribe({
      next: (event: QuoteResponseEvent) => {
        if (event.type === QuoteResponseEventType.QuoteUpdated) {
          window.clearTimeout(timeoutId)
          subscription?.unsubscribe()
          resolve(event.quote)
        }

        if (event.type === QuoteResponseEventType.NoQuote) {
          window.clearTimeout(timeoutId)
          subscription?.unsubscribe()
          reject(new Error('No quote is available for this input token.'))
        }
      },
      error: (error: unknown) => {
        window.clearTimeout(timeoutId)
        reject(error instanceof Error ? error : new Error('Quote failed.'))
      },
    })
  })
}

function mapTransferToTonConnectTransaction(transfer: TransactionResponse) {
  const messages = transfer.ton?.messages ?? []

  if (messages.length === 0) {
    throw new Error('Omniston did not return TON transfer messages.')
  }

  return {
    validUntil: Math.floor(Date.now() / 1000) + 300,
    messages: messages.map((message) => ({
      address: message.targetAddress,
      amount: message.sendAmount,
      payload: message.payload || undefined,
      stateInit: message.jettonWalletStateInit || undefined,
    })),
  }
}

function PayPage() {
  const [searchParams] = useSearchParams()
  const checkoutParam = searchParams.get('checkout')
  const checkout = useMemo(() => {
    if (!checkoutParam) {
      return null
    }

    try {
      return decodeCheckoutPayload(checkoutParam)
    } catch {
      return null
    }
  }, [checkoutParam])

  const omniston = useOmniston()
  const wallet = useTonWallet()
  const payerWalletAddress = useTonAddress(false)
  const walletAssetAddress = useTonAddress()
  const [tonConnectUI] = useTonConnectUI()
  const tradeSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null)

  const [assets, setAssets] = useState<PaymentAsset[]>([])
  const [usdtAsset, setUsdtAsset] = useState<PaymentAsset | null>(null)
  const [selectedAssetAddress, setSelectedAssetAddress] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [tradeStatus, setTradeStatus] = useState<TradeStatus | null>(null)
  const [transactionBoc, setTransactionBoc] = useState('')
  const [status, setStatus] = useState('Load the checkout and connect a wallet.')
  const [error, setError] = useState('')
  const [isPaying, setIsPaying] = useState(false)

  const selectedAsset = assets.find(
    (asset) => asset.address === selectedAssetAddress,
  )
  const canPay = Boolean(wallet && selectedAsset && usdtAsset && !isPaying)

  useEffect(() => {
    let isActive = true

    async function loadAssets() {
      try {
        const condition = [
          AssetTag.Essential,
          AssetTag.Popular,
          AssetTag.LiquidityVeryHigh,
          AssetTag.WalletHasBalance,
        ].join(' | ')
        const [availableAssets, usdtMatches] = await Promise.all([
          stonApiClient.queryAssets({
            condition,
            walletAddress: walletAssetAddress || undefined,
            limit: 30,
            sortBy: ['popularity_index:desc'],
          }),
          stonApiClient.queryAssets({
            searchTerms: ['USDT'],
            condition: [
              AssetTag.Essential,
              AssetTag.Popular,
              AssetTag.LiquidityHigh,
              AssetTag.LiquidityVeryHigh,
            ].join(' | '),
            limit: 10,
          }),
        ])

        if (!isActive) {
          return
        }

        const apiAssets = availableAssets
          .filter((asset) => asset.kind !== 'NotAnAsset')
          .map((asset) => ({
            address: asset.contractAddress,
            symbol: asset.meta?.symbol ?? asset.contractAddress,
            displayName: asset.meta?.displayName ?? asset.meta?.symbol ?? 'Token',
            decimals: asset.meta?.decimals ?? 9,
            balance: asset.balance,
          }))
        const nextAssets =
          apiAssets.length > 0
            ? apiAssets
            : [FALLBACK_TON_ASSET, FALLBACK_USDT_ASSET]

        const nextUsdt = usdtMatches.find(
          (asset) => asset.meta?.symbol?.toUpperCase() === 'USDT',
        )
        const nextUsdtAsset = nextUsdt
          ? {
              address: nextUsdt.contractAddress,
              symbol: nextUsdt.meta?.symbol ?? 'USDT',
              displayName: nextUsdt.meta?.displayName ?? 'Tether USD',
              decimals: nextUsdt.meta?.decimals ?? 6,
            }
          : FALLBACK_USDT_ASSET

        setAssets(nextAssets)
        setUsdtAsset(nextUsdtAsset)
        setSelectedAssetAddress((currentAddress) =>
          currentAddress || nextAssets[0]?.address || '',
        )
      } catch (assetError) {
        if (!isActive) {
          return
        }

        setError(
          assetError instanceof Error
            ? assetError.message
            : 'Could not load STON.fi token list.',
        )
        setAssets([FALLBACK_TON_ASSET, FALLBACK_USDT_ASSET])
        setUsdtAsset(FALLBACK_USDT_ASSET)
        setSelectedAssetAddress((currentAddress) =>
          currentAddress || FALLBACK_TON_ASSET.address,
        )
      }
    }

    loadAssets()

    return () => {
      isActive = false
    }
  }, [walletAssetAddress])

  useEffect(() => {
    return () => {
      tradeSubscriptionRef.current?.unsubscribe()
    }
  }, [])

  async function buildAndSendPayment() {
    if (!checkout || !selectedAsset || !usdtAsset || !wallet) {
      return
    }

    setIsPaying(true)
    setError('')
    setQuote(null)
    setTradeStatus(null)
    setTransactionBoc('')

    try {
      setStatus('Requesting STON.fi Omniston quote.')
      const nextQuote = await firstQuoteFromOmniston(
        omniston.requestForQuote({
          bidAssetAddress: toTonAddress(selectedAsset.address),
          askAssetAddress: toTonAddress(usdtAsset.address),
          amount: {
            askUnits: checkout.expectedUsdtRawAmount,
          },
          settlementMethods: [SettlementMethod.SETTLEMENT_METHOD_SWAP],
          settlementParams: {
            gaslessSettlement: GaslessSettlement.GASLESS_SETTLEMENT_PROHIBITED,
            maxOutgoingMessages: 4,
            maxPriceSlippageBps: 100,
          },
        }),
      )
      setQuote(nextQuote)

      setStatus('Building wallet transfer.')
      const transfer = await omniston.buildTransfer({
        sourceAddress: toTonAddress(payerWalletAddress),
        destinationAddress: toTonAddress(checkout.merchantWallet),
        gasExcessAddress: toTonAddress(payerWalletAddress),
        quote: nextQuote,
        useRecommendedSlippage: true,
      })
      const transaction = mapTransferToTonConnectTransaction(transfer)

      setStatus('Waiting for wallet confirmation.')
      const result = await tonConnectUI.sendTransaction(transaction)
      setTransactionBoc(result.boc)
      setStatus('Transaction sent. Tracking trade status.')

      const outgoingTxHash = Cell.fromBase64(result.boc).hash().toString('hex')
      tradeSubscriptionRef.current?.unsubscribe()
      tradeSubscriptionRef.current = omniston
        .trackTrade({
          quoteId: nextQuote.quoteId,
          traderWalletAddress: toTonAddress(payerWalletAddress),
          outgoingTxHash,
        })
        .subscribe({
          next: (nextStatus) => {
            setTradeStatus(nextStatus)
            setStatus(tradeStatusLabel(nextStatus))
          },
          error: (trackError: unknown) => {
            setError(
              trackError instanceof Error
                ? trackError.message
                : 'Trade tracking failed.',
            )
          },
        })
    } catch (paymentError) {
      setError(
        paymentError instanceof Error
          ? paymentError.message
          : 'Payment failed before it was sent.',
      )
      setStatus('Payment was not completed.')
    } finally {
      setIsPaying(false)
    }
  }

  if (!checkout) {
    return (
      <section className="mx-auto max-w-xl rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium uppercase text-red-700">
          Missing checkout
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-normal">
          Scan the tablet QR code
        </h1>
        <p className="mt-3 text-zinc-600">
          The phone checkout only works from a TableTab QR link. Item selection
          stays on the tablet board.
        </p>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-xl rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium uppercase text-sky-700">
        Phone checkout
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-normal">
        Pay {formatUsdt(checkout.totalCents)}
      </h1>
      <p className="mt-2 font-medium text-zinc-700">{checkout.orderName}</p>
      <p className="mt-3 text-zinc-600">
        Connect Tonkeeper, choose the token you want to spend, then approve the
        swap. STON.fi Omniston uses a 1% slippage limit, and the tablet accepts
        up to 0.01 USDT less for rounding dust.
      </p>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-stone-50 p-4">
        <h2 className="font-semibold tracking-normal">Items</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {checkout.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-4">
              <span>{item.name}</span>
              <span>{formatUsdt(item.priceCents)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 grid gap-2 rounded-lg border border-zinc-200 p-4 text-sm">
        <div className="flex justify-between gap-4">
          <span>Subtotal</span>
          <span>{formatUsdt(checkout.subtotalCents)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Tip</span>
          <span>{formatUsdt(checkout.tipCents)}</span>
        </div>
        <div className="flex justify-between gap-4 border-t border-zinc-200 pt-2 text-base font-semibold">
          <span>Total</span>
          <span>{formatUsdt(checkout.totalCents)}</span>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-zinc-200 p-4">
        <p className="text-sm font-medium text-zinc-700">Merchant wallet</p>
        <p className="mt-2 break-all text-sm text-zinc-600">
          {checkout.merchantWallet}
        </p>
      </div>

      <div className="mt-5 rounded-lg border border-zinc-200 p-4">
        <h2 className="font-semibold tracking-normal">Wallet</h2>
        <div className="mt-3">
          <TonConnectButton />
        </div>
        {payerWalletAddress ? (
          <p className="mt-3 break-all text-sm text-zinc-600">
            Connected: {payerWalletAddress}
          </p>
        ) : null}
      </div>

      <label className="mt-5 grid gap-1 text-sm font-medium text-zinc-700">
        Input token
        <select
          className="rounded-lg border border-zinc-300 px-3 py-2 text-base font-normal"
          disabled={assets.length === 0 || isPaying}
          value={selectedAssetAddress}
          onChange={(event) => setSelectedAssetAddress(event.target.value)}
        >
          {assets.map((asset) => (
            <option key={asset.address} value={asset.address}>
              {asset.symbol}
              {asset.balance
                ? ` · balance ${unitsToDisplay(asset.balance, asset.decimals)}`
                : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 grid gap-2 rounded-lg bg-stone-50 p-4 text-sm">
        <p className="font-medium">Checkout readiness</p>
        <p>{wallet ? 'Wallet connected' : 'Connect a wallet first'}</p>
        <p>
          {selectedAsset
            ? `Input token selected: ${selectedAsset.symbol}`
            : 'Waiting for STON.fi token list'}
        </p>
        <p>
          {usdtAsset
            ? `USDT output ready: ${usdtAsset.symbol}`
            : 'Waiting for USDT output token'}
        </p>
      </div>

      {quote && selectedAsset ? (
        <div className="mt-5 grid gap-2 rounded-lg bg-stone-50 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <span>You pay</span>
            <span>
              {unitsToDisplay(quote.bidUnits, selectedAsset.decimals)}{' '}
              {selectedAsset.symbol}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Merchant receives</span>
            <span>{formatUsdt(checkout.totalCents)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Slippage limit</span>
            <span>1%</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Merchant tolerance</span>
            <span>0.01 USDT</span>
          </div>
        </div>
      ) : null}

      <button
        className="mt-5 w-full rounded-lg bg-zinc-950 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
        disabled={!canPay}
        onClick={buildAndSendPayment}
      >
        {isPaying ? 'Preparing payment...' : 'Pay with TON wallet'}
      </button>

      <div className="mt-5 rounded-lg border border-zinc-200 p-4">
        <p className="font-medium">Transaction status</p>
        <p className="mt-2 text-sm text-zinc-600">{status}</p>
        {tradeStatus ? (
          <p className="mt-2 text-sm text-zinc-600">
            {tradeStatusLabel(tradeStatus)}
          </p>
        ) : null}
        {transactionBoc ? (
          <p className="mt-2 break-all text-xs text-zinc-500">
            Signed BOC: {transactionBoc}
          </p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      </div>

      <p className="mt-5 text-xs text-zinc-500">
        This page does not update the tablet directly. The tablet board detects
        payment separately by watching the merchant wallet.
      </p>
    </section>
  )
}

export default PayPage
