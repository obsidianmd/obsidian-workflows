import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { Finding, RegistryCheckResult } from '../src/types.js'

const inspectRegistryMock = jest.fn(
  async (): Promise<RegistryCheckResult> => ({
    findings: [],
    immutableIdentifierExempt: false
  })
)
const checkRepositoryMetadataMock = jest.fn(async () => [] as Finding[])
const execMock = jest.fn(async () => 0)

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/exec', () => ({
  exec: execMock,
  getExecOutput: jest.fn(async () => ({
    exitCode: 0,
    stdout: '[]',
    stderr: ''
  }))
}))
jest.unstable_mockModule('../src/registry.js', () => ({
  inspectRegistry: inspectRegistryMock
}))
jest.unstable_mockModule('../src/repo-meta.js', () => ({
  checkRepositoryMetadata: checkRepositoryMetadataMock
}))

const { PR_PASS_MESSAGE, reportResults, run } = await import('../src/main.js')

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-test-'))
}

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

function writeValidPlugin(workspacePath: string): void {
  fs.writeFileSync(
    path.join(workspacePath, 'manifest.json'),
    JSON.stringify({
      id: 'test-tool',
      name: 'Test',
      version: '1.0.0',
      description: 'A sufficiently long description.'
    })
  )
  fs.writeFileSync(path.join(workspacePath, 'LICENSE'), 'MIT')
  fs.writeFileSync(
    path.join(workspacePath, 'README.md'),
    'This is a valid readme with enough text to exercise the workflow.'
  )
}

