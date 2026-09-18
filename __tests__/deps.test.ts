import { jest } from '@jest/globals'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as core from '../__fixtures__/core.js'

const execMock = jest.fn<typeof import('@actions/exec').exec>(async () => 0)
const whichMock = jest.fn<typeof import('@actions/io').which>(
  async (tool) => `/usr/bin/${tool}`
)

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/exec', () => ({ exec: execMock }))
jest.unstable_mockModule('@actions/io', () => ({ which: whichMock }))

const { ensureUserDeps } = await import('../src/deps.js')

function createWorkspace(files: string[]): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-deps-'))
  for (const file of files) {
    const filePath = path.join(workspace, file)
    if (file.endsWith('/')) {
      fs.mkdirSync(filePath)
    } else {
      fs.writeFileSync(filePath, '{}')
    }
  }
  return workspace
}

function resolvedArgv(): string[] | undefined {
  const call = execMock.mock.calls[0]
  return call ? [call[0], ...(call[1] ?? [])] : undefined
}

describe('ensureUserDeps', () => {
  let workspace: string

  afterEach(() => {
    jest.clearAllMocks()
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  it('A-1 skips dependency installation for a theme without package.json', async () => {
    workspace = createWorkspace(['theme.css', 'manifest.json'])

    await expect(ensureUserDeps(workspace)).resolves.toBe(true)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('A-2 selects pnpm frozen installation', async () => {
    workspace = createWorkspace(['package.json', 'pnpm-lock.yaml'])

    await expect(ensureUserDeps(workspace)).resolves.toBe(true)
    expect(resolvedArgv()).toEqual(['pnpm', 'install', '--frozen-lockfile'])
  })

  it('A-3 selects yarn immutable installation', async () => {
    workspace = createWorkspace(['package.json', 'yarn.lock'])

    await expect(ensureUserDeps(workspace)).resolves.toBe(true)
    expect(resolvedArgv()).toEqual(['yarn', 'install', '--immutable'])
  })

  it('A-4 selects bun frozen installation', async () => {
    workspace = createWorkspace(['package.json', 'bun.lockb'])

    await expect(ensureUserDeps(workspace)).resolves.toBe(true)
    expect(resolvedArgv()).toEqual(['bun', 'install', '--frozen-lockfile'])
  })

  it('A-5 selects npm ci for package-lock.json', async () => {
    workspace = createWorkspace(['package.json', 'package-lock.json'])

    await expect(ensureUserDeps(workspace)).resolves.toBe(true)
    expect(resolvedArgv()).toEqual(['npm', 'ci'])
  })

  it('A-6 defaults to pnpm install and recommends committing a lockfile', async () => {
    workspace = createWorkspace(['package.json'])

    await expect(ensureUserDeps(workspace)).resolves.toBe(true)
    expect(resolvedArgv()).toEqual(['pnpm', 'install'])
    expect(core.warning).toHaveBeenCalledTimes(1)
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('requires a committed lockfile')
    )
  })

  it('A-7 falls back without reporting a policy error when pnpm is unavailable', async () => {
    workspace = createWorkspace(['package.json', 'pnpm-lock.yaml'])
    whichMock.mockResolvedValueOnce('')

    await expect(ensureUserDeps(workspace)).resolves.toBe(true)
    expect(resolvedArgv()).toEqual(['npm', 'install'])
    expect(core.warning).toHaveBeenCalledTimes(1)
    expect(core.error).not.toHaveBeenCalled()
  })

  it('A-8 skips dependency installation when node_modules exists', async () => {
    workspace = createWorkspace(['package.json', 'node_modules/'])

    await expect(ensureUserDeps(workspace)).resolves.toBe(true)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('falls back to npm with a warning when default pnpm is unavailable', async () => {
    workspace = createWorkspace(['package.json'])
    whichMock.mockResolvedValueOnce('')

    await expect(ensureUserDeps(workspace)).resolves.toBe(true)
    expect(resolvedArgv()).toEqual(['npm', 'install'])
    expect(core.warning).toHaveBeenCalledTimes(2)
    expect(core.warning).toHaveBeenLastCalledWith(
      expect.stringContaining('"pnpm" is not available')
    )
    expect(core.error).not.toHaveBeenCalled()
  })
})
