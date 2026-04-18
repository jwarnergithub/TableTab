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

export function parseTokenAmountToRaw(value: string, decimals: number) {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return ''
  }

  const [wholePart, fractionPart = ''] = trimmedValue.split('.')
  const whole = wholePart || '0'
  const fraction = fractionPart.padEnd(decimals, '0').slice(0, decimals)
  const normalized = `${whole}${fraction}`.replace(/^0+(?=\d)/, '')

  if (!/^\d+$/.test(normalized)) {
    return ''
  }

  return normalized || '0'
}

export function formatTokenAmount(rawAmount: string, decimals: number, symbol: string) {
  const padded = rawAmount.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '')
  const displayAmount = fraction ? `${whole}.${fraction}` : whole

  return `${displayAmount} ${symbol}`
}

export function formatTokenAmountFixed(
  rawAmount: string,
  decimals: number,
  symbol: string,
  fractionDigits = 2,
) {
  const rawValue = BigInt(rawAmount || '0')

  if (fractionDigits === 0) {
    const scale = 10n ** BigInt(decimals)
    const rounded = (rawValue + scale / 2n) / scale

    return `${rounded.toString()} ${symbol}`
  }

  const displayScale = 10n ** BigInt(fractionDigits)
  const displayUnits =
    decimals > fractionDigits
      ? (() => {
          const roundingScale = 10n ** BigInt(decimals - fractionDigits)
          return (rawValue + roundingScale / 2n) / roundingScale
        })()
      : rawValue * 10n ** BigInt(fractionDigits - decimals)
  const whole = displayUnits / displayScale
  const fraction = (displayUnits % displayScale)
    .toString()
    .padStart(fractionDigits, '0')

  return `${whole.toString()}.${fraction} ${symbol}`
}

export function addRawAmounts(amounts: string[]) {
  return amounts.reduce((total, amount) => total + BigInt(amount || '0'), 0n).toString()
}

export function addCents(amounts: number[]) {
  return amounts.reduce((total, amount) => total + amount, 0)
}
