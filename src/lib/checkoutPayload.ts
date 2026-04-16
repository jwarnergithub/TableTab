import type { BillItem } from '../types/billing'

export type CheckoutPayload = {
  checkoutId: string
  merchantWallet: string
  orderName: string
  items: Pick<BillItem, 'id' | 'name' | 'priceCents'>[]
  subtotalCents: number
  tipCents: number
  totalCents: number
  expectedUsdtRawAmount: string
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
