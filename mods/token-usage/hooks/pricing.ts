/**
 * API-Listenpreise in USD je 1 Mio. Tokens (Anthropic first-party, Stand 2026-09-25).
 * Cache-Write kostet 1,25x (5 Minuten) bzw. 2x (1 Stunde) des Input-Preises.
 */
export type Price = { input: number; output: number; cacheRead: number }

// Laengster Praefix gewinnt; Transkripte tragen teils Datums-Suffixe.
const PRICES: [prefix: string, price: Price][] = [
  ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-mythos-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-fable-5', { input: 10, output: 50, cacheRead: 1 }],
  ['claude-mythos-5', { input: 10, output: 50, cacheRead: 1 }],
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2 }],
  ['claude-opus-5', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-8', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-7', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-6', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['claude-sonnet-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['claude-sonnet-4-6', { input: 3, output: 15, cacheRead: 0.3 }],
  ['claude-haiku-4-5', { input: 1, output: 5, cacheRead: 0.1 }],
]

// Kurznamen ohne Version meinen die aktuelle Generation.
const ALIASES: Record<string, string> = {
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-4-5',
}

export function priceFor(model: string): Price | undefined {
  const id = ALIASES[model] ?? model
  let best: [string, Price] | undefined
  for (const entry of PRICES)
    if (id.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry
  return best?.[1]
}

export type Billable = {
  model: string
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
  isFast: boolean
}

/** API-Preis einer Antwort in USD; `undefined` bei unbekanntem Modell. */
export function costOf(r: Billable): number | undefined {
  const p = priceFor(r.model)
  if (!p) return undefined
  const usd =
    (r.input * p.input +
      r.cacheWrite5m * p.input * 1.25 +
      r.cacheWrite1h * p.input * 2 +
      r.cacheRead * p.cacheRead +
      r.output * p.output) /
    1e6
  // Fast Mode: doppelter Preis.
  return r.isFast ? usd * 2 : usd
}

export function fmtUsd(usd: number): string {
  if (usd >= 1000) return `$${Math.round(usd).toLocaleString('en-US')}`
  if (usd >= 100) return `$${usd.toFixed(0)}`
  return `$${usd.toFixed(2)}`
}
