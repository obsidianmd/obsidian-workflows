import { jest } from '@jest/globals'
import * as fs from 'node:fs'
import * as core from '../__fixtures__/core.js'

const existsSyncMock = jest.fn<typeof fs.existsSync>()
const readFileSyncMock = jest.fn<typeof fs.readFileSync>()
const execMock = jest.fn<typeof import('@actions/exec').exec>()
const hasPackageJsonMock = jest.fn<(workspacePath: string) => boolean>()
const ensureUserDepsMock =
  jest.fn<(workspacePath: string) => Promise<boolean>>()

jest.unstable_mockModule('node:fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock
}))
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/exec', () => ({ exec: execMock }))
jest.unstable_mockModule('../src/deps.js', () => ({
  hasPackageJson: hasPackageJsonMock,
  ensureUserDeps: ensureUserDepsMock
}))

const { runBuild } = await import('../src/build.js')

describe('build execution', () => {
  beforeEach(() => {
    existsSyncMock.mockReturnValue(false)
    hasPackageJsonMock.mockReturnValue(false)
    ensureUserDepsMock.mockResolvedValue(true)
    execMock.mockResolvedValue(0)
  })

  it('disables builds when the input is false', async () => {
    await expect(runBuild('/workspace', 'plugin', 'false')).resolves.toEqual([])
    expect(ensureUserDepsMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
  })

  it('runs an explicit command for plugins', async () => {
    await expect(
      runBuild('/workspace', 'plugin', 'npm run package')
    ).resolves.toEqual([])
    expect(execMock).toHaveBeenCalledWith('npm', ['run', 'package'], {
      cwd: '/workspace',
      ignoreReturnCode: true
    })
  })

  it('runs an explicit command for themes', async () => {
    await expect(
      runBuild('/workspace', 'theme', 'pnpm compile')
    ).resolves.toEqual([])
    expect(execMock).toHaveBeenCalledWith('pnpm', ['compile'], {
      cwd: '/workspace',
      ignoreReturnCode: true
    })
  })

  it.each([
    [{ compile: 'compile', 'build:plugin': 'plugin', build: 'build' }, 'build'],
    [{ compile: 'compile', 'build:plugin': 'plugin' }, 'build:plugin'],
    [{ compile: 'compile' }, 'compile']
  ])('auto-detects script precedence for %o', async (scripts, expected) => {
    hasPackageJsonMock.mockReturnValue(true)
    existsSyncMock.mockReturnValue(true)
    readFileSyncMock.mockReturnValue(JSON.stringify({ scripts }))

    await expect(runBuild('/workspace', 'plugin', '')).resolves.toEqual([])
    expect(execMock).toHaveBeenCalledWith('npm', ['run', expected], {
      cwd: '/workspace',
      ignoreReturnCode: true
    })
  })

  it('skips auto-detection without package.json', async () => {
    await expect(runBuild('/workspace', 'plugin', '')).resolves.toEqual([])
    expect(readFileSyncMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
  })

  it('skips when package.json has no matching script', async () => {
    hasPackageJsonMock.mockReturnValue(true)
    existsSyncMock.mockReturnValue(true)
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ scripts: { test: 'jest' } })
    )

    await expect(runBuild('/workspace', 'plugin', '')).resolves.toEqual([])
    expect(execMock).not.toHaveBeenCalled()
  })

  it('reports dependency installation failure without running the build', async () => {
    ensureUserDepsMock.mockResolvedValue(false)
    await expect(
      runBuild('/workspace', 'theme', 'npm run build')
    ).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'build-dependency-install-failed',
        enforcement: 'correctness',
        severity: 'error',
        status: 'failed'
      })
    ])
    expect(execMock).not.toHaveBeenCalled()
  })

  it('reports a non-zero build exit code', async () => {
    execMock.mockResolvedValue(2)
    await expect(
      runBuild('/workspace', 'plugin', 'npm run build')
    ).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'build-command-failed',
        message: expect.stringContaining('exit code 2')
      })
    ])
  })
})
