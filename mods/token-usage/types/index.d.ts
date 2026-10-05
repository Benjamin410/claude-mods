/** Token-Summen eines Zeitraums oder einer Gruppe. */
export type TokenTotals = {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  requests: number
  /** API-Listenpreis in USD. */
  cost: number
  /** Anfragen ohne bekannten Preis (in `cost` nicht enthalten). */
  unpriced: number
}

/** Ein Tag (lokales Datum YYYY-MM-DD) mit seinen Summen. */
export type DayTotals = { day: string } & TokenTotals

/** Ein Plan-Fenster, wie die letzte API-Antwort es meldete. */
export type PlanWindow = { kind: string; percentUsed: number; resetsAt?: string }

/** Letzter bekannter Plan-Stand mit Zeitpunkt der Messung. */
export type PlanSnapshot = { measuredAt: number; windows: PlanWindow[] }

/** Ergebnis eines Transkript-Scans. */
export type UsageReport = {
  scannedAt: number
  files: number
  days: DayTotals[]
  models: ({ model: string } & TokenTotals)[]
  total: TokenTotals
  /** Summe seit Beginn des aktuellen 7-Tage-Plan-Fensters (resetsAt - 7 Tage). */
  planWindow?: { since: number } & TokenTotals
}

declare module 'claude-code' {
  interface PluginState {
    'token-usage': { report: UsageReport | null; plan: PlanSnapshot | null; isScanning: boolean }
  }
}
