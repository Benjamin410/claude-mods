import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.now()
const row = (id: string, ago: number, out: number) =>
  JSON.stringify({
    type: 'assistant',
    requestId: `req_${id}`,
    timestamp: new Date(NOW - ago).toISOString(),
    message: { id: `msg_${id}`, model: 'claude-opus-5-5', usage: { input_tokens: 0, output_tokens: out } },
  })

const TRANSCRIPT = [row('a', 0, 1500), row('a', 0, 1500), row('b', 3 * 86_400_000, 500)].join('\n')

for (const surface of ['terminal', 'desktop'] as const) {
  test(`Leiste oberhalb der Eingabe zeigt 7-Tage-Summe (${surface})`, async ($, on) => {
    mock.env(on, { HOME: '/home/t' })
    mock.store(on)
    mock.clock(on, { now: NOW })
    on('fs.list', ($, e) => ({
      value:
        e.path === '/home/t/.claude/projects'
          ? [{ name: 'p', kind: 'dir', size: 0, mtimeMs: NOW, isLink: false }]
          : e.path === '/home/t/.claude/projects/p'
            ? [{ name: 's.jsonl', kind: 'file', size: 1, mtimeMs: NOW, isLink: false }]
            : [],
    }) as never)
    on('fs.read', () => ({ value: TRANSCRIPT }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('command.register', () => ({ value: { command: 'tokens' } }) as never)
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>leer</Text>
    })

    await $.session.start({ cwd: '/w', surface, isInteractive: true })

    let text = ''
    for (let i = 0; i < 50 && !text.includes('2.0 k'); i++) {
      const ui = await $.ui.mount({
        plugin: 'token-usage',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as never,
      })
      text = JSON.stringify(await ui.drawn())
      await ui.unmount()
    }
    expect(text).toContain('Tokens 7T')
    expect(text).toContain('2.0 k')
    expect(text).toContain('Plan: noch kein Stand')

    await $.session.measure({
      context: {} as never,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23 },
        { kind: 'seven_day', percentUsed: 42, resetsAt: new Date(NOW + 2 * 86_400_000).toISOString() },
      ],
      changed: ['rateLimits'],
    })
    let planText = ''
    for (let i = 0; i < 50 && !planText.includes('42%'); i++) {
      const ui = await $.ui.mount({
        plugin: 'token-usage',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as never,
      })
      planText = JSON.stringify(await ui.drawn())
      await ui.unmount()
    }
    expect(planText).toContain('5h 23%')
    expect(planText).toContain('7T 42%')
    expect(planText).toContain('/1%')
  })
}
