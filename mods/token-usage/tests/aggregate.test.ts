import { expect, test } from 'claude-code/testing'

import { DAY_MS, aggregate, effective, parseTranscript, projectCapacity } from '../hooks/aggregate'
import { costOf, priceFor } from '../hooks/pricing'

const NOW = Date.parse('2026-10-05T12:00:00Z')

const line = (id: string, at: number, out: number, model = 'claude-opus-5-5') =>
  JSON.stringify({
    type: 'assistant',
    requestId: `req_${id}`,
    timestamp: new Date(at).toISOString(),
    message: {
      id: `msg_${id}`,
      model,
      usage: { input_tokens: 10, output_tokens: out, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 },
    },
  })

test('zaehlt eine Antwort mit mehreren Content-Block-Zeilen nur einmal', async () => {
  const text = [line('a', NOW, 50), line('a', NOW, 50), '{"type":"user"}', 'kaputt'].join('\n')
  const r = aggregate(parseTranscript(text), NOW, 0, 1)
  expect(r.total.requests).toBe(1)
  expect(effective(r.total)).toBe(160)
  expect(r.total.cacheRead).toBe(1000)
})

test('nimmt nur heute und die sechs Vortage, je lokalem Tag', async () => {
  const text = [
    line('old', NOW - 7 * DAY_MS, 1),
    line('d6', NOW - 6 * DAY_MS, 2),
    line('today', NOW, 3, 'claude-sonnet-5-5'),
  ].join('\n')
  const r = aggregate(parseTranscript(text), NOW, 120, 1)
  expect(r.days.length).toBe(7)
  expect(r.days[0]?.day).toBe('2026-09-29')
  expect(r.days[6]?.day).toBe('2026-10-05')
  expect(r.total.requests).toBe(2)
  expect(r.models.map(m => m.model).sort()).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
})

test('summiert seit Beginn des Plan-Fensters und rechnet die Kapazitaet hoch', async () => {
  const text = [line('x', NOW - 3 * DAY_MS, 90), line('y', NOW - DAY_MS, 90)].join('\n')
  const r = aggregate(parseTranscript(text), NOW, 0, 1, NOW - 2 * DAY_MS)
  expect(r.planWindow?.requests).toBe(1)
  expect(projectCapacity(200, 10)).toBe(2000)
  expect(projectCapacity(200, 0)).toBe(undefined)
})

test('rechnet den API-Listenpreis je Antwort', async () => {
  // Opus 5.5: 10 in ($4) + 100 cache-w 5m ($5) + 1000 cache-r ($0.20) + 50 out ($20) je 1 Mio.
  const r = aggregate(parseTranscript(line('a', NOW, 50)), NOW, 0, 1)
  const expected = (10 * 4 + 100 * 5 + 1000 * 0.2 + 50 * 20) / 1e6
  expect(Math.abs(r.total.cost - expected) < 1e-12).toBe(true)
  expect(r.total.unpriced).toBe(0)

  const base = { input: 0, output: 0, cacheWrite5m: 0, cacheRead: 0, isFast: false }
  expect(costOf({ ...base, model: 'claude-opus-5-5', cacheWrite1h: 1e6 })).toBe(8)
  expect(costOf({ ...base, model: 'claude-opus-5-5', cacheWrite1h: 0, output: 1e6, isFast: true })).toBe(40)
  expect(priceFor('claude-opus-5')?.input).toBe(5)
  expect(priceFor('claude-haiku-4-5-20251001')?.output).toBe(5)
  expect(priceFor('sonnet')?.input).toBe(2)

  const u = aggregate(parseTranscript(line('b', NOW, 50, 'irgendein-modell')), NOW, 0, 1)
  expect(u.total.cost).toBe(0)
  expect(u.total.unpriced).toBe(1)
})
