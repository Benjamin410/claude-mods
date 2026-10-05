import type { DayTotals, TokenTotals, UsageReport } from '../types'

export const DAY_MS = 24 * 60 * 60 * 1000

export const emptyTotals = (): TokenTotals => ({
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  requests: 0,
})

/** Eine API-Antwort aus einer Transkriptzeile. */
export type UsageRecord = {
  key: string
  at: number
  model: string
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Liest die Assistant-Zeilen eines JSONL-Transkripts. Eine Antwort steht
 * mehrfach im Transkript (eine Zeile je Content-Block, gleiche usage);
 * `key` = message.id + requestId dient der Deduplizierung.
 */
export function parseTranscript(text: string): UsageRecord[] {
  const out: UsageRecord[] = []
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const msg = row?.message
    const usage = msg?.usage
    if (row?.type !== 'assistant' || !usage) continue
    const at = Date.parse(row.timestamp)
    if (!Number.isFinite(at)) continue
    const model = typeof msg.model === 'string' ? msg.model : 'unbekannt'
    if (model === '<synthetic>') continue
    out.push({
      key: `${msg.id ?? row.uuid}:${row.requestId ?? ''}`,
      at,
      model,
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheWrite: num(usage.cache_creation_input_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
    })
  }
  return out
}

const add = (t: TokenTotals, r: UsageRecord) => {
  t.input += r.input
  t.output += r.output
  t.cacheWrite += r.cacheWrite
  t.cacheRead += r.cacheRead
  t.requests += 1
}

/** Lokales Datum als YYYY-MM-DD, verschoben um `offsetMin` (Minuten oestlich von UTC). */
export const dayKey = (at: number, offsetMin: number) =>
  new Date(at + offsetMin * 60_000).toISOString().slice(0, 10)

/**
 * Fasst die Records der letzten 7 Tage (heute + 6 Vortage, lokale Tage)
 * zusammen; `planSince` liefert zusaetzlich die Summe seit Beginn des
 * Plan-Fensters.
 */
export function aggregate(
  records: UsageRecord[],
  now: number,
  offsetMin: number,
  files: number,
  planSince?: number,
): UsageReport {
  const days = new Map<string, DayTotals>()
  for (let i = 6; i >= 0; i--) {
    const day = dayKey(now - i * DAY_MS, offsetMin)
    days.set(day, { day, ...emptyTotals() })
  }
  const models = new Map<string, TokenTotals>()
  const total = emptyTotals()
  const plan = emptyTotals()
  const seen = new Set<string>()

  for (const r of records) {
    if (seen.has(r.key)) continue
    seen.add(r.key)
    if (planSince !== undefined && r.at >= planSince && r.at <= now) add(plan, r)
    const bucket = days.get(dayKey(r.at, offsetMin))
    if (!bucket) continue
    add(bucket, r)
    add(total, r)
    const m = models.get(r.model) ?? emptyTotals()
    add(m, r)
    models.set(r.model, m)
  }

  return {
    scannedAt: now,
    files,
    days: [...days.values()],
    models: [...models.entries()]
      .map(([model, t]) => ({ model, ...t }))
      .sort((a, b) => effective(b) - effective(a)),
    total,
    planWindow: planSince === undefined ? undefined : { since: planSince, ...plan },
  }
}

/** Tokens ohne Cache-Reads: Input + Cache-Write + Output. */
export const effective = (t: TokenTotals) => t.input + t.cacheWrite + t.output

/** Alle Tokens inklusive Cache-Reads. */
export const all = (t: TokenTotals) => effective(t) + t.cacheRead

export function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} Mrd`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} k`
  return String(Math.round(n))
}

/**
 * Hochrechnung: wie viele effektive Tokens das 7-Tage-Fenster bei gleichem
 * Mix fassen wuerde. Grob, denn der Plan zaehlt gewichtet und
 * geraeteuebergreifend, die Tokens hier stammen nur von diesem Geraet.
 */
export function projectCapacity(tokens: number, percentUsed: number): number | undefined {
  if (percentUsed < 1 || tokens <= 0) return undefined
  return (tokens / percentUsed) * 100
}