describe('main.ts', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
    process.env.GITHUB_WORKSPACE = tempDir
    inspectRegistryMock.mockResolvedValue({
      findings: [],
      immutableIdentifierExempt: false
    })
    checkRepositoryMetadataMock.mockResolvedValue([])
    execMock.mockResolvedValue(0)

    core.getInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        type: 'plugin',
        mode: 'pr',
        build: 'false',
        lint: 'false',
        'scanner-lint': 'false',
        strict: 'false',
        'node-version': '24'
      }
      return inputs[name] ?? ''
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
    fs.rmSync(tempDir, { recursive: true, force: true })
    delete process.env.GITHUB_WORKSPACE
    delete process.env.GITHUB_REF
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL
    delete process.env.GITHUB_TOKEN
  })

  it('fails when manifest.json is missing', async () => {
    fs.writeFileSync(path.join(tempDir, 'LICENSE'), 'MIT')
    fs.writeFileSync(
      path.join(tempDir, 'README.md'),
      'This is a valid readme with enough text to pass.'
    )

    await run()

    expect(core.setFailed).toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith('validation-passed', 'false')
  })

  it('passes with valid plugin structure', async () => {
    writeValidPlugin(tempDir)

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith('type', 'plugin')
    expect(core.setOutput).toHaveBeenCalledWith('validation-passed', 'true')
    expect(core.info).toHaveBeenCalledWith(PR_PASS_MESSAGE)
    expect(PR_PASS_MESSAGE).toContain('Release-only checks did not run')
    expect(PR_PASS_MESSAGE).not.toBe('All checks passed.')
  })

  it('fails with invalid type input', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'type') return 'invalid'
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid type input')
    )
  })

  it('fails with invalid mode input', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'mode') return 'invalid'
      if (name === 'type') return 'plugin'
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid mode input')
    )
  })

  it('fails when node version is below minimum', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'node-version') return '18'
      if (name === 'type') return 'plugin'
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('below the minimum')
    )
  })

  it('routes failed findings to all three annotation levels', () => {
    reportResults(
      [
        finding({ severity: 'error' }),
        finding({ severity: 'warning' }),
        finding({ severity: 'recommendation' })
      ],
      tempDir,
      'pr'
    )
    expect(core.error).toHaveBeenCalledTimes(1)
    expect(core.warning).toHaveBeenCalledTimes(1)
    expect(core.notice).toHaveBeenCalledTimes(1)
  })

  it('does not annotate passed or skipped findings', () => {
    reportResults(
      [finding({ status: 'passed' }), finding({ status: 'skipped' })],
      tempDir,
      'pr'
    )
    expect(core.error).not.toHaveBeenCalled()
    expect(core.warning).not.toHaveBeenCalled()
    expect(core.notice).not.toHaveBeenCalled()
  })

  it('emits a location-aware annotation with a rule title', () => {
    reportResults(
      [
        finding({
          severity: 'error',
          ruleId: 'located-rule',
          location: {
            file: path.join(tempDir, 'src', 'main.ts'),
            startLine: 2,
            endLine: 3,
            startColumn: 4,
            endColumn: 5
          }
        })
      ],
      tempDir,
      'pr'
    )
    expect(core.error).toHaveBeenCalledWith(expect.any(String), {
      file: path.join('src', 'main.ts'),
      startLine: 2,
      endLine: 3,
      startColumn: 4,
      endColumn: 5,
      title: expect.stringContaining('located-rule')
    })
  })

  it('annotates findings without source locations safely', () => {
    reportResults([finding({ severity: 'error' })], tempDir, 'pr')
    expect(core.error).toHaveBeenCalledWith(expect.any(String), {
      title: expect.stringContaining('example-rule')
    })
  })

  it('does not fail validation for recommendations or inconclusive results', async () => {
    reportResults(
      [
        finding({ severity: 'recommendation' }),
        finding({ status: 'inconclusive', severity: 'recommendation' })
      ],
      tempDir,
      'pr'
    )
    expect(core.error).not.toHaveBeenCalled()
  })

  it('downgrades policy errors in advisory mode and passes validation', async () => {
    writeValidPlugin(tempDir)
    inspectRegistryMock.mockResolvedValue({
      findings: [finding({ severity: 'error' })],
      immutableIdentifierExempt: false
    })

    await run()

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Example message'),
      expect.any(Object)
    )
    expect(core.error).not.toHaveBeenCalledWith(
      expect.stringContaining('Example message'),
      expect.any(Object)
    )
    expect(core.setOutput).toHaveBeenCalledWith('validation-passed', 'true')
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.summary.addRaw).toHaveBeenCalledWith(
      expect.stringContaining('strict: true')
    )
  })

  it('keeps policy errors under strict enforcement', async () => {
    writeValidPlugin(tempDir)
    inspectRegistryMock.mockResolvedValue({
      findings: [finding({ severity: 'error' })],
      immutableIdentifierExempt: false
    })
    core.getInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        type: 'plugin',
        mode: 'pr',
        build: 'false',
        lint: 'false',
        'scanner-lint': 'false',
        strict: 'true',
        'node-version': '24'
      }
      return inputs[name] ?? ''
    })

    await run()

    expect(core.error).toHaveBeenCalledWith(
      expect.stringContaining('Example message'),
      expect.any(Object)
    )
    expect(core.setOutput).toHaveBeenCalledWith('validation-passed', 'false')
    expect(core.setFailed).toHaveBeenCalled()
  })

  it.each(['false', 'true'])(
    'keeps correctness errors when strict is %s',
    async (strict) => {
      writeValidPlugin(tempDir)
      inspectRegistryMock.mockResolvedValue({
        findings: [finding({ enforcement: 'correctness', severity: 'error' })],
        immutableIdentifierExempt: false
      })
      core.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          type: 'plugin',
          mode: 'pr',
          build: 'false',
          lint: 'false',
          'scanner-lint': 'false',
          strict,
          'node-version': '24'
        }
        return inputs[name] ?? ''
      })

      await run()

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('Example message'),
        expect.any(Object)
      )
      expect(core.setOutput).toHaveBeenCalledWith('validation-passed', 'false')
      expect(core.setFailed).toHaveBeenCalled()
    }
  )

  it('continues attestation and draft release after policy errors in advisory mode', async () => {
    writeValidPlugin(tempDir)
    fs.writeFileSync(path.join(tempDir, 'main.js'), 'module.exports = {}')
    process.env.GITHUB_REF = 'refs/tags/1.0.0'
    inspectRegistryMock.mockResolvedValue({
      findings: [finding({ severity: 'error' })],
      immutableIdentifierExempt: false
    })
    core.getInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        type: 'plugin',
        mode: 'release',
        build: 'false',
        lint: 'false',
        'scanner-lint': 'false',
        strict: 'false',
        'node-version': '24'
      }
      return inputs[name] ?? ''
    })

    await run()

    expect(core.startGroup).toHaveBeenCalledWith('Attestation')
    expect(core.startGroup).toHaveBeenCalledWith('Draft release')
    expect(execMock).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['release', 'create']),
      expect.any(Object)
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })
})
