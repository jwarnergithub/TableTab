export type BillItemStatus = 'unpaid' | 'pending' | 'paid'

export type BillItem = {
  id: string
  name: string
  priceCents: number
  status: BillItemStatus
}

export type BillState = {
  merchantWallet: string
  orderName: string
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
  createdAt: string
  checkoutLink: string
}

export type BoardState = {
  bill: BillState
  activeCheckout: ActiveCheckout | null
  usedPaymentTxHashes: string[]
  lastPaymentMessage: string
}
