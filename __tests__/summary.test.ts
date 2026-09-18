import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import type { Finding } from '../src/types.js'

jest.unstable_mockModule('@actions/core', () => core)

const { writeJobSummary } = await import('../src/summary.js')

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'example-rule',
    check: 'example-check',
    message: 'Example message',
    enforcement: 'policy',
    severity: 'warning',
    status: 'failed',
    coverage: 'partial',
    ...overrides
  }
}

function summaryText(): string {
  return core.summary.addRaw.mock.calls.map(([value]) => value).join('')
}

describe('job summary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders severity counts, per-check tables, and remediation links', async () => {
    await writeJobSummary(
      [
        finding({ severity: 'error', check: 'manifest' }),
        finding({
          severity: 'warning',
          check: 'scanner-eslint',
          helpUrl: 'https://example.com/help'
        }),
        finding({ severity: 'recommendation', check: 'scanner-eslint' })
      ],
      'pr',
      'plugin',
      false
    )
    const text = summaryText()
    expect(text).toContain('**Errors:** 1')
    expect(text).toContain('**Warnings:** 1')
    expect(text).toContain('**Recommendations:** 1')
    expect(text.match(/## manifest/g)).toHaveLength(1)
    expect(text.match(/## scanner-eslint/g)).toHaveLength(1)
    expect(text).toContain('[Documentation](https://example.com/help)')
  })

  it('lists all seven deferred plugin checks in PR mode', async () => {
    await writeJobSummary([], 'pr', 'plugin', false)
    const text = summaryText()
    for (const task of [
      'plugin-releases',
      'plugin-network',
      'plugin-behavior',
      'plugin-es5',
      'plugin-obfuscation',
      'plugin-wasm',
      'plugin-funding'
    ]) {
      expect(text).toContain(task)
    }
  })

  it('discloses unavailable theme screenshot context', async () => {
    await writeJobSummary([], 'pr', 'theme', false)
    expect(summaryText()).toContain('requires directory submission context')
  })

  it('always writes disclaimer, coverage, and version details', async () => {
    await writeJobSummary([], 'pr', 'plugin', false)
    const text = summaryText()
    expect(core.summary.write).toHaveBeenCalledTimes(1)
    expect(text).toContain('## Coverage')
    expect(text).toContain('does **not** guarantee directory acceptance')
    expect(text).toContain('Action version:')
    expect(text).toContain('Rule-catalog version:')
  })

  it('omits deferred release checks in release mode', async () => {
    await writeJobSummary([], 'release', 'plugin', false)
    expect(summaryText()).not.toContain('plugin-network')
  })

  it('states advisory mode when strict is false', async () => {
    await writeJobSummary([], 'pr', 'plugin', false)

    expect(summaryText()).toContain('Advisory mode')
    expect(summaryText()).toContain('strict: true')
  })

  it('states enforcement mode when strict is true', async () => {
    await writeJobSummary([], 'pr', 'plugin', true)

    expect(summaryText()).toContain('Strict mode')
  })
})
