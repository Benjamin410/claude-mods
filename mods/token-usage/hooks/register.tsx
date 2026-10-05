import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PlanSnapshot, TokenTotals, UsageReport } from '../types'
import {
  DAY_MS,
  aggregate,
  all,
  effective,
  fmt,
  parseTranscript,
  projectCapacity,
  type UsageRecord,
} from './aggregate'
import { fmtUsd } from './pricing'

const PANE = 'token-usage'
const TITLE = 'Token-Verbrauch (7 Tage)'
const STORE_PLAN = 'plan'
const RESCAN_MS = 10 * 60 * 1000

const report = atom({ plugin: 'token-usage', key: 'report' } as const, null)
const plan = atom({ plugin: 'token-usage', key: 'plan' } as const, null)
const scanning = atom({ plugin: 'token-usage', key: 'isScanning' } as const, false)

const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')

async function configDir($: EngineInterface): Promise<string | undefined> {
  const explicit = await $.env.get('CLAUDE_CONFIG_DIR')
  if (explicit) return explicit
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  return home ? join(home, '.claude') : undefined
}

/** Transkripte (auch Subagent-Transkripte) mit Aenderung nach `since`. */
async function transcriptFiles($: EngineInterface, root: string, since: number) {
  const files: string[] = []
  const walk = async (dir: string, depth: number) => {
    const entries = await $.fs.list(dir).catch(() => [])
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.kind === 'dir' && depth < 3) await walk(path, depth + 1)
      else if (entry.kind === 'file' && entry.name.endsWith('.jsonl') && entry.mtimeMs >= since)
        files.push(path)
    }
  }
  await walk(join(root, 'projects'), 0)
  return files
}

/** Liest eine Datei; ueber 4 MiB nur die usage-Zeilen per grep. */
async function readUsageLines($: EngineInterface, path: string): Promise<string> {
  try {
    return await $.fs.read(path)
  } catch {
    const r = await $.process
      .run(['grep', '-F', '"usage"', path], { timeoutMs: 60_000 })
      .catch(() => undefined)
    return r?.stdout ?? ''
  }
}

function planSince(snapshot: PlanSnapshot | null): number | undefined {
  const week = snapshot?.windows.find(w => w.kind === 'seven_day')
  const reset = week?.resetsAt ? Date.parse(week.resetsAt) : NaN
  return Number.isFinite(reset) ? reset - 7 * DAY_MS : undefined
}

type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

const samePlan = (a: PlanSnapshot | null, windows: RateLimit[]) =>
  !!a &&
  a.windows.length === windows.length &&
  a.windows.every((w, i) => {
    const o = windows[i]
    return o && w.kind === o.kind && w.percentUsed === o.percentUsed && w.resetsAt === o.resetsAt
  })

/** Uebernimmt einen Plan-Stand; speichert nur bei Aenderung. */
async function setPlan($: EngineInterface, limits: RateLimit[]): Promise<boolean> {
  if (limits.length === 0) return false
  const previous = await read($, plan)
  if (samePlan(previous, limits)) return false
  const snapshot: PlanSnapshot = {
    measuredAt: await $.clock.now(),
    windows: limits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt })),
  }
  await update($, plan, () => snapshot)
  await $.store.set(STORE_PLAN, snapshot).catch(() => undefined)
  return planSince(snapshot) !== planSince(previous)
}

/** Holt den Plan-Stand, den die Sitzung schon kennt (z.B. nach /reload-plugins). */
async function refreshPlan($: EngineInterface) {
  const usage = await $.session.usage().catch(() => undefined)
  if (usage) await setPlan($, usage.rateLimits)
}

async function scan($: EngineInterface): Promise<UsageReport | undefined> {
  if (await read($, scanning)) return undefined
  await update($, scanning, () => true)
  try {
    await refreshPlan($)
    const now = await $.clock.now()
    const root = await configDir($)
    if (!root) return undefined
    const snapshot = await read($, plan)
    const since = planSince(snapshot)
    const oldest = Math.min(now - 8 * DAY_MS, since ?? Infinity)
    const files = await transcriptFiles($, root, oldest)
    const records: UsageRecord[] = []
    for (const file of files) records.push(...parseTranscript(await readUsageLines($, file)))
    const offsetMin = -new Date(now).getTimezoneOffset()
    const result = aggregate(records, now, offsetMin, files.length, since)
    await update($, report, () => result)
    return result
  } finally {
    await update($, scanning, () => false)
  }
}


