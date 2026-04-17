import {
  QuoteResponseEventType,
  type Address,
  type Observable,
  type Quote,
  type QuoteResponseEvent,
  type TradeStatus,
  type TransactionResponse,
} from '@ston-fi/omniston-sdk-react'
import { TON_BLOCKCHAIN } from './constants'

export function toTonAddress(address: string): Address {
  return {
    blockchain: TON_BLOCKCHAIN,
    address,
  }
}

export function unitsToDisplay(units: string, decimals: number) {
  const padded = units.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '')

  return fraction ? `${whole}.${fraction}` : whole
}

export function tradeStatusLabel(status: TradeStatus | null) {
  if (!status?.status) {
    return 'Waiting for trade status.'
  }

  const statusKey = Object.keys(status.status).find(
    (key) => status.status?.[key as keyof typeof status.status],
  )

  return statusKey ? `Trade status: ${statusKey}` : 'Trade status received.'
}

export function isFilledTrade(status: TradeStatus) {
  const result = status.status?.tradeSettled?.result

  return (
    result === 'TRADE_RESULT_FULLY_FILLED' ||
    result === 'TRADE_RESULT_PARTIALLY_FILLED'
  )
}

export function firstQuoteFromOmniston(
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

export function mapTransferToTonConnectTransaction(transfer: TransactionResponse) {
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
