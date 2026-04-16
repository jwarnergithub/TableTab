export function centsToDollars(cents: number) {
  return cents / 100
}

export function formatCurrency(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(centsToDollars(cents))
}

export function formatUsdt(cents: number) {
  return `${centsToDollars(cents).toFixed(2)} USDT`
}

export function parseUsdtToCents(value: string) {
  const cents = Math.round(Number(value) * 100)

  if (Number.isNaN(cents) || cents < 0) {
    return 0
  }

  return cents
}

export function centsToUsdtRawAmount(cents: number) {
  return String(cents * 10_000)
}

export function addCents(amounts: number[]) {
  return amounts.reduce((total, amount) => total + amount, 0)
}
