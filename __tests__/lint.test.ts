import { jest } from '@jest/globals'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as core from '../__fixtures__/core.js'

const execMock = jest.fn<(...args: unknown[]) => Promise<number>>()
const getExecOutputMock = jest.fn<
  (...args: unknown[]) => Promise<{
    exitCode: number
    stdout: string
    stderr: string
  }>
>()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/exec', () => ({
  exec: execMock,
  getExecOutput: getExecOutputMock
}))

const {
  getMinElectronVersion,
  parseStylelintOutput,
  parseEslintOutput,
  runLint
} = await import('../src/lint.js')

describe('getMinElectronVersion', () => {
  it.each([
    [undefined, 39],
    ['1.11.4', 39],
    ['1.9.12', 37],
    ['1.7.4', 31],
    ['1.6.5', 30],
    ['1.6.0', 28],
    ['1.4.5', 25],
    ['1.0.0', 25],
    ['99.0.0', 39]
  ])('maps %s to Electron %s', (version, expected) => {
    expect(getMinElectronVersion(version)).toBe(expected)
  })
})

describe('Stylelint findings', () => {
  const workspace = path.join(path.sep, 'workspace')

  it('preserves rule identity, severity, count, and source location', () => {
    const payload = JSON.stringify([
      {
        source: path.join(workspace, 'styles.css'),
        warnings: [
          {
            rule: 'declaration-no-important',
            severity: 'warning',
            text: 'Avoid !important',
            line: 12,
            column: 3
          },
          {
            rule: 'color-named',
            severity: 'error',
            text: 'Avoid named colors',
            line: 13,
            column: 1
          }
        ]
      },
      {
        source: path.join(workspace, 'nested', 'other.css'),
        warnings: [
          {
            rule: 'unit-no-unknown',
            severity: 'warning',
            text: 'Unknown unit',
            line: 2,
            column: 4
          }
        ]
      }
    ])

    const findings = parseStylelintOutput(payload, workspace)
    expect(findings).toHaveLength(3)
    expect(findings[0]).toMatchObject({
      ruleId: 'declaration-no-important',
      severity: 'warning',
      location: { file: 'styles.css', startLine: 12, startColumn: 3 }
    })
    expect(findings[1].severity).toBe('error')
  })

  it('maps parse errors to css-parse-error', () => {
    const findings = parseStylelintOutput(
      JSON.stringify([
        {
          source: path.join(workspace, 'broken.css'),
          warnings: [],
          parseErrors: [{ text: 'Unexpected token', line: 4, column: 2 }]
        }
      ]),
      workspace
    )
    expect(findings[0]).toMatchObject({
      ruleId: 'css-parse-error',
      severity: 'error',
      status: 'failed'
    })
  })

  it('returns a passed result when Stylelint writes JSON to stderr', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'))
    fs.writeFileSync(path.join(dir, 'theme.css'), 'body {}')
    execMock.mockResolvedValue(0)
    getExecOutputMock.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: 'npm warning\n[]'
    })
    const findings = await runLint(dir, 'theme', true, 'pr')
    expect(findings).toContainEqual(
      expect.objectContaining({ status: 'passed', check: 'scanner-stylelint' })
    )
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns inconclusive for unparsable output', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'))
    fs.writeFileSync(path.join(dir, 'theme.css'), 'body {}')
    execMock.mockResolvedValue(0)
    getExecOutputMock.mockResolvedValue({
      exitCode: 2,
      stdout: 'not json',
      stderr: 'crash'
    })
    const findings = await runLint(dir, 'theme', true, 'pr')
    expect(findings).toContainEqual(
      expect.objectContaining({ status: 'inconclusive' })
    )
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('skips Stylelint for a plugin with no CSS files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'))
    execMock.mockResolvedValue(0)
    getExecOutputMock.mockResolvedValue({
      exitCode: 0,
      stdout: '[]',
      stderr: ''
    })
    const findings = await runLint(dir, 'plugin', true, 'pr')
    expect(findings).toContainEqual(
      expect.objectContaining({
        check: 'scanner-stylelint',
        status: 'skipped'
      })
    )
    const stylelintCalls = getExecOutputMock.mock.calls.filter((call) =>
      JSON.stringify(call).includes('stylelint')
    )
    expect(stylelintCalls).toHaveLength(0)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('ESLint findings', () => {
  const workspace = path.join(path.sep, 'workspace')

  it('maps individual messages, severities, and locations', () => {
    const findings = parseEslintOutput(
      JSON.stringify([
        {
          filePath: path.join(workspace, 'main.ts'),
          messages: [
            {
              ruleId: 'obsidianmd/detach-leaves',
              severity: 2,
              message: 'Detach leaves',
              line: 8,
              endLine: 9
            },
            {
              ruleId: 'no-eval',
              severity: 1,
              message: 'Avoid eval',
              line: 12
            }
          ]
        }
      ]),
      workspace
    )
    expect(findings).toHaveLength(2)
    expect(findings[0]).toMatchObject({
      severity: 'error',
      location: { file: 'main.ts', startLine: 8, endLine: 9 }
    })
    expect(findings[1].severity).toBe('warning')
  })

  it('treats fatal diagnostics without a rule as inconclusive', () => {
    const findings = parseEslintOutput(
      JSON.stringify([
        {
          filePath: path.join(workspace, 'main.ts'),
          messages: [
            { ruleId: null, fatal: true, severity: 2, message: 'Crash' }
          ]
        }
      ]),
      workspace
    )
    expect(findings[0]).toMatchObject({
      ruleId: 'eslint-execution-failure',
      status: 'inconclusive',
      severity: 'recommendation'
    })
  })

  it('generates a config without type-aware rules when tsconfig is absent', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'))
    fs.writeFileSync(path.join(dir, 'styles.css'), 'body {}')
    execMock.mockResolvedValue(0)
    getExecOutputMock.mockResolvedValue({
      exitCode: 0,
      stdout: '[]',
      stderr: ''
    })
    await runLint(dir, 'plugin', true, 'pr')
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('without type-aware rules')
    )
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
