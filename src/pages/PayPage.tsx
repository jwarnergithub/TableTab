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
import { formatTokenAmountFixed } from '../lib/amounts'
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

function isFilledTrade(status: TradeStatus) {
  const result = status.status?.tradeSettled?.result

  return (
    result === 'TRADE_RESULT_FULLY_FILLED' ||
    result === 'TRADE_RESULT_PARTIALLY_FILLED'
  )
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
  const receiveAsset = checkout?.receiveAsset ?? FALLBACK_USDT_ASSET

  const omniston = useOmniston()
  const wallet = useTonWallet()
  const payerWalletAddress = useTonAddress(false)
  const walletAssetAddress = useTonAddress()
  const [tonConnectUI] = useTonConnectUI()
  const tradeSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null)
  const didAutoDisconnectRef = useRef(false)

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
        const availableAssets = await stonApiClient.queryAssets({
          condition,
          walletAddress: walletAssetAddress || undefined,
          limit: 30,
          sortBy: ['popularity_index:desc'],
        })

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

        setAssets(nextAssets)
        setUsdtAsset(receiveAsset)
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
        setUsdtAsset(receiveAsset)
        setSelectedAssetAddress((currentAddress) =>
          currentAddress || FALLBACK_TON_ASSET.address,
        )
      }
    }

    loadAssets()

    return () => {
      isActive = false
    }
  }, [receiveAsset, walletAssetAddress])

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
          askAssetAddress: toTonAddress(receiveAsset.address),
          amount: {
            askUnits:
              checkout.expectedReceiveRawAmount ??
              checkout.expectedUsdtRawAmount,
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

            if (isFilledTrade(nextStatus) && !didAutoDisconnectRef.current) {
              didAutoDisconnectRef.current = true
              tradeSubscriptionRef.current?.unsubscribe()
              setStatus('Payment complete. Disconnecting wallet.')

              void tonConnectUI
                .disconnect()
                .then(() => {
                  setStatus('Payment complete. Wallet disconnected.')
                })
                .catch(() => {
                  setStatus('Payment complete. You can disconnect manually.')
                })
            }
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
      <section className="ston-panel mx-auto max-w-xl p-5">
        <p className="text-sm font-medium uppercase text-red-200">
          Missing checkout
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-normal">
          Scan the tablet QR code
        </h1>
        <p className="ston-text-muted mt-3">
          The phone checkout only works from a TableTab QR link. Item selection
          stays on the tablet board.
        </p>
      </section>
    )
  }

  return (
    <section className="ston-panel mx-auto max-w-xl p-5">
      <p className="ston-kicker px-3 py-1 text-sm font-bold uppercase">
        Phone checkout
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-normal">
        Pay{' '}
        {formatTokenAmountFixed(
          checkout.expectedReceiveRawAmount ?? checkout.expectedUsdtRawAmount,
          receiveAsset.decimals,
          receiveAsset.symbol,
        )}
      </h1>
      <p className="mt-2 font-medium text-cyan-50">{checkout.orderName}</p>
      <p className="ston-text-muted mt-3">
        Connect Tonkeeper, choose the token you want to spend, then approve the
        swap. STON.fi Omniston uses a 1% slippage limit, and the tablet accepts
        a tiny rounding difference for swap dust.
      </p>

      <div className="ston-card-muted mt-6 p-4">
        <h2 className="font-semibold tracking-normal">Items</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {checkout.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-4">
              <span>{item.name}</span>
              <span>
                {formatTokenAmountFixed(
                  item.priceRawAmount ?? String(item.priceCents * 10_000),
                  receiveAsset.decimals,
                  receiveAsset.symbol,
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="ston-card-muted mt-5 grid gap-2 p-4 text-sm">
        <div className="flex justify-between gap-4">
          <span>Subtotal</span>
          <span>
            {formatTokenAmountFixed(
              checkout.items
                .reduce(
                  (total, item) =>
                    total +
                    BigInt(
                      item.priceRawAmount ?? String(item.priceCents * 10_000),
                    ),
                  0n,
                )
                .toString(),
              receiveAsset.decimals,
              receiveAsset.symbol,
            )}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Tip</span>
          <span>
            {formatTokenAmountFixed(
              (
                BigInt(
                  checkout.expectedReceiveRawAmount ??
                    checkout.expectedUsdtRawAmount,
                ) -
                checkout.items.reduce(
                  (total, item) =>
                    total +
                    BigInt(
                      item.priceRawAmount ?? String(item.priceCents * 10_000),
                    ),
                  0n,
                )
              ).toString(),
              receiveAsset.decimals,
              receiveAsset.symbol,
            )}
          </span>
        </div>
        <div className="flex justify-between gap-4 border-t border-cyan-300/20 pt-2 text-base font-semibold">
          <span>Total</span>
          <span>
            {formatTokenAmountFixed(
              checkout.expectedReceiveRawAmount ?? checkout.expectedUsdtRawAmount,
              receiveAsset.decimals,
              receiveAsset.symbol,
            )}
          </span>
        </div>
      </div>

      <div className="ston-card-muted mt-5 p-4">
        <p className="text-sm font-medium text-cyan-50">Merchant wallet</p>
        <p className="ston-text-muted mt-2 break-all text-sm">
          {checkout.merchantWallet}
        </p>
      </div>

      <div className="ston-card-muted mt-5 p-4">
        <h2 className="font-semibold tracking-normal">Wallet</h2>
        <div className="mt-3 [&_button]:!rounded-lg">
          <TonConnectButton />
        </div>
        {payerWalletAddress ? (
          <p className="ston-text-muted mt-3 break-all text-sm">
            Connected: {payerWalletAddress}
          </p>
        ) : null}
      </div>

      <label className="mt-5 grid gap-1 text-sm font-medium text-cyan-50">
        Input token
        <select
          className="ston-input px-3 py-2 text-base font-normal"
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

      <div className="ston-card-muted mt-4 grid gap-2 p-4 text-sm">
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
        <div className="ston-panel-strong mt-5 grid gap-2 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <span>You pay</span>
            <span>
              {unitsToDisplay(quote.bidUnits, selectedAsset.decimals)}{' '}
              {selectedAsset.symbol}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Merchant receives</span>
            <span>
              {formatTokenAmountFixed(
                checkout.expectedReceiveRawAmount ??
                  checkout.expectedUsdtRawAmount,
                receiveAsset.decimals,
                receiveAsset.symbol,
              )}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Slippage limit</span>
            <span>1%</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Merchant tolerance</span>
            <span>Small rounding dust</span>
          </div>
        </div>
      ) : null}

      <button
        className="ston-button-primary mt-5 w-full px-5 py-3 font-semibold disabled:cursor-not-allowed"
        disabled={!canPay}
        onClick={buildAndSendPayment}
      >
        {isPaying ? 'Preparing payment...' : 'Pay with TON wallet'}
      </button>

      <div className="ston-card-muted mt-5 p-4">
        <p className="font-medium">Transaction status</p>
        <p className="ston-text-muted mt-2 text-sm">{status}</p>
        {tradeStatus ? (
          <p className="ston-text-muted mt-2 text-sm">
            {tradeStatusLabel(tradeStatus)}
          </p>
        ) : null}
        {transactionBoc ? (
          <p className="ston-text-muted mt-2 break-all text-xs">
            Signed BOC: {transactionBoc}
          </p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-red-200">{error}</p> : null}
      </div>

      <p className="ston-text-muted mt-5 text-xs">
        This page does not update the tablet directly. The tablet board detects
        payment separately by watching the merchant wallet.
      </p>
    </section>
  )
}

export default PayPage
