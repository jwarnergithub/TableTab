import {
  TONAPI_API_URL,
  TON_USDT_JETTON_MASTER,
  TONCENTER_V3_API_URL,
} from './constants'

type TonCenterJettonTransfer = {
  amount?: string
  jetton_master?: string
  transaction_hash?: string
  transaction_now?: number | string
  jetton?: {
    address?: string
  }
  transaction?: {
    hash?: string
    time?: number | string
  }
}

type TonCenterJettonTransfersResponse = {
  jetton_transfers?: TonCenterJettonTransfer[]
  transfers?: TonCenterJettonTransfer[]
}

type TonApiAccountAddress = {
  address?: string
}

type TonApiJettonTransfer = {
  amount?: string
  recipient?: TonApiAccountAddress
  jetton?: {
    address?: string
  }
}

type TonApiAction = {
  type?: string
  status?: string
  JettonTransfer?: TonApiJettonTransfer
  jetton_transfer?: TonApiJettonTransfer
  jettonTransfer?: TonApiJettonTransfer
}

type TonApiAccountEvent = {
  event_id?: string
  timestamp?: number | string
  actions?: TonApiAction[]
}

type TonApiAccountEventsResponse = {
  events?: TonApiAccountEvent[]
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

const MERCHANT_USDT_TOLERANCE_RAW = 10_000n

function sameAddress(left?: string, right?: string) {
  return left?.toLowerCase() === right?.toLowerCase()
}

function toTimestamp(value?: number | string) {
  const timestamp = Number(value ?? 0)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function isExpectedUsdtAmount(receivedAmount?: string, expectedAmount?: string) {
  if (!receivedAmount || !expectedAmount) {
    return false
  }

  try {
    const received = BigInt(receivedAmount)
    const expected = BigInt(expectedAmount)

    if (received >= expected) {
      return true
    }

    return expected - received <= MERCHANT_USDT_TOLERANCE_RAW
  } catch {
    return false
  }
}

function tonApiJettonTransfer(action: TonApiAction) {
  return (
    action.JettonTransfer ?? action.jetton_transfer ?? action.jettonTransfer
  )
}

export async function findIncomingUsdtPayment({
  merchantWallet,
  expectedUsdtRawAmount,
  createdAt,
  usedTxHashes,
}: FindIncomingUsdtPaymentParams): Promise<MatchedUsdtTransfer | null> {
  const tonApiKey = (
    import.meta.env.VITE_TONAPI_API_KEY ??
    import.meta.env.VITE_TONCENTER_API_KEY ??
    ''
  ).trim()

  if (tonApiKey) {
    return findIncomingUsdtPaymentWithTonApi({
      merchantWallet,
      expectedUsdtRawAmount,
      createdAt,
      usedTxHashes,
      apiKey: tonApiKey,
    })
  }

  return findIncomingUsdtPaymentWithTonCenter({
    merchantWallet,
    expectedUsdtRawAmount,
    createdAt,
    usedTxHashes,
  })
}

async function findIncomingUsdtPaymentWithTonApi({
  merchantWallet,
  expectedUsdtRawAmount,
  createdAt,
  usedTxHashes,
  apiKey,
}: FindIncomingUsdtPaymentParams & {
  apiKey: string
}): Promise<MatchedUsdtTransfer | null> {
  const createdAtSeconds = Math.floor(new Date(createdAt).getTime() / 1000)
  const url = new URL(
    `${TONAPI_API_URL}/accounts/${merchantWallet}/jettons/${TON_USDT_JETTON_MASTER}/history`,
  )

  url.searchParams.set('limit', '20')

  const headers = new Headers()
  headers.set('Authorization', `Bearer ${apiKey}`)

  const response = await fetch(url, { headers })

  if (!response.ok) {
    throw new Error(`TonAPI polling failed with ${response.status}.`)
  }

  const data = (await response.json()) as TonApiAccountEventsResponse
  const events = data.events ?? []

  for (const event of events) {
    const hash = event.event_id
    const time = toTimestamp(event.timestamp)

    if (!hash || usedTxHashes.includes(hash) || time < createdAtSeconds) {
      continue
    }

    const matchedTransfer = event.actions
      ?.filter((action) => !action.status || action.status === 'ok')
      .map(tonApiJettonTransfer)
      .find((transfer) =>
        isExpectedUsdtAmount(transfer?.amount, expectedUsdtRawAmount),
      )

    if (matchedTransfer?.amount) {
      return {
        amount: matchedTransfer.amount,
        hash,
        time,
      }
    }
  }

  return null
}

async function findIncomingUsdtPaymentWithTonCenter({
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
  const transfers = data.jetton_transfers ?? data.transfers ?? []

  const matchedTransfer = transfers.find((transfer) => {
    const hash = transfer.transaction_hash ?? transfer.transaction?.hash
    const time = toTimestamp(
      transfer.transaction_now ?? transfer.transaction?.time,
    )
    const jettonMaster = transfer.jetton_master ?? transfer.jetton?.address

    return (
      Boolean(hash) &&
      !usedTxHashes.includes(hash ?? '') &&
      sameAddress(jettonMaster, TON_USDT_JETTON_MASTER) &&
      isExpectedUsdtAmount(transfer.amount, expectedUsdtRawAmount) &&
      time >= createdAtSeconds
    )
  })

  const hash = matchedTransfer?.transaction_hash ?? matchedTransfer?.transaction?.hash
  const time = toTimestamp(
    matchedTransfer?.transaction_now ?? matchedTransfer?.transaction?.time,
  )

  if (!matchedTransfer || !hash || !time) {
    return null
  }

  return {
    amount: matchedTransfer.amount ?? expectedUsdtRawAmount,
    hash,
    time,
  }
}
