export type BillItemStatus = 'unpaid' | 'pending' | 'paid'

export type ReceiveAsset = {
  address: string
  symbol: string
  displayName: string
  decimals: number
}

export type BillItem = {
  id: string
  name: string
  priceCents: number
  priceRawAmount?: string
  status: BillItemStatus
}

export type BillState = {
  merchantWallet: string
  orderName: string
  receiveAsset?: ReceiveAsset
  isLocked: boolean
  items: BillItem[]
}

export type ActiveCheckout = {
  id: string
  itemIds: string[]
  subtotalCents: number
  tipCents: number
  totalCents: number
  expectedUsdtRawAmount: string
  receiveAsset?: ReceiveAsset
  expectedReceiveRawAmount?: string
  directPaymentLink?: string
  paymentMode?: 'direct' | 'omniston'
  createdAt: string
  checkoutLink: string
}

export type BoardState = {
  bill: BillState
  activeCheckout: ActiveCheckout | null
  usedPaymentTxHashes: string[]
  lastPaymentMessage: string
}
