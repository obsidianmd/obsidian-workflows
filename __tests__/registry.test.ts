import { jest } from '@jest/globals'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const repository = { fork: false }

jest.unstable_mockModule('@actions/github', () => ({
  context: { payload: { repository } }
}))

const { checkRegistry, inspectRegistry } = await import('../src/registry.js')
const { validatePluginManifest, validateThemeManifest } =
  await import('../src/manifest.js')

function createWorkspace(manifest: Record<string, string>): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'))
  fs.writeFileSync(
    path.join(workspace, 'manifest.json'),
    JSON.stringify(manifest)
  )
  return workspace
}

function response(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body
  } as Response
}

describe('checkRegistry', () => {
  let workspace: string
  const fetchMock = jest.spyOn(globalThis, 'fetch')

  beforeEach(() => {
    repository.fork = false
    process.env.GITHUB_REPOSITORY = 'author/project'
  })

  afterEach(() => {
    fetchMock.mockReset()
    fs.rmSync(workspace, { recursive: true, force: true })
    delete process.env.GITHUB_REPOSITORY
  })

  it('does not warn when the plugin registry entry belongs to this repository', async () => {
    workspace = createWorkspace({ id: 'notes', name: 'Notes' })
    fetchMock.mockResolvedValueOnce(
      response([{ id: 'notes', repo: 'author/project' }])
    )

    await expect(checkRegistry(workspace, 'plugin')).resolves.toEqual([])
  })

  it('recommends review instead of warning for a plugin fork', async () => {
    workspace = createWorkspace({ id: 'notes', name: 'Notes' })
    repository.fork = true
    fetchMock.mockResolvedValueOnce(
      response([{ id: 'notes', repo: 'upstream/project' }])
    )

    const results = await checkRegistry(workspace, 'plugin')
    expect(results).toEqual([
      expect.objectContaining({
        ruleId: 'registry-fork-detected',
        severity: 'recommendation'
      })
    ])
    expect(results.some((finding) => finding.severity === 'warning')).toBe(
      false
    )
  })

  it('warns when a plugin ID belongs to a different non-fork repository', async () => {
    workspace = createWorkspace({ id: 'notes', name: 'Notes' })
    fetchMock.mockResolvedValueOnce(
      response([{ id: 'notes', repo: 'other/project' }])
    )

    await expect(checkRegistry(workspace, 'plugin')).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'registry-plugin-id-taken',
        severity: 'warning'
      })
    ])
  })

  it('warns with an ownership caveat when GITHUB_REPOSITORY is unset', async () => {
    workspace = createWorkspace({ id: 'notes', name: 'Notes' })
    delete process.env.GITHUB_REPOSITORY
    fetchMock.mockResolvedValueOnce(
      response([{ id: 'notes', repo: 'other/project' }])
    )

    const [finding] = await checkRegistry(workspace, 'plugin')
    expect(finding.ruleId).toBe('registry-plugin-id-taken')
    expect(finding.message).toContain('ownership could not be confirmed')
  })

  it('warns when a theme name belongs to a different repository', async () => {
    workspace = createWorkspace({ name: 'Midnight' })
    fetchMock.mockResolvedValueOnce(
      response([{ name: 'Midnight', repo: 'other/theme' }])
    )

    await expect(checkRegistry(workspace, 'theme')).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'registry-theme-name-taken',
        severity: 'warning'
      })
    ])
  })

  it('is inconclusive when the plugin registry returns non-200', async () => {
    workspace = createWorkspace({ id: 'notes', name: 'Notes' })
    fetchMock.mockResolvedValueOnce(response([], false))

    await expect(checkRegistry(workspace, 'plugin')).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'registry-unavailable',
        status: 'inconclusive'
      })
    ])
  })

  it('is inconclusive when the theme registry is unparseable', async () => {
    workspace = createWorkspace({ name: 'Midnight' })
    fetchMock.mockResolvedValueOnce(response({ invalid: true }))

    await expect(checkRegistry(workspace, 'theme')).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'registry-unavailable',
        status: 'inconclusive'
      })
    ])
  })

  it('is inconclusive when fetching the registry rejects', async () => {
    workspace = createWorkspace({ id: 'notes', name: 'Notes' })
    fetchMock.mockRejectedValueOnce(new Error('offline'))

    await expect(checkRegistry(workspace, 'plugin')).resolves.toEqual([
      expect.objectContaining({
        ruleId: 'registry-unavailable',
        status: 'inconclusive'
      })
    ])
  })

  it('exempts a registered plugin ID owned by this repository', async () => {
    const manifest = {
      id: 'obsidian-notes',
      name: 'Notes',
      version: '1.0.0',
      description: 'Provides useful tools for managing notes.'
    }
    workspace = createWorkspace(manifest)
    process.env.GITHUB_REPOSITORY = 'AUTHOR/PROJECT'
    fetchMock.mockResolvedValueOnce(
      response([{ id: manifest.id, repo: 'author/project' }])
    )

    const registry = await inspectRegistry(workspace, 'plugin')
    const results = validatePluginManifest(
      manifest,
      registry.immutableIdentifierExempt
    )

    expect(registry.immutableIdentifierExempt).toBe(true)
    expect(
      results.some((finding) => finding.ruleId === 'manifest-id-banned-word')
    ).toBe(false)
  })

  it('errors on a banned word in a new plugin ID', async () => {
    const manifest = {
      id: 'obsidian-notes',
      name: 'Notes',
      version: '1.0.0',
      description: 'Provides useful tools for managing notes.'
    }
    workspace = createWorkspace(manifest)
    fetchMock.mockResolvedValueOnce(response([]))

    const registry = await inspectRegistry(workspace, 'plugin')
    const results = validatePluginManifest(
      manifest,
      registry.immutableIdentifierExempt
    )

    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-id-banned-word',
        severity: 'error'
      })
    )
  })

  it('fails closed on a banned plugin ID when the registry is unavailable', async () => {
    const manifest = {
      id: 'obsidian-notes',
      name: 'Notes',
      version: '1.0.0',
      description: 'Provides useful tools for managing notes.'
    }
    workspace = createWorkspace(manifest)
    fetchMock.mockRejectedValueOnce(new Error('offline'))

    const registry = await inspectRegistry(workspace, 'plugin')
    const results = validatePluginManifest(
      manifest,
      registry.immutableIdentifierExempt
    )

    expect(registry.immutableIdentifierExempt).toBe(false)
    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-id-banned-word',
        severity: 'error'
      })
    )
  })

  it('does not exempt a mutable plugin name', async () => {
    const manifest = {
      id: 'obsidian-notes',
      name: 'Obsidian Notes',
      version: '1.0.0',
      description: 'Provides useful tools for managing notes.'
    }
    workspace = createWorkspace(manifest)
    fetchMock.mockResolvedValueOnce(
      response([{ id: manifest.id, repo: 'author/project' }])
    )

    const registry = await inspectRegistry(workspace, 'plugin')
    const results = validatePluginManifest(
      manifest,
      registry.immutableIdentifierExempt
    )

    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-disallowed-name',
        severity: 'error'
      })
    )
  })

  it('does not exempt a mutable plugin description', async () => {
    const manifest = {
      id: 'obsidian-notes',
      name: 'Notes',
      version: '1.0.0',
      description: 'Provides useful tools for Obsidian users.'
    }
    workspace = createWorkspace(manifest)
    fetchMock.mockResolvedValueOnce(
      response([{ id: manifest.id, repo: 'author/project' }])
    )

    const registry = await inspectRegistry(workspace, 'plugin')
    const results = validatePluginManifest(
      manifest,
      registry.immutableIdentifierExempt
    )

    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-description-brand-name',
        severity: 'error'
      })
    )
  })

  it('does not exempt a registered plugin ID owned by another repository', async () => {
    const manifest = {
      id: 'obsidian-notes',
      name: 'Notes',
      version: '1.0.0',
      description: 'Provides useful tools for managing notes.'
    }
    workspace = createWorkspace(manifest)
    fetchMock.mockResolvedValueOnce(
      response([{ id: manifest.id, repo: 'other/project' }])
    )

    const registry = await inspectRegistry(workspace, 'plugin')
    const results = validatePluginManifest(
      manifest,
      registry.immutableIdentifierExempt
    )

    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-id-banned-word',
        severity: 'error'
      })
    )
  })

  it('exempts a registered theme name owned by this repository', async () => {
    const manifest = {
      name: 'Obsidian Midnight',
      version: '1.0.0',
      minAppVersion: '1.0.0',
      author: 'Jane Developer'
    }
    workspace = createWorkspace(manifest)
    fetchMock.mockResolvedValueOnce(
      response([{ name: manifest.name, repo: 'author/project' }])
    )

    const registry = await inspectRegistry(workspace, 'theme')
    const results = validateThemeManifest(
      manifest,
      registry.immutableIdentifierExempt
    )

    expect(registry.immutableIdentifierExempt).toBe(true)
    expect(
      results.some((finding) => finding.ruleId === 'manifest-disallowed-name')
    ).toBe(false)
  })

  it('errors on a banned word in a new theme name', async () => {
    const manifest = {
      name: 'Obsidian Midnight',
      version: '1.0.0',
      minAppVersion: '1.0.0',
      author: 'Jane Developer'
    }
    workspace = createWorkspace(manifest)
    fetchMock.mockResolvedValueOnce(response([]))

    const registry = await inspectRegistry(workspace, 'theme')
    const results = validateThemeManifest(
      manifest,
      registry.immutableIdentifierExempt
    )

    expect(results).toContainEqual(
      expect.objectContaining({
        ruleId: 'manifest-disallowed-name',
        severity: 'error'
      })
    )
  })
})