const WINDOW_NAMES: Record<string, string> = {
  five_hour: '5-Stunden-Fenster',
  seven_day: '7-Tage-Fenster',
  seven_day_opus: '7-Tage-Fenster (Opus)',
  seven_day_sonnet: '7-Tage-Fenster (Sonnet)',
  spend_limit: 'Ausgabenlimit',
}

const weekday = (day: string) =>
  ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(`${day}T12:00:00Z`).getUTCDay()]

const when = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Reset ${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Gefuellter und leerer Teil eines Balkens, getrennt faerbbar. */
const bar = (value: number, max: number, width: number): [string, string] => {
  const n = max > 0 ? Math.min(width, Math.round((value / max) * width)) : 0
  return ['█'.repeat(n), '·'.repeat(Math.max(0, width - n))]
}

const tone = (pct: number) => (pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green')

const modelColor = (model: string) =>
  model.includes('opus') || model.includes('fable')
    ? 'magenta'
    : model.includes('sonnet')
      ? 'blue'
      : model.includes('haiku')
        ? 'green'
        : undefined

const SPARK = '▁▂▃▄▅▆▇█'
const spark = (values: number[]) => {
  const max = Math.max(...values)
  return values
    .map(v => (v <= 0 || max <= 0 ? ' ' : SPARK[Math.min(7, Math.floor((v / max) * 7.999))]))
    .join('')
}

const split = (t: TokenTotals) =>
  `in ${fmt(t.input)} · out ${fmt(t.output)} · cache-w ${fmt(t.cacheWrite)} · cache-r ${fmt(t.cacheRead)}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const stored = (await $.store.get(STORE_PLAN).catch(() => undefined)) as PlanSnapshot | undefined
    if (stored && !(await read($, plan))) await update($, plan, () => stored)
    void scan($)
    $.clock.every(RESCAN_MS, () => void scan($))
    await $.command
      .register({
        name: 'tokens',
        description: 'Details zum Token-Verbrauch der letzten 7 Tage vs. Plan-Auslastung',
      })
      .catch(() => undefined)
    return started
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    void scan($)
    return { text: 'Token-Pane geoeffnet.' }
  })

  // Plan-Auslastung kommt mit jeder API-Antwort.
  on('session.measure', async ($, e, next) => {
    // Neues Plan-Fenster: Summe seit Fensterbeginn neu rechnen.
    if (await setPlan($, e.rateLimits)) void scan($)
    return next(e)
  })

  // Kompakte Leiste oberhalb der Eingabe: 7-Tage-Verlauf, Summe, Plan-Fenster.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const r = await read($, report)
    if (!r) return next(e)
    const p = await read($, plan)
    const { Box, Text, Button } = $.ui.resolve(e)
    const cols = e.props.bodyColumns
    const total = effective(r.total)
    const week = p?.windows.find(w => w.kind === 'seven_day')
    const five = p?.windows.find(w => w.kind === 'five_hour')
    const windowTokens = r.planWindow ? effective(r.planWindow) : undefined
    const perPercent =
      week && windowTokens !== undefined && week.percentUsed >= 1
        ? windowTokens / week.percentUsed
        : undefined

    return (
      <Box>
        <Text dimColor>Tokens 7T </Text>
        {cols >= 70 && <Text color="cyan">{`${spark(r.days.map(effective))} `}</Text>}
        <Text bold>{fmt(total)}</Text>
        <Text dimColor> │ API </Text>
        <Text bold color="magenta">{`≈${fmtUsd(r.total.cost)}`}</Text>
        {p ? (
          <Text>
            <Text dimColor> │ Plan </Text>
            {five && <Text color={tone(five.percentUsed)}>{`5h ${five.percentUsed}% `}</Text>}
            {week && <Text color={tone(week.percentUsed)}>{`7T ${week.percentUsed}%`}</Text>}
            {week && cols >= 100 && <Text dimColor>{` (${when(week.resetsAt)})`}</Text>}
            {perPercent !== undefined && cols >= 85 && (
              <Text dimColor>{` │ ≈${fmt(perPercent)} Tok/1%`}</Text>
            )}
          </Text>
        ) : (
          <Text dimColor> │ Plan: noch kein Stand</Text>
        )}
        <Text> </Text>
        <Button key="details" label="Details" onPress={() => void $.ui.open({ id: PANE, title: TITLE })} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const r = await read($, report)
    const p = await read($, plan)
    const isBusy = await read($, scanning)
    const width = Math.max(10, Math.min(40, (e.viewport?.columns ?? 60) - 30))

    if (!r)
      return <Text dimColor>{isBusy ? 'Lese Transkripte …' : 'Noch keine Daten.'}</Text>

    const max = Math.max(...r.days.map(effective))
    const week = p?.windows.find(w => w.kind === 'seven_day')
    const windowTokens = r.planWindow ? effective(r.planWindow) : undefined
    const capacity =
      week && windowTokens !== undefined ? projectCapacity(windowTokens, week.percentUsed) : undefined

    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Letzte 7 Tage (dieses Geraet)</Text>
        {r.days.map((d, i) => {
          const [full, rest] = bar(effective(d), max, width)
          const isToday = i === r.days.length - 1
          return (
            <Text>
              <Text bold={isToday} dimColor={!isToday}>
                {weekday(d.day)} {d.day.slice(8)}.{d.day.slice(5, 7)}.
              </Text>{' '}
              <Text color={effective(d) === max && max > 0 ? 'yellow' : 'cyan'}>{full}</Text>
              <Text dimColor>{rest}</Text> <Text bold={isToday}>{fmt(effective(d)).padStart(8)}</Text>{' '}
              <Text color="magenta">{fmtUsd(d.cost).padStart(9)}</Text>
            </Text>
          )
        })}
        <Text> </Text>
        <Text>
          Summe: <Text bold color="cyan">{fmt(effective(r.total))}</Text> Tokens ohne Cache-Reads,{' '}
          {fmt(all(r.total))} gesamt, {r.total.requests} Anfragen
        </Text>
        <Text dimColor>{split(r.total)}</Text>
        <Text>
          API-Preis: <Text bold color="magenta">≈ {fmtUsd(r.total.cost)}</Text> nach Listenpreis (inkl. Cache)
          {r.total.unpriced > 0 && (
            <Text color="yellow">{` · ${r.total.unpriced} Anfragen ohne bekannten Preis`}</Text>
          )}
        </Text>
        <Text> </Text>
        <Text bold color="cyan">Nach Modell</Text>
        {r.models.length === 0 && <Text dimColor>keine Anfragen</Text>}
        {r.models.map(m => (
          <Text>
            <Text bold color={modelColor(m.model)}>{m.model}</Text> {fmt(effective(m))} ·{' '}
            {m.unpriced === m.requests ? (
              <Text color="yellow">Preis unbekannt</Text>
            ) : (
              <Text color="magenta">≈ {fmtUsd(m.cost)}</Text>
            )}
            <Text dimColor>{` · ${m.requests} Anfragen`}</Text>
          </Text>
        ))}
        <Text> </Text>
        <Text bold color="cyan">Plan-Auslastung</Text>
        {!p && (
          <Text dimColor>
            Noch kein Plan-Stand: er kommt mit der naechsten Antwort (nur mit Abo-Login, nicht mit API-Key).
          </Text>
        )}
        {p?.windows.map(w => {
          const [full, rest] = bar(w.percentUsed, 100, width)
          return (
            <Text>
              {(WINDOW_NAMES[w.kind] ?? w.kind).padEnd(24)} <Text color={tone(w.percentUsed)}>{full}</Text>
              <Text dimColor>{rest}</Text>{' '}
              <Text bold color={tone(w.percentUsed)}>{`${String(w.percentUsed).padStart(5)}%`}</Text>{' '}
              <Text dimColor>{when(w.resetsAt)}</Text>
            </Text>
          )
        })}
        {week && r.planWindow && windowTokens !== undefined && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text>
              Seit Fensterbeginn hier verbraucht: <Text bold color="cyan">{fmt(windowTokens)}</Text> Tokens ={' '}
              <Text color={tone(week.percentUsed)}>{week.percentUsed}%</Text> des Plans · API-Preis{' '}
              <Text color="magenta">≈ {fmtUsd(r.planWindow.cost)}</Text>
            </Text>
            {capacity !== undefined && (
              <Text>
                ≈ {fmt(windowTokens / week.percentUsed)} Tokens je 1 % · hochgerechnet ≈{' '}
                <Text bold color="green">{fmt(capacity)}</Text> Tokens bis 100 %
              </Text>
            )}
            <Text dimColor>
              Grobe Schaetzung: der Plan gewichtet Modelle und Cache anders und zaehlt alle Geraete.
            </Text>
          </Box>
        )}
        <Text> </Text>
        <Text dimColor>
          {r.files} Transkripte gelesen · Plan-Stand{' '}
          {p ? new Date(p.measuredAt).toLocaleString() : '–'}
        </Text>
        <Button key="rescan" label={isBusy ? 'Lese …' : 'Neu einlesen'} onPress={() => void scan($)} />
      </Box>
    )
  })
}
