import {
  TON_USDT_JETTON_MASTER,
  TONCENTER_V3_API_URL,
} from './constants'

type TonCenterJettonTransfer = {
  amount?: string
  jetton?: {
    address?: string
  }
  transaction?: {
    hash?: string
    time?: number
  }
}

type TonCenterJettonTransfersResponse = {
  transfers?: TonCenterJettonTransfer[]
}

export type MatchedUsdtTransfer = {
  amount: string
  hash: string
  time: number
}

type FindIncomingUsdtPaymentParams = {
  merchantWallet: string
  expectedUsdtRawAmount: string
  createdAt: string
  usedTxHashes: string[]
}

function sameAddress(left?: string, right?: string) {
  return left?.toLowerCase() === right?.toLowerCase()
}

export async function findIncomingUsdtPayment({
  merchantWallet,
  expectedUsdtRawAmount,
  createdAt,
  usedTxHashes,
}: FindIncomingUsdtPaymentParams): Promise<MatchedUsdtTransfer | null> {
  const createdAtSeconds = Math.floor(new Date(createdAt).getTime() / 1000)
  const url = new URL(`${TONCENTER_V3_API_URL}/jetton/transfers`)

  url.searchParams.set('owner_address', merchantWallet)
  url.searchParams.set('direction', 'in')
  url.searchParams.set('jetton_master', TON_USDT_JETTON_MASTER)
  url.searchParams.set('start_utime', String(createdAtSeconds))
  url.searchParams.set('limit', '20')
  url.searchParams.set('sort', 'desc')

  const headers = new Headers()
  const apiKey = import.meta.env.VITE_TONCENTER_API_KEY

  if (apiKey) {
    headers.set('X-API-Key', apiKey)
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    throw new Error(`TON Center polling failed with ${response.status}.`)
  }

  const data = (await response.json()) as TonCenterJettonTransfersResponse
  const transfers = data.transfers ?? []

  const matchedTransfer = transfers.find((transfer) => {
    const hash = transfer.transaction?.hash
    const time = transfer.transaction?.time ?? 0

    return (
      Boolean(hash) &&
      !usedTxHashes.includes(hash ?? '') &&
      sameAddress(transfer.jetton?.address, TON_USDT_JETTON_MASTER) &&
      transfer.amount === expectedUsdtRawAmount &&
      time >= createdAtSeconds
    )
  })

  if (!matchedTransfer?.transaction?.hash || !matchedTransfer.transaction.time) {
    return null
  }

  return {
    amount: matchedTransfer.amount ?? expectedUsdtRawAmount,
    hash: matchedTransfer.transaction.hash,
    time: matchedTransfer.transaction.time,
  }
}
