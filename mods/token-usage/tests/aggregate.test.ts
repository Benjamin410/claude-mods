import { expect, test } from 'claude-code/testing'

import { DAY_MS, aggregate, effective, parseTranscript, projectCapacity } from '../hooks/aggregate'

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
