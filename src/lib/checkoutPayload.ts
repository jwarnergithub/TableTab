import type { BillItem, ReceiveAsset } from '../types/billing'

export type CheckoutPayload = {
  checkoutId: string
  merchantWallet: string
  orderName: string
  items: Pick<BillItem, 'id' | 'name' | 'priceCents' | 'priceRawAmount'>[]
  subtotalCents: number
  tipCents: number
  totalCents: number
  expectedUsdtRawAmount: string
  receiveAsset?: ReceiveAsset
  expectedReceiveRawAmount?: string
  directPaymentLink?: string
  createdAt: string
}

export function createCheckoutPayload(params: CheckoutPayload): CheckoutPayload {
  return {
    checkoutId: params.checkoutId,
    merchantWallet: params.merchantWallet,
    orderName: params.orderName,
    items: params.items,
    subtotalCents: params.subtotalCents,
    tipCents: params.tipCents,
    totalCents: params.totalCents,
    expectedUsdtRawAmount: params.expectedUsdtRawAmount,
    receiveAsset: params.receiveAsset,
    expectedReceiveRawAmount: params.expectedReceiveRawAmount,
    directPaymentLink: params.directPaymentLink,
    createdAt: params.createdAt,
  }
}

export function encodeCheckoutPayload(payload: CheckoutPayload) {
  return window.btoa(encodeURIComponent(JSON.stringify(payload)))
}

export function decodeCheckoutPayload(payload: string): CheckoutPayload {
  return JSON.parse(decodeURIComponent(window.atob(payload))) as CheckoutPayload
}

export function createCheckoutLink(payload: CheckoutPayload) {
  const checkout = encodeCheckoutPayload(payload)

  return `${window.location.origin}/pay?checkout=${checkout}`
}

export function createJettonTransferLink({
  merchantWallet,
  jettonMaster,
  amountRaw,
  checkoutId,
}: {
  merchantWallet: string
  jettonMaster: string
  amountRaw: string
  checkoutId: string
}) {
  const params = new URLSearchParams({
    jetton: jettonMaster,
    amount: amountRaw,
    text: checkoutId,
  })

  return `ton://transfer/${merchantWallet}?${params.toString()}`
}
